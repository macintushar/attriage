import { mkdirSync } from "node:fs"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import type { Readable } from "node:stream"

import { env } from "./env"
import { getConnectors, staleSessions, touchSession } from "./db"
import { patientContact } from "./routing"
import type { AgentRecord, SessionRecord } from "./types"
import { log } from "./logger"

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString()
}

function exitCode(proc: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => resolve(code ?? 1))
  })
}

async function docker(args: string[], stdin?: string): Promise<ExecResult> {
  const proc = spawn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
  })
  proc.stdin.end(stdin)
  const [stdout, stderr, code] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    exitCode(proc),
  ])
  return { code, stdout, stderr }
}

function containerName(id: string) {
  return `pi-${id}`
}

/** These values come from agent config, which is user input — quote them. */
function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function isRunning(name: string): Promise<boolean> {
  const res = await docker(["inspect", "-f", "{{.State.Running}}", name])
  return res.code === 0 && res.stdout.trim() === "true"
}

/**
 * Secrets reach the container as env vars at `docker run` time and are
 * referenced by name inside (`pm credentials add --from-env`). They are never
 * written to the workspace, an image layer, or a command line the agent sees.
 */
function credentialEnvArgs(agentId: string): string[] {
  const args: string[] = []
  const seen = new Set<string>()
  for (const binding of getConnectors(agentId)) {
    for (const envVar of Object.values(binding.credentialEnv)) {
      if (seen.has(envVar) || !process.env[envVar]) continue
      seen.add(envVar)
      args.push("-e", `${envVar}=${process.env[envVar]}`)
    }
  }
  return args
}

/**
 * Brings up the session's sandbox and registers the agent's connectors in it.
 *
 * The container belongs to the session, not the agent: reassigning a session to
 * a different agent keeps the workspace (and the Pi conversation history in it)
 * and re-provisions credentials for the new agent.
 */
