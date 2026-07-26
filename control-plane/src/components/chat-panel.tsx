import { memo, useEffect, useRef, useState } from "react"
import {
  IconCheck,
  IconChecks,
  IconDotsVertical,
  IconMicrophone,
  IconPhone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconSend2,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/agent-run"

interface ChatPanelProps {
  agentName?: string
  voiceEnabled?: boolean
  messages: ChatMessage[]
  isBusy: boolean
  error?: string | null
  onSendText: (text: string) => void
  onSendVoice: (blob: Blob, seconds?: number) => void
  /** Transcript only — used when a session has no agent to send to. */
  readOnly?: boolean
  readOnlyReason?: string
}

/** Prefers ogg/opus, which both Saaras STT and WhatsApp take natively. */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return ""
  for (const type of [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ""
}

export const ChatPanel = memo(function ChatPanel({
  agentName = "Agent",
  voiceEnabled = true,
  messages,
  isBusy,
  error,
  onSendText,
  onSendVoice,
  readOnly = false,
  readOnlyReason = "No agent assigned",
}: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const [recording, setRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startedAtRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Depends on the last message's identity too, so the STT transcript
  // back-patch (which doesn't change length) still scrolls into view.
  const lastId = messages.at(-1)?.id
  const lastTranscript = messages.at(-1)?.transcript
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages.length, lastId, lastTranscript, recording])

  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const submitText = () => {
    if (!draft.trim() || isBusy || recording) return
    onSendText(draft)
    setDraft("")
  }

  const startRecording = async () => {
    if (isBusy || recording) return
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      )
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const seconds = (Date.now() - startedAtRef.current) / 1000
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/ogg",
        })
        recorderRef.current = null
        setRecording(false)
        if (blob.size > 0) onSendVoice(blob, seconds)
      }

      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setRecording(true)
      recorder.start()
    } catch (e) {
      setMicError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Couldn't start recording."
      )
    }
  }

  const stopRecording = () => recorderRef.current?.stop()

  return (
    <div className="flex h-[32rem] w-full shrink-0 flex-col overflow-hidden rounded-3xl border shadow-lg lg:h-full lg:w-[380px]">
      {/* Header */}
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <div className="flex size-9 items-center justify-center rounded-full bg-white/15">
          <IconSparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{agentName}</div>
          <div className="truncate text-xs text-white/75">
            {isBusy ? "typing…" : "online · powered by Sarvam"}
          </div>
        </div>
        <IconVideo className="size-5 text-white/85" />
        <IconPhone className="size-5 text-white/85" />
        <IconDotsVertical className="size-5 text-white/85" />
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto bg-[#ece5dd] px-3 py-4"
      >
        {messages.length === 0 && (
          <div className="px-8 pt-16 text-center text-sm text-neutral-500">
            {voiceEnabled
              ? "Send a text, or hold the mic to record a voice note. Both take the same path as a real WhatsApp message."
              : "Send a text message to start a run."}
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {recording && (
          <div className="flex justify-end">
            <div className="flex items-center gap-2 rounded-xl bg-[#d9fdd3] px-3 py-2 text-xs text-neutral-500 shadow-sm">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              Recording — tap the square to send
            </div>
          </div>
        )}
        {(error || micError) && (
          <div className="mx-auto w-fit max-w-[90%] rounded-lg bg-red-50 px-3 py-1.5 text-center text-[11px] text-red-700 shadow-sm">
            {micError ?? error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 bg-[#f0f0f0] px-3 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitText()}
          placeholder={
            readOnly
              ? readOnlyReason
              : recording
                ? "Recording voice note…"
                : isBusy
                  ? "Agent is replying…"
                  : "Type a message"
          }
          disabled={readOnly || isBusy || recording}
          className="h-10 flex-1 rounded-full bg-white px-4 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
        />
        {recording ? (
          <button
            onClick={stopRecording}
            className="flex size-10 animate-pulse items-center justify-center rounded-full bg-red-500 text-white transition-transform active:scale-95"
            aria-label="Stop recording and send"
          >
            <IconPlayerPauseFilled className="size-5" />
          </button>
        ) : draft.trim() || !voiceEnabled ? (
          <button
            onClick={submitText}
            disabled={readOnly || isBusy || !draft.trim()}
            className="flex size-10 items-center justify-center rounded-full bg-[#075e54] text-white transition-transform active:scale-95 disabled:opacity-50"
            aria-label="Send message"
          >
            <IconSend2 className="size-5" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            disabled={readOnly || isBusy}
            className="flex size-10 items-center justify-center rounded-full bg-[#075e54] text-white transition-transform active:scale-95 disabled:opacity-50"
            aria-label="Record voice note"
          >
            <IconMicrophone className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
})

/** Exported so read-only views (the channel transcript) render identical bubbles. */
export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 shadow-sm",
          isUser ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
        )}
      >
        {message.text && (
          <p className="text-sm break-words whitespace-pre-wrap text-neutral-800">
            {message.text}
          </p>
        )}
        {message.kind === "voice" && <VoiceNote message={message} />}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-neutral-400">
          {formatTime(message.createdAt)}
          {isUser && <IconChecks className="size-3.5 text-sky-500" />}
          {!isUser && <IconCheck className="size-3.5 opacity-0" />}
        </div>
      </div>
    </div>
  )
}

export function VoiceNote({ message }: { message: ChatMessage }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const bars = Array.from(
    { length: 26 },
    (_, i) => 6 + ((i * 7 + message.id * 13) % 14)
  )

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else void audio.play()
  }

  return (
    <div className="w-56">
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          disabled={!message.audioUrl}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#075e54] text-white disabled:opacity-40"
          aria-label={playing ? "Pause voice note" : "Play voice note"}
        >
          {playing ? (
            <IconPlayerPauseFilled className="size-4" />
          ) : (
            <IconPlayerPlayFilled className="size-4" />
          )}
        </button>
        <div className="flex h-8 flex-1 items-center gap-[2px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] rounded-full",
                playing ? "bg-[#075e54]" : "bg-neutral-400"
              )}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <span className="text-xs text-neutral-500 tabular-nums">
          {formatDuration(message.audioSeconds)}
        </span>
      </div>
      {message.audioUrl && (
        <audio
          ref={audioRef}
          src={message.audioUrl}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
      {message.transcript && (
        <p className="mt-1.5 border-t border-neutral-200 pt-1.5 text-xs text-neutral-500 italic">
          {message.transcript}
        </p>
      )}
    </div>
  )
}

/** Handles durations past 59s, which the old `0:SS` format broke on. */
function formatDuration(seconds: number | undefined) {
  const total = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${
    d.getHours() >= 12 ? "PM" : "AM"
  }`
}
