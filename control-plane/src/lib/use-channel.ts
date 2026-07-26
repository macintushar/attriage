import { useCallback, useEffect, useRef, useState } from "react"

import type { ChannelStatus } from "./channels-store"

type ChannelEvent =
  | { type: "hello" }
  | { type: "qr"; dataUrl: string }
  | { type: "status"; status: ChannelStatus; phone?: string; error?: string }
  | {
      type: "session"
      sessionId: string
      peerJid: string
      agentId: string | null
    }

/**
 * Pairing state for one channel.
 *
 * The QR arrives over SSE as a data URL — the adapter hands us the raw QR
 * payload via its `onQR` callback and the backend renders it, so pairing
 * happens in the browser instead of a terminal.
 *
 * `onNewSession` fires when a peer nobody has seen before writes in, which is
 * the moment the sessions list becomes stale.
 */
export function useChannel(
  channelId: string | undefined,
  onNewSession?: () => void
) {
  const [status, setStatus] = useState<ChannelStatus>("disconnected")
  const [qr, setQr] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Held in a ref so a fresh callback identity on every parent render doesn't
  // tear down and reopen the SSE stream.
  const onNewSessionRef = useRef(onNewSession)
  onNewSessionRef.current = onNewSession

  useEffect(() => {
    if (!channelId) return
    const source = new EventSource(`/api/channels/${channelId}/connect`)
    source.onmessage = (raw) => {
      let event: ChannelEvent
      try {
        event = JSON.parse(raw.data) as ChannelEvent
      } catch {
        return
      }
      if (event.type === "qr") {
        setQr(event.dataUrl)
        setStatus("pairing")
      } else if (event.type === "status") {
        setStatus(event.status)
        if (event.phone) setPhone(event.phone)
        setError(event.error ?? null)
        // Once paired the QR is spent; keep it on screen only while pairing.
        if (event.status !== "pairing") setQr(null)
      } else if (event.type === "session") {
        onNewSessionRef.current?.()
      }
    }
    return () => source.close()
  }, [channelId])

  const connect = useCallback(async () => {
    if (!channelId) return
    setError(null)
    setStatus("pairing")
    const res = await fetch(`/api/channels/${channelId}/connect`, {
      method: "POST",
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `failed to start pairing (${res.status})`)
      setStatus("disconnected")
    }
  }, [channelId])

  const disconnect = useCallback(async () => {
    if (!channelId) return
    await fetch(`/api/channels/${channelId}/connect`, { method: "DELETE" })
    setStatus("disconnected")
    setQr(null)
  }, [channelId])

  return { status, qr, phone, error, connect, disconnect }
}
