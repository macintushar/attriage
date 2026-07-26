import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — copy .env.example to .env`)
  return value
}

export const env = {
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  sandboxImage: process.env.SANDBOX_IMAGE ?? "sarvam-sandbox:latest",
  sarvamKey: process.env.SARVAM_API_KEY ?? "",
  model: process.env.AGENT_MODEL ?? "sarvam-105b",
  /** Overridden to "mock" by scripts/mock-llm.ts for offline testing. */
  provider: process.env.AGENT_PROVIDER ?? "sarvam",
  /** Local OpenAI-compat shim the sandbox calls instead of Sarvam directly. */
  shimPort: Number(process.env.SARVAM_SHIM_PORT ?? 8788),
  /** Containers idle longer than this are reaped; the workdir survives. */
  sessionIdleMs: Number(process.env.SESSION_IDLE_MS ?? 15 * 60 * 1000),
  /** Hard ceiling on one agent turn, so a runaway loop can't wedge a chat. */
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS ?? 4 * 60 * 1000),
  /**
   * Whether a channel that was connected resumes its WhatsApp socket at boot.
   * Set to 0 if two processes share this data directory — both would reconnect
   * with the same credentials, and Baileys can respond to that by logging out.
   */
  autoReconnectChannels: process.env.CHANNEL_AUTO_RECONNECT !== "0",
}

export function requireSarvamKey(): string {
  if (!env.sarvamKey) throw new Error("SARVAM_API_KEY is not set")
  return env.sarvamKey
}

export const paths = {
  db: () => `${env.dataDir}/app.db`,
  sessions: () => `${env.dataDir}/sessions`,
  sessionDir: (id: string) => `${env.dataDir}/sessions/${id}`,
  /** Baileys multi-file auth state, per channel — this is the paired number. */
  waAuth: (channelId: string) => `${env.dataDir}/wa/${channelId}`,
}

export function ensureDataDirs() {
  for (const dir of [env.dataDir, paths.sessions(), `${env.dataDir}/wa`]) {
    mkdirSync(dir, { recursive: true })
  }
}

export { required }
