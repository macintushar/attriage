/**
 * Seeds the patient-intake agent and a WhatsApp channel that defaults to it.
 *
 *   bun scripts/seed.ts                     # uses the built-in demo connector
 *   HMS_CONNECTOR=<slug> bun scripts/seed.ts
 *
 * The agent is only configuration — nothing in the backend knows about
 * healthcare. Swapping in the real hospital connector is a slug change here (or
 * a form edit in the UI), not a code change.
 */
import {
  createAgent,
  createChannel,
  getAgent,
  getChannel,
  setConnectors,
  updateAgent,
  updateChannel,
  ensurePlaygroundChannel,
} from "../src/server/db"

const organizationId = process.env.SEED_ORGANIZATION_ID
if (!organizationId) {
  throw new Error(
    "SEED_ORGANIZATION_ID is required. Create an organization in the app, then run `SEED_ORGANIZATION_ID=<id> bun run seed`."
  )
}

/**
 * Defaults to pm's built-in `outbox` connector, which records reverse-ETL
 * writes as JSONL locally. That means the whole flow is demonstrable today,
 * before the healthcare connector lands — and the write is real, not faked.
 */
const slug = process.env.HMS_CONNECTOR ?? "outbox"
const connectionName = process.env.HMS_CONNECTION ?? `${slug}-main`
const credentialEnv = process.env.HMS_CREDENTIAL_ENV
  ? (JSON.parse(process.env.HMS_CREDENTIAL_ENV) as Record<string, string>)
  : {}
// `outbox` writes JSONL to a directory, so it needs a path. $WORKSPACE is
// expanded to /workspace inside the sandbox.
const config = process.env.HMS_CONFIG
  ? (JSON.parse(process.env.HMS_CONFIG) as Record<string, string>)
  : slug === "outbox"
    ? { path: "$WORKSPACE/project/.polymetrics/outbox" }
    : {}

const GOAL = `Take a new patient through intake, end to end:

1. Greet them warmly and say you'll help them get an appointment.
2. Collect, one question at a time: full name, age, sex, and contact number.
3. Ask what's troubling them. Ask follow-ups until you genuinely understand the
   symptoms, how long they've had them, and how severe they are.
4. Work out which medical specialty fits (for example: chest pain or
   breathlessness → cardiology; rash or itching → dermatology; child under 12 →
   paediatrics; joint or back pain → orthopaedics; headache, dizziness or
   numbness → neurology). If two could fit, ask one more question rather than
   guessing. If nothing fits, use general medicine.
5. Look up which doctors of that specialty have availability.
6. Read the details back and get a clear yes before writing anything.
7. Create the patient record, then book the earliest suitable appointment.
8. Confirm with the doctor's name, specialty, date, time and location, and tell
   them what to bring.`

const GUARDRAILS = `## Clinical safety
- You are an intake assistant, not a clinician. Never diagnose, never suggest
  treatment or medication, and never estimate how serious something is.
- If they describe anything that sounds like an emergency — chest pain with
  sweating or breathlessness, difficulty breathing, one-sided weakness, slurred
  speech, heavy bleeding, loss of consciousness, or thoughts of self-harm — stop
  intake immediately, tell them to seek emergency care or call their local
  emergency number now, and offer to alert a human coordinator. Do not book a
  routine appointment instead.
- Choosing a specialty is triage, not diagnosis. If you are unsure, ask.

## Handling their details
- Patient details are confidential. Never repeat them into any system other
  than the one you were given, and never include them in a summary you would not
  show the patient.
- Read every detail back before you write it. A wrong phone number means a
  missed appointment.
- Never invent a name, date, doctor, or appointment slot. If a lookup returns
  nothing, say so and offer the next step.

## When to hand off
- If they ask for a human twice, are distressed, or need something outside
  booking an appointment, hand off and summarise so they never repeat themselves.`

const name = "Patient Intake"
const existing = await getAgent(organizationId, "patient-intake")

const systemPrompt = [
  `You are **${name}**, the intake assistant for a hospital, talking to patients on WhatsApp.`,
  "",
  "## Language & tone",
  "- Detect the patient's language (Hindi, English, Tamil, or any mix) and reply in the same language.",
  "- Be warm, calm and brief. Patients messaging a hospital are often anxious.",
  "- Ask one question at a time. Short questions get short answers, which transcribe far more reliably.",
  "- Voice notes get spoken replies: under 3 short sentences, no lists or formatting.",
  "- **Read the `talking-to-people` skill before your first reply.** It is how you",
  "  are judged: cadence, never making someone repeat themselves, distress and",
  "  emergencies, and how to close. Follow it in every message.",
  "",
  "## What you are here to do",
  GOAL,
  "",
  "## Systems you can reach",
  `You work through the \`pm\` command-line tool from your bash tool, using the`,
  `\`${slug}\` connector (connection \`${connectionName}\`). Read the \`pm-workflow\``,
  "skill before your first write, and run `pm connectors inspect` before you use a",
  "connector — never guess a field or action name.",
  "",
  GUARDRAILS,
].join("\n")

const agent = existing
  ? (await updateAgent(organizationId, "patient-intake", {
      name,
      goal: GOAL,
      systemPrompt,
      voice: true,
      language: "auto",
      ttsSpeaker: "shubh",
      tools: [slug],
    }))!
  : await createAgent(organizationId, {
      id: "patient-intake",
      name,
      voice: true,
      tools: [slug],
      systemPrompt,
      goal: GOAL,
      language: "auto",
      ttsSpeaker: "shubh",
    })

await setConnectors(organizationId, agent.id, [
  {
    agentId: agent.id,
    slug,
    connectionName,
    // Empty = the agent may use any action the connector exposes. Narrow this
    // for a production agent.
    allowedActions: [],
    credentialEnv,
    config,
  },
])

// The channel is a separate object now: it owns the number and hands every new
// conversation to its default agent. Re-seeding repoints it rather than making
// a second channel, so a paired number is never orphaned.
const CHANNEL_ID = process.env.WA_CHANNEL ?? "hospital-whatsapp"
const channelExisted = Boolean(await getChannel(organizationId, CHANNEL_ID))
const channel = channelExisted
  ? (await updateChannel(organizationId, CHANNEL_ID, {
      defaultAgentId: agent.id,
    }))!
  : await createChannel(organizationId, {
      id: CHANNEL_ID,
      name: "Hospital WhatsApp",
      kind: "whatsapp",
      defaultAgentId: agent.id,
    })

await ensurePlaygroundChannel(organizationId)

console.log(
  `${existing ? "updated" : "created"} agent "${agent.name}" (${agent.id})`
)
console.log(`  connector: ${slug} → connection ${connectionName}`)
console.log(
  `${channelExisted ? "updated" : "created"} channel "${channel.name}" (${channel.id}) → default agent ${agent.id}`
)
if (!Object.keys(credentialEnv).length) {
  console.log(
    "  credentials: none (set HMS_CREDENTIAL_ENV for a real connector)"
  )
}
console.log(
  `\nTry it:  bun run try-turn ${agent.id} "hi, I need to see a doctor"`
)
