import { describe, expect, it, vi } from "vitest"

import { oggOpusFixture } from "./audio.test-fixture"
import {
  disconnectStatusCode,
  observeBaileysLifecycle,
  phoneFromWhatsAppJid,
  registerWhatsAppMessageHandler,
  sendWhatsAppVoiceNote,
} from "./channel-bridge"

describe("registerWhatsAppMessageHandler", () => {
  it("registers the pipeline for direct messages and non-DM threads", async () => {
    const directHandlers: ((thread: unknown, message: unknown) => unknown)[] =
      []
    const patternHandlers: {
      pattern: RegExp
      handler: (thread: unknown, message: unknown) => unknown
    }[] = []
    const bot = {
      onDirectMessage: (
        handler: (thread: unknown, message: unknown) => unknown
      ) => {
        directHandlers.push(handler)
      },
      onNewMessage: (
        pattern: RegExp,
        handler: (thread: unknown, message: unknown) => unknown
      ) => {
        patternHandlers.push({ pattern, handler })
      },
    }
    const handler = vi.fn()

    registerWhatsAppMessageHandler(
      bot as unknown as Parameters<typeof registerWhatsAppMessageHandler>[0],
      handler
    )

    expect(directHandlers).toHaveLength(1)
    expect(patternHandlers).toHaveLength(1)
    expect(patternHandlers[0]?.pattern.test("")).toBe(true)

    await directHandlers[0]?.("dm-thread", "hello")
    expect(handler).toHaveBeenCalledWith("dm-thread", "hello")
  })
})

describe("observeBaileysLifecycle", () => {
  it("observes the initial socket and every reconnect socket", async () => {
    const socketListeners: ((update: { connection: string }) => void)[][] = []
    const adapter = {
      _socket: null as null | {
        ev: {
          on: (
            event: "connection.update",
            listener: (update: { connection: string }) => void
          ) => void
        }
      },
      _createSocket: async function () {
        const listeners: ((update: { connection: string }) => void)[] = []
        socketListeners.push(listeners)
        this._socket = {
          ev: {
            on: (event, listener) => {
              expect(event).toBe("connection.update")
              listeners.push(listener)
            },
          },
        }
      },
    }
    const listener = vi.fn()

    observeBaileysLifecycle(
      adapter as unknown as Parameters<typeof observeBaileysLifecycle>[0],
      listener
    )

    await adapter._createSocket()
    await adapter._createSocket()
    socketListeners[0]?.[0]?.({ connection: "connecting" })
    socketListeners[1]?.[0]?.({ connection: "open" })

    expect(listener).toHaveBeenNthCalledWith(1, { connection: "connecting" })
    expect(listener).toHaveBeenNthCalledWith(2, { connection: "open" })
  })

  it("fails clearly when the installed adapter lifecycle changes", () => {
    expect(() =>
      observeBaileysLifecycle(
        {} as Parameters<typeof observeBaileysLifecycle>[0],
        vi.fn()
      )
    ).toThrow("does not expose a connection lifecycle")
  })
})

describe("Baileys connection helpers", () => {
  it("formats the paired number without its device suffix", () => {
    expect(phoneFromWhatsAppJid("919876543210:7@s.whatsapp.net")).toBe(
      "+919876543210"
    )
  })

  it("reads Boom-compatible disconnect status codes", () => {
    expect(disconnectStatusCode({ output: { statusCode: 401 } })).toBe(401)
    expect(disconnectStatusCode(new Error("closed"))).toBeUndefined()
  })
})

describe("sendWhatsAppVoiceNote", () => {
  it("sends an ogg attachment as a push-to-talk voice note", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ key: { id: "reply" } })
    const adapter = {
      _socket: { sendMessage },
      decodeThreadId: vi
        .fn()
        .mockReturnValue({ jid: "919876543210@s.whatsapp.net" }),
    }
    const audio = oggOpusFixture({ seconds: 3 })

    await sendWhatsAppVoiceNote(
      adapter as unknown as Parameters<typeof sendWhatsAppVoiceNote>[0],
      "channel-patient:peer",
      audio
    )

    expect(adapter.decodeThreadId).toHaveBeenCalledWith("channel-patient:peer")
    expect(sendMessage).toHaveBeenCalledWith("919876543210@s.whatsapp.net", {
      audio,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
      seconds: 3,
    })
  })

  it("fails clearly instead of silently dropping audio when disconnected", async () => {
    await expect(
      sendWhatsAppVoiceNote(
        {
          _socket: null,
        } as unknown as Parameters<typeof sendWhatsAppVoiceNote>[0],
        "channel-patient:peer",
        oggOpusFixture({ seconds: 3 })
      )
    ).rejects.toThrow("WhatsApp socket is not connected")
  })

  it("rejects mislabeled bytes before attempting an upload", async () => {
    const sendMessage = vi.fn()
    await expect(
      sendWhatsAppVoiceNote(
        {
          _socket: { sendMessage },
        } as unknown as Parameters<typeof sendWhatsAppVoiceNote>[0],
        "channel-patient:peer",
        Buffer.from("not ogg")
      )
    ).rejects.toThrow("not an Ogg/Opus attachment")
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
