/**
 * A stub OpenAI-compatible model, for proving the agent loop without a Sarvam key.
 *
 *   bun run mock-llm            # listens on :8899
 *   AGENT_PROVIDER=mock AGENT_MODEL=mock-105b bun run try-turn <agent> "hi"
 *
 * It drives a deliberately realistic script: inspect the connector, then perform
 * a real pm write (stage JSONL → plan → preview → run --approve), then answer.
 * Everything it exercises — streaming tool calls, tool results fed back, usage
 * accounting, the final assistant message — is the same machinery Sarvam-105B
 * will drive. Only the prose differs.
 */
const PORT = Number(process.env.MOCK_LLM_PORT ?? 8899)

interface ChatMessage {
  role: string
  content?: unknown
  tool_calls?: unknown[]
}

const WRITE_SCRIPT = `set -e
cd "$PM_PROJECT_DIR"
mkdir -p .polymetrics/warehouse
cat > .polymetrics/warehouse/patient_intake.jsonl <<'JSON'
{"name":"Asha Menon","age":34,"sex":"F","phone":"+919876500000","symptoms":"chest tightness climbing stairs","specialty":"cardiology"}
JSON
PLAN=$(pm reverse plan sync --source-table patient_intake --destination outbox:outbox-main \\
  --map name:name --map age:age --map sex:sex --map phone:phone \\
  --map symptoms:symptoms --map specialty:specialty 2>&1)
echo "$PLAN"
PLAN_ID=$(echo "$PLAN" | grep -oE 'rplan_[a-z0-9]+' | head -1)
TOKEN=$(echo "$PLAN" | grep -oE '[a-f0-9]{32,}' | head -1)
pm reverse preview "$PLAN_ID"
pm reverse run "$PLAN_ID" --approve "$TOKEN"`

/** Streaming chunk helpers — Pi consumes this as SSE. */
function chunk(delta: unknown, finish: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-105b",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

function usageChunk() {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    model: "mock-105b",
    choices: [],
    usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
  })}\n\n`
}

function toolCallStream(id: string, command: string): string {
  return (
    chunk({ role: "assistant", content: null }) +
    chunk({
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name: "bash", arguments: "" },
        },
      ],
    }) +
    chunk({
      tool_calls: [
        {
          index: 0,
          function: { arguments: JSON.stringify({ command }) },
        },
      ],
    }) +
    chunk({}, "tool_calls") +
    usageChunk() +
    "data: [DONE]\n\n"
  )
}

function textStream(text: string): string {
  let out = chunk({ role: "assistant", content: "" })
  for (const word of text.split(/(?<= )/)) out += chunk({ content: word })
  return out + chunk({}, "stop") + usageChunk() + "data: [DONE]\n\n"
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (!url.pathname.endsWith("/chat/completions")) {
      return Response.json({ error: "not found" }, { status: 404 })
    }

    const body = (await request.json()) as { messages?: ChatMessage[] }
    const messages = body.messages ?? []
    // How many tool results have come back tells us where we are in the script.
    const toolTurns = messages.filter((m) => m.role === "tool").length

    let payload: string
    if (toolTurns === 0) {
      payload = toolCallStream("call_inspect", "pm connectors inspect outbox")
    } else if (toolTurns === 1) {
      payload = toolCallStream("call_write", WRITE_SCRIPT)
    } else {
      payload = textStream(
        "Done — I've booked Asha Menon with cardiology and saved the intake record. " +
          "She'll get a confirmation with the doctor, date and time."
      )
    }

    console.log(`→ turn with ${toolTurns} tool result(s)`)
    return new Response(payload, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    })
  },
})

console.log(`mock LLM on http://localhost:${server.port}/v1`)
