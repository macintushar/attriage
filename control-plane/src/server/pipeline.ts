import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"

import { runTurn } from "./agent-runner"
import { audioDuration } from "./audio"
import { insertMessage, patchMessage, touchSession } from "./db"
import { emitRun } from "./events"
import { peerLabel } from "./routing"
import { ensureContainer } from "./sandbox"
import { speak, transcribeFile } from "./sarvam"
import { STAGE_DEFS, channelService } from "./types"
import type {
  AgentRecord,
  ChannelRecord,
  ChatMessage,
  PipelineRun,
  SessionRecord,
  Stage,
  StageId,
} from "./types"

let runCounter = Date.now()

export interface PipelineInput {
  kind: "text" | "voice"
  text?: string
  /** Voice only. Already-downloaded audio bytes. */
  audio?: Buffer
  mimeType?: string
  /** Voice only, WhatsApp path: fetches the media lazily (URLs expire fast). */
  fetchAudio?: () => Promise<Buffer>
  audioSeconds?: number
}

export interface Delivery {
  /** Send the reply. `audio` is present only when the agent has voice enabled. */
  send: (text: string, audio: Buffer | null) => Promise<void>
}

export interface PipelineContext {
  channel: ChannelRecord
  session: SessionRecord
  agent: AgentRecord
  input: PipelineInput
  delivery: Delivery
}

/**
 * The single path every message takes, whether it arrived over WhatsApp or was
 * typed into the playground. Keeping them on one path is deliberate: a
 * playground that diverges from production is worse than no playground.
 *
 * The caller has already resolved which channel, session and agent this turn
 * belongs to — routing is a separate concern from running the turn.
 */
