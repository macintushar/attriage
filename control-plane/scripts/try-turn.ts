/**
 * Drive one agent turn from the CLI — no WhatsApp, no browser.
 *
 *   bun run try-turn <agentId> "book me an appointment"
 *   AGENT_PEER=fresh bun run try-turn <agentId> "start fresh"   # new session
 *
 * Prints the live trace so you can see the agent's pm commands as they run.
 */
import { ensureSessionRow, getAgent, getChannel, listAgents } from "../src/server/db"
import { runBus, runTopic } from "../src/server/events"
import { runPipeline } from "../src/server/pipeline"
import { PLAYGROUND_CHANNEL_ID, playgroundPeer } from "../src/server/routing"
import { stopReaper } from "../src/server/sandbox"
import { startSarvamShim, stopSarvamShim } from "../src/server/sarvam-shim"

const [agentId, ...rest] = process.argv.slice(2)
const text = rest.join(" ")
const source = process.env.AGENT_PEER ?? "cli"

if (!agentId || !text) {
  console.error('usage: bun run try-turn <agentId> "message"')
  console.error(
    `known agents: ${
      listAgents()
        .map((a) => a.id)
        .join(", ") || "(none)"
    }`
  )
  process.exit(2)
}

const agent = getAgent(agentId)
if (!agent) {
  console.error(`unknown agent: ${agentId}`)
  console.error(
    `known agents: ${
      listAgents()
        .map((a) => a.id)
        .join(", ") || "(none)"
    }`
  )
  process.exit(2)
}

runBus.subscribe(runTopic.agent(agent.id), (event) => {
  switch (event.type) {
    case "stage":
      if (event.stage.status === "skipped") return
      console.log(
        `  [${event.stage.status.padEnd(7)}] ${event.stage.label}` +
          (event.stage.ms ? ` (${event.stage.ms}ms)` : "") +
          (event.stage.detail ? `\n            ${event.stage.detail}` : "")
      )
      break
    case "step":
      console.log(
        `      · ${event.step.status === "running" ? "▶" : event.step.status === "error" ? "✗" : "✓"} ${event.step.label}`
      )
      break
    case "message":
      if (event.message.role === "agent") {
        console.log(`\n--- reply ---\n${event.message.text}\n`)
      }
      break
    case "error":
      console.error(`  ERROR: ${event.message}`)
      break
    default:
      break
  }
})

startSarvamShim()

// The CLI drives the built-in playground channel, so it takes exactly the same
// path as WhatsApp — session, sandbox, pipeline — with nothing to deliver to.
const channel = getChannel(PLAYGROUND_CHANNEL_ID)!
const { session } = ensureSessionRow(
  channel.id,
  playgroundPeer(agent.id, source),
  agent.id,
  { pinned: true }
)

try {
  await runPipeline({
    channel,
    session,
    agent,
    input: { kind: "text", text },
    delivery: { send: async () => {} },
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  stopReaper()
  stopSarvamShim()
}