export async function ensureContainer(
  session: SessionRecord,
  agent: AgentRecord
): Promise<SessionRecord> {
  const startedAt = performance.now()
  log.info("sandbox.ensure.started", {
    sessionId: session.id,
    agentId: agent.id,
  })
  const { id, workdir } = session
  mkdirSync(workdir, { recursive: true })

  const name = containerName(id)
  if (await isRunning(name)) {
    touchSession(id, { containerId: name })
    await provision(agent, name)
    log.info("sandbox.ensure.reused", {
      sessionId: id,
      containerId: name,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return { ...session, containerId: name }
  }

  // A stopped-but-present container would make `docker run` fail on the name.
  await docker(["rm", "-f", name])

  const run = await docker([
    "run",
    "-d",
    "--name",
    name,
    "-v",
    `${workdir}:/workspace`,
    // No SARVAM_API_KEY here on purpose: the agent runs arbitrary shell
    // commands, so anything in its env is readable by the model. It reaches
    // Sarvam through the backend's shim instead.
    ...credentialEnvArgs(agent.id),
    // Who the patient is, taken from the channel rather than from the model.
    // Told to supply a phone number it was never given, the model invents a
    // plausible one — first the placeholder from its own skill file, then, once
    // that was blocked, a different fake that evaded the block. Identity is not
    // something to ask a language model for, so `hms` reads it from here and
    // ignores whatever the agent types.
    "-e",
    `HMS_PATIENT_CONTACT=${patientContact(session.peerJid)}`,
    // Lets the sandbox reach a model server on the host. Docker Desktop
    // provides this name already; the explicit mapping keeps Linux working.
    "--add-host",
    "host.docker.internal:host-gateway",
    // The agent writes and executes its own shell commands in here, so the
    // container is the security boundary — lock it down accordingly.
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "1g",
    "--pids-limit",
    "256",
    env.sandboxImage,
    "sleep",
    "infinity",
  ])

  if (run.code !== 0) {
    throw new Error(`failed to start sandbox for ${id}: ${run.stderr.trim()}`)
  }

  touchSession(id, { containerId: name })
  await waitForReady(name)
  await provision(agent, name)
  log.info("sandbox.ensure.completed", {
    sessionId: id,
    containerId: name,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return { ...session, containerId: name }
}

/**
 * `docker run -d` returns as soon as the container is created, which can be
 * before the entrypoint has finished `pm init`. Provisioning into a
 * project-less workspace fails, so wait for the project to actually exist.
 */
async function waitForReady(name: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await docker([
      "exec",
      name,
      "bash",
      "-lc",
      'test -d "$PM_PROJECT_DIR/.polymetrics" && test -f /workspace/.pi/models.json',
    ])
    if (res.code === 0) return
    await delay(250)
  }
  throw new Error(`sandbox ${name} did not become ready within ${timeoutMs}ms`)
}

/**
 * Registers the agent's connector credentials inside the sandbox.
 *
 * The marker is per agent, because a session can be reassigned: the workspace
 * may already be provisioned for the agent that used to answer here, whose
 * connections are not the ones the new agent needs.
 */
async function provision(agent: AgentRecord, name: string) {
  const bindings = getConnectors(agent.id)
  if (!bindings.length) return
  log.info("sandbox.provision.started", {
    agentId: agent.id,
    connectorCount: bindings.length,
  })
  const marker = `/workspace/.provisioned-${agent.id.replace(/[^a-zA-Z0-9._-]/g, "-")}`

  const lines = ["set -e", 'cd "$PM_PROJECT_DIR"']
  for (const b of bindings) {
    const fromEnv = Object.entries(b.credentialEnv)
      .map(
        ([field, envVar]) => `--from-env ${shellArg(field)}=${shellArg(envVar)}`
      )
      .join(" ")
    const config = Object.entries(b.config)
      .map(
        ([key, value]) =>
          `--config ${shellArg(key)}=${shellArg(
            value.replace(/\$WORKSPACE/g, "/workspace")
          )}`
      )
      .join(" ")
    lines.push(
      `pm credentials add ${shellArg(b.connectionName)} --connector ${shellArg(b.slug)} ${config} ${fromEnv}`
    )
  }
  // The marker is written only on success — swallowing the error here would
  // permanently mark a broken workspace as provisioned.
  lines.push(`touch ${marker}`)

  const res = await docker([
    "exec",
    name,
    "bash",
    "-lc",
    `test -f ${marker} || { ${lines.join("; ")}; }`,
  ])

  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().slice(0, 400)
    throw new Error(
      `failed to register connector credentials for ${agent.id}: ${detail}\n` +
        `Check the connector's required config/credential fields with ` +
        `\`pm connectors inspect <slug>\`.`
    )
  }
  log.info("sandbox.provision.completed", {
    agentId: agent.id,
    connectorCount: bindings.length,
  })
}

export async function execInSession(
  session: SessionRecord,
  command: string
): Promise<ExecResult> {
  return docker([
    "exec",
    "-w",
    "/workspace/project",
    containerName(session.id),
    "bash",
    "-lc",
    command,
  ])
}

/** Streams a command's stdout line by line. Used to follow `pi --mode json`. */
export function spawnInSession(
  session: SessionRecord,
  args: string[],
  cwd = "/workspace"
) {
  const proc = spawn(
    "docker",
    ["exec", "-w", cwd, containerName(session.id), ...args],
    {
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  return {
    stdout: proc.stdout,
    stderrText: streamText(proc.stderr),
    exited: exitCode(proc),
    kill: () => proc.kill(),
  }
}

export async function stopSession(id: string) {
  log.info("sandbox.stop.started", { sessionId: id })
  await docker(["rm", "-f", containerName(id)])
  touchSession(id, { containerId: null, status: "reaped" })
  log.info("sandbox.stop.completed", { sessionId: id })
}

const REAPER_KEY = Symbol.for("sarvam-control-plane.reaper")
const globals = globalThis as typeof globalThis & {
  [REAPER_KEY]?: ReturnType<typeof setInterval>
}

/** Idle containers are removed; their workdir (and Pi session JSONL) survives. */
export function startReaper() {
  if (globals[REAPER_KEY]) return
  log.info("sandbox.reaper.started", { idleMs: env.sessionIdleMs })
  globals[REAPER_KEY] = setInterval(async () => {
    for (const session of staleSessions(env.sessionIdleMs)) {
      if (session.status === "running") continue
      await stopSession(session.id).catch((error) =>
        log.error("sandbox.reaper.stop_failed", {
          sessionId: session.id,
          error,
        })
      )
    }
  }, 60_000)
}

export function stopReaper() {
  const reaper = globals[REAPER_KEY]
  if (reaper) clearInterval(reaper)
  delete globals[REAPER_KEY]
}

export async function dockerAvailable(): Promise<boolean> {
  const res = await docker(["version", "--format", "{{.Server.Version}}"])
  return res.code === 0
}