export async function runPipeline({
  channel,
  session,
  agent,
  input,
  delivery,
}: PipelineContext): Promise<void> {
  const runId = ++runCounter
  const isVoice = input.kind === "voice"

  // Three audiences watch a run: the session's own page, the channel's live
  // feed, and the agent playground. One emit reaches all of them.
  const topics = [
    `session:${session.id}`,
    `channel:${channel.id}`,
    `agent:${agent.id}`,
  ]

  const transport = channelService(channel.kind, channel.name)
  const stages: Stage[] = STAGE_DEFS.map((def) => ({
    ...def,
    service: def.service === "Channel" ? transport : def.service,
    status: def.voiceOnly && !isVoice ? "skipped" : "idle",
  }))

  const run: PipelineRun = {
    id: runId,
    kind: input.kind,
    stages,
    startedAt: Date.now(),
  }
  emitRun(topics, { type: "run_start", run })

  const stageStarted = new Map<StageId, number>()
  const emitStage = (id: StageId, patch: Partial<Stage>) => {
    const stage = stages.find((s) => s.id === id)
    if (!stage) return
    Object.assign(stage, patch)
    emitRun(topics, { type: "stage", runId, stage: { ...stage } })
  }
  const begin = (id: StageId) => {
    stageStarted.set(id, Date.now())
    emitStage(id, { status: "running" })
  }
  const finish = (id: StageId, detail?: string) => {
    emitStage(id, {
      status: "done",
      detail,
      ms: Date.now() - (stageStarted.get(id) ?? Date.now()),
    })
  }
  const fail = (id: StageId, detail: string) => {
    emitStage(id, {
      status: "error",
      detail,
      ms: Date.now() - (stageStarted.get(id) ?? Date.now()),
    })
  }

  try {
    // ── receive ──────────────────────────────────────────────────────────────
    begin("receive")
    touchSession(session.id, { agentId: agent.id })
    finish(
      "receive",
      `${input.kind} message from ${peerLabel(session.peerJid)} → ${agent.name}`
    )

    // ── download (voice only) ────────────────────────────────────────────────
    let audio = input.audio ?? null
    if (isVoice) {
      begin("download")
      if (!audio && input.fetchAudio) audio = await input.fetchAudio()
      if (!audio) {
        fail("download", "no audio data")
        throw new Error("voice message had no audio")
      }
      finish(
        "download",
        `${Math.round(audio.byteLength / 1024)} KB · ${input.mimeType ?? "audio/ogg"}`
      )
    }

    // Persist the inbound message before transcribing, so the UI can render the
    // bubble immediately and back-patch the transcript when STT lands.
    const mediaDir = `${session.workdir}/media`
    mkdirSync(mediaDir, { recursive: true })

    let audioPath: string | null = null
    if (audio) {
      audioPath = `${mediaDir}/in-${runId}.ogg`
      await writeFile(audioPath, audio)
    }

    // Measured from the bytes, not from what the sender claimed: WhatsApp and
    // the TTS reply report nothing at all, so the file is the only common source.
    const userAudioSeconds = audio
      ? audioDuration(audio, input.audioSeconds)
      : undefined

    const userMessageId = insertMessage({
      sessionId: session.id,
      role: "user",
      kind: input.kind,
      text: input.text ?? "",
      audioPath,
      audioSeconds: userAudioSeconds,
    })
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      kind: input.kind,
      text: input.text ?? "",
      audioSeconds: userAudioSeconds,
      createdAt: Date.now(),
    }
    emitRun(topics, { type: "message", message: userMessage })

    // ── stt (voice only) ─────────────────────────────────────────────────────
    let userText = input.text ?? ""
    let detectedLanguage: string | null = null
    if (isVoice && audioPath) {
      begin("stt")
      const result = await transcribeFile(
        audioPath,
        input.mimeType ?? "audio/ogg",
        agent.language
      )
      userText = result.transcript
      detectedLanguage = result.languageCode
      patchMessage(userMessageId, { transcript: userText })
      emitRun(topics, {
        type: "message_patch",
        id: userMessageId,
        patch: { transcript: userText },
      })
      finish(
        "stt",
        `${detectedLanguage ?? "unknown"} · "${userText.slice(0, 120)}"`
      )
    }

    if (!userText.trim()) {
      throw new Error("nothing to send to the agent (empty message)")
    }

    // ── sandbox ──────────────────────────────────────────────────────────────
    // Starting the container is the slow part of a cold turn, so it gets its own
    // stage rather than hiding inside "receive" where nobody can see it.
    begin("sandbox")
    const ready = await ensureContainer(session, agent)
    touchSession(session.id, { status: "running" })
    finish("sandbox", `container ${ready.containerId}`)

    // ── agent ────────────────────────────────────────────────────────────────
    begin("agent")
    const agentStage = stages.find((s) => s.id === "agent")!
    agentStage.steps = []

    const result = await runTurn(ready, agent, userText, (step) => {
      const existing = agentStage.steps!.findIndex((s) => s.id === step.id)
      if (existing >= 0) agentStage.steps![existing] = step
      else agentStage.steps!.push(step)
      emitRun(topics, { type: "step", runId, step })
    })

    touchSession(session.id, { status: "idle" })

    if (result.error && !result.text) {
      fail("agent", result.error)
      throw new Error(result.error)
    }
    finish(
      "agent",
      `${result.steps.length} tool call${result.steps.length === 1 ? "" : "s"} · ${result.text.length} chars` +
        (result.costUsd ? ` · $${result.costUsd.toFixed(4)}` : "")
    )

    // ── tts (voice only) ─────────────────────────────────────────────────────
    let replyAudio: Buffer | null = null
    if (isVoice && agent.voice) {
      begin("tts")
      try {
        replyAudio = await speak(
          result.text,
          detectedLanguage ?? agent.language,
          agent.ttsSpeaker
        )
        const seconds = audioDuration(replyAudio)
        finish(
          "tts",
          `${agent.ttsSpeaker} · ${Math.round(replyAudio.byteLength / 1024)} KB opus` +
            (seconds ? ` · ${seconds}s` : "")
        )
      } catch (error) {
        // A TTS failure must not cost the patient their text reply.
        fail("tts", error instanceof Error ? error.message : String(error))
      }
    }

    const replyPath = replyAudio ? `${mediaDir}/out-${runId}.ogg` : null
    if (replyAudio && replyPath) await writeFile(replyPath, replyAudio)

    const replySeconds = replyAudio ? audioDuration(replyAudio) : undefined

    const agentMessageId = insertMessage({
      sessionId: session.id,
      role: "agent",
      kind: replyAudio ? "voice" : "text",
      text: result.text,
      audioPath: replyPath,
      audioSeconds: replySeconds,
    })
    emitRun(topics, {
      type: "message",
      message: {
        id: agentMessageId,
        role: "agent",
        kind: replyAudio ? "voice" : "text",
        text: result.text,
        audioSeconds: replySeconds,
        audioUrl: replyPath
          ? `/api/media/${session.id}/out-${runId}.ogg`
          : undefined,
        createdAt: Date.now(),
      },
    })

    // ── send ─────────────────────────────────────────────────────────────────
    begin("send")
    await delivery.send(result.text, replyAudio)
    finish("send", replyAudio ? "text + voice reply" : "text reply")

    emitRun(topics, {
      type: "run_end",
      runId,
      totalMs: Date.now() - run.startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitRun(topics, { type: "error", runId, message })
    emitRun(topics, {
      type: "run_end",
      runId,
      totalMs: Date.now() - run.startedAt,
    })
    // A failed turn must not leave the session marked "running", or the reaper
    // will refuse to ever clean up its container.
    touchSession(session.id, { status: "idle" })
    throw error
  }
}
