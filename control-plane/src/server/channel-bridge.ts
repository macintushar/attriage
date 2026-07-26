import type { DirectMessageHandler, MessageHandler } from "chat"
import type { BaileysAdapter } from "chat-adapter-baileys"
import type { ConnectionState } from "baileys"

type WhatsAppBot = {
  onDirectMessage: (handler: DirectMessageHandler) => void
  onNewMessage: (pattern: RegExp, handler: MessageHandler) => void
}

type ConnectionListener = (update: Partial<ConnectionState>) => void

type AdapterInternals = {
  _socket: {
    ev: {
      on: (event: "connection.update", listener: ConnectionListener) => void
    }
  } | null
  _createSocket: () => Promise<void>
}

/**
 * Chat SDK routes direct messages before regex message handlers. Register the
 * same pipeline for both DMs and non-DM threads (for example WhatsApp groups).
 */
export function registerWhatsAppMessageHandler(
  bot: WhatsAppBot,
  handler: MessageHandler
) {
  bot.onDirectMessage((thread, message) => handler(thread, message))
  bot.onNewMessage(/[\s\S]*/, handler)
}

/**
 * The Baileys adapter owns reconnection but does not currently expose its
 * connection.update events. Wrap its socket factory so every initial or
 * replacement socket reports its real lifecycle to the control plane.
 *
 * Keep this compatibility shim isolated: if the adapter removes these
 * internals, connecting fails visibly instead of leaving the UI in "pairing".
 */
export function observeBaileysLifecycle(
  adapter: BaileysAdapter,
  listener: ConnectionListener
) {
  const internals = adapter as unknown as AdapterInternals
  if (typeof internals._createSocket !== "function") {
    throw new Error(
      "installed Baileys adapter does not expose a connection lifecycle"
    )
  }

  const createSocket = internals._createSocket.bind(adapter)
  internals._createSocket = async () => {
    await createSocket()
    if (!internals._socket) {
      throw new Error("Baileys adapter created no WhatsApp socket")
    }
    internals._socket.ev.on("connection.update", listener)
  }
}

export function phoneFromWhatsAppJid(jid: string | undefined) {
  const phone = jid?.split("@", 1)[0]?.split(":", 1)[0]
  return phone ? `+${phone}` : undefined
}

export function disconnectStatusCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const output = (error as { output?: unknown }).output
  if (!output || typeof output !== "object") return undefined
  const statusCode = (output as { statusCode?: unknown }).statusCode
  return typeof statusCode === "number" ? statusCode : undefined
}
