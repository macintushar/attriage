import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"

import { env, requireSarvamKey } from "./env"
import { log } from "./logger"

/**
 * A local OpenAI-compatible endpoint that adapts Pi's requests to Sarvam's.
 *
 * Two reasons this exists:
 *
 * 1. **Sarvam requires `content` to be a plain string.** Pi sends OpenAI's
 *    content-parts array (`[{type:"text",text:"…"}]`), and Sarvam rejects it
 *    with `body.messages.N.user.content : Input should be a valid string`.
 *    Pi has no `compat` flag to flatten it, so we do it here.
 * 2. **The sandbox never sees the API key.** The container talks to this shim
 *    over host.docker.internal; the key stays in the backend process. That
 *    matters because the agent executes its own shell commands — anything in
 *    its environment is effectively readable by the model.
 */

interface ChatMessage {
  role: string
  content?: unknown
  tool_calls?: unknown
  [key: string]: unknown
}

/** `[{type:"text",text:"a"},…]` → `"a…"`. Leaves plain strings alone. */
function flattenContent(content: unknown): unknown {
  if (typeof content === "string" || content == null) return content
  if (!Array.isArray(content)) return content

  const text = content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object") {
        const p = part as { type?: string; text?: string }
        if (typeof p.text === "string") return p.text
      }
      return ""
    })
    .join("")

  // An assistant message that is purely tool calls legitimately has no text;
  // sending "" is safer than null for a server that wants a string.
  return text
}

function normalize(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as ChatMessage[] | undefined) ?? []
  return {
    ...body,
    messages: messages.map((message) => {
      const next: ChatMessage = {
        ...message,
        content: flattenContent(message.content),
      }
      // Sarvam rejects a null content on messages that carry tool_calls too.
      if (next.content == null && next.tool_calls) next.content = ""
      return next
    }),
  }
}

const SHIM_KEY = Symbol.for("sarvam-control-plane.shim")
const globals = globalThis as typeof globalThis & {
  [SHIM_KEY]?: Server
}

async function readJson(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
) {
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "not found" }))
    return
  }

  const body = await readJson(request)
  const upstream = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-subscription-key": requireSarvamKey(),
    },
    body: JSON.stringify(normalize(body)),
  })

  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  })
  if (upstream.body) {
    for await (const chunk of upstream.body) response.write(chunk)
  }
  response.end()
}

export function startSarvamShim(): Server {
  if (globals[SHIM_KEY]) return globals[SHIM_KEY]

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined)
        return
      }
      response.writeHead(500, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      )
    })
  })
  server.on("error", (error: NodeJS.ErrnoException) => {
    // A second dev server may already own the private shim port.
    if (error.code !== "EADDRINUSE") {
      log.error("sarvam_shim.failed", { error })
    }
  })
  server.listen(env.shimPort, "0.0.0.0")
  globals[SHIM_KEY] = server
  return server
}

export function stopSarvamShim() {
  const server = globals[SHIM_KEY]
  if (server?.listening) server.close()
  delete globals[SHIM_KEY]
}
