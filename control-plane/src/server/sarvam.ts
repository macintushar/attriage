import { spawn } from "node:child_process"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import type { Readable } from "node:stream"

import { oggOpusDuration } from "./audio"
import { requireSarvamKey } from "./env"
import { log } from "./logger"

const BASE = "https://api.sarvam.ai"

/** Sarvam returns 403 (not 401) for a bad or missing key. */
export class SarvamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message)
    this.name = "SarvamError"
  }
}

/** Pulls Sarvam's human-readable message out of its error envelope. */
function reason(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
      message?: string
      detail?: unknown
    }
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : (parsed.error?.message ??
          parsed.message ??
          (parsed.detail ? JSON.stringify(parsed.detail) : ""))
    if (message) return `— ${message}`
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return body ? `— ${body.slice(0, 300)}` : ""
}

async function call(
  path: string,
  init: RequestInit,
  attempt = 0
): Promise<Response> {
  const startedAt = performance.now()
  log.info("sarvam.request.started", {
    path,
    method: init.method ?? "GET",
    attempt,
  })
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "api-subscription-key": requireSarvamKey(),
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    log.error("sarvam.request.failed", {
      path,
      attempt,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    })
    throw error
  }
  log.info("sarvam.request.completed", {
    path,
    attempt,
    status: res.status,
    durationMs: Math.round(performance.now() - startedAt),
  })

  // Starter tier is 40 rpm on chat and 30 rpm on bulbul:v3, so 429s are a
  // realistic demo-day failure rather than a theoretical one.
  if (res.status === 429 && attempt < 3) {
    const wait =
      Number(res.headers.get("retry-after") ?? 0) * 1000 || 2 ** attempt * 1000
    log.warn("sarvam.request.retrying", { path, attempt, waitMs: wait })
    await delay(wait)
    return call(path, init, attempt + 1)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.error("sarvam.response.error", {
      path,
      status: res.status,
      bodyChars: body.length,
    })
    const hint = res.status === 403 ? " (403 = bad/missing SARVAM_API_KEY)" : ""
    // The body is the only thing that says *why* a 400 happened, and this
    // message is all that reaches the trace and the log. Omitting it turned a
    // one-line fix ("sample rate 22050 unsupported") into a blind hunt.
    throw new SarvamError(
      `sarvam ${path} failed: ${res.status}${hint} ${reason(body)}`.trim(),
      res.status,
      body
    )
  }
  return res
}

export interface Transcription {
  transcript: string
  languageCode: string | null
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString()
}

function exitCode(proc: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => resolve(code ?? 1))
  })
}

/**
 * Sarvam validates the upload's content type by exact string match, so a codec
 * parameter rejects a container it otherwise accepts: `audio/ogg` is on its
 * allowlist, `audio/ogg; codecs=opus` is not. Both WhatsApp and the browser's
 * MediaRecorder label opus that way, so stripping parameters is what makes the
 * inbound voice leg work at all.
 */
export function sarvamMimeType(mimeType: string | undefined): string {
  const base = mimeType?.split(";", 1)[0]?.trim().toLowerCase()
  return base || "audio/ogg"
}

/** File extension Sarvam should see, derived from the (normalised) type. */
function uploadName(mimeType: string): string {
  const subtype = mimeType.split("/", 2)[1] ?? "ogg"
  const extension = { mpeg: "mp3", "x-m4a": "m4a", "x-wav": "wav" }[subtype]
  return `audio.${extension ?? subtype}`
}

/**
 * saaras:v3 accepts WhatsApp's ogg/opus directly, so the inbound leg needs no
 * transcode — but it hard-caps at 30 seconds, hence the chunking below.
 */
async function transcribeOne(
  audio: Buffer,
  mimeType: string,
  language: string
): Promise<Transcription> {
  const type = sarvamMimeType(mimeType)
  const form = new FormData()
  form.append("model", "saaras:v3")
  form.append("mode", "transcribe")
  form.append(
    "language_code",
    language && language !== "auto" ? language : "unknown"
  )
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type }),
    uploadName(type)
  )

  const res = await call("/speech-to-text", { method: "POST", body: form })
  const json = (await res.json()) as {
    transcript?: string
    language_code?: string | null
  }
  return {
    transcript: json.transcript ?? "",
    languageCode: json.language_code ?? null,
  }
}

/**
 * Duration of an audio file, or null if it can't be determined.
 *
 * Reads the Ogg stream directly rather than shelling out to ffprobe: ffprobe is
 * usually not installed, so the probe returned null for every file and the 30s
 * chunking gate below never fired. Falls back to ffprobe for containers the
 * parser doesn't handle (WebM from a browser without ogg support).
 */
export async function audioDurationSeconds(
  path: string
): Promise<number | null> {
  const parsed = oggOpusDuration(await readFile(path))
  if (parsed !== null) return parsed

  try {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    )
    const [out] = await Promise.all([streamText(proc.stdout), exitCode(proc)])
    const seconds = Number.parseFloat(out.trim())
    return Number.isFinite(seconds) ? seconds : null
  } catch {
    return null
  }
}

const CHUNK_SECONDS = 25

/**
 * Transcribes an audio file, splitting with ffmpeg when it exceeds the 30s API
 * cap. If ffmpeg is unavailable we send the whole file and let Sarvam reject
 * it, which produces a clearer error than silently truncating.
 *
 * ffmpeg is the *only* thing voice needs it for — a note under 30 seconds, which
 * is nearly all of them, goes straight through untranscoded.
 */
export async function transcribeFile(
  path: string,
  mimeType: string,
  language: string
): Promise<Transcription> {
  const duration = await audioDurationSeconds(path)
  const audio = await readFile(path)

  if (duration === null || duration <= 29) {
    return transcribeOne(audio, mimeType, language)
  }

  const dir = `${path}.chunks`
  await mkdir(dir, { recursive: true })
  const split = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-c",
      "copy",
      `${dir}/part-%03d.ogg`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  )
  const splitError = streamText(split.stderr)
  if ((await exitCode(split)) !== 0) {
    await splitError
    // Splitting failed — fall back to one request and surface Sarvam's error.
    return transcribeOne(audio, mimeType, language)
  }
  await splitError

  const parts = (await readdir(dir))
    .filter((name) => /^part-\d+\.ogg$/.test(name))
    .sort()
  const results = await Promise.all(
    parts.map(async (name) =>
      transcribeOne(await readFile(`${dir}/${name}`), mimeType, language)
    )
  )
  return {
    transcript: results
      .map((r) => r.transcript.trim())
      .filter(Boolean)
      .join(" "),
    languageCode: results.find((r) => r.languageCode)?.languageCode ?? null,
  }
}

/** bulbul:v3 languages — narrower than STT's 23. Anything else falls back. */
const TTS_LANGS = new Set([
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
])

const TTS_MAX_CHARS = 2500

/** Opus is always 48 kHz internally; anything else is a resample. */
const OPUS_SAMPLE_RATE = 48_000

export function ttsLanguage(code: string | null | undefined): string {
  if (code && TTS_LANGS.has(code)) return code
  return "en-IN"
}

/**
 * Markdown is written to be seen, and TTS reads it out literally: `**Dr. Rao**`
 * becomes "asterisk asterisk Dr. Rao". The prompt already tells voice agents not
 * to format, but a model reaching for emphasis on an important detail is exactly
 * the failure a patient hears, so strip it on the way to the speaker rather than
 * trusting instructions alone. Text replies keep their formatting.
 */
export function speakableText(text: string): string {
  return (
    text
      // Fenced and inline code: keep the contents, drop the delimiters.
      .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // Links and images become their label; a bare URL is unspeakable.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Emphasis, in the order that keeps ***both*** intact.
      .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(?<![*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, "$1")
      // Leading structure: headings, quotes, and bullets, which otherwise get
      // read as "hash hash" or "hyphen".
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}[-*+]\s+/gm, "")
      // A numbered list is read naturally, so keep the number and drop the dot
      // only when it would be heard as punctuation mid-sentence.
      .replace(/^\s{0,3}(\d+)[.)]\s+/gm, "$1. ")
      // Horizontal rules have no spoken form at all.
      .replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

/**
 * Returns ogg/opus, which is what WhatsApp wants — no ffmpeg on the outbound
 * leg either. Long replies are chunked and concatenated.
 */
export async function speak(
  text: string,
  language: string,
  speaker = "shubh"
): Promise<Buffer> {
  const spoken = speakableText(text)
  const chunks: string[] = []
  for (let i = 0; i < spoken.length; i += TTS_MAX_CHARS) {
    chunks.push(spoken.slice(i, i + TTS_MAX_CHARS))
  }

  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    const res = await call("/text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: chunk,
        target_language_code: ttsLanguage(language),
        model: "bulbul:v3",
        speaker,
        output_audio_codec: "opus",
        // Required. Bulbul defaults to 22050 Hz, which its own opus encoder
        // rejects with a 400 — so every voice reply failed and silently
        // degraded to text. 48 kHz is also Opus's native rate, which is what
        // the granule position in `audio.ts` is denominated in.
        speech_sample_rate: OPUS_SAMPLE_RATE,
      }),
    })
    const json = (await res.json()) as { audios?: string[] }
    const b64 = json.audios?.[0]
    if (b64) buffers.push(Buffer.from(b64, "base64"))
  }
  return Buffer.concat(buffers)
}

/**
 * Plain chat completion against the OpenAI-compatible endpoint. Used by the
 * control plane's "Improve with AI", not by the agent loop (that goes through
 * Pi inside the sandbox).
 */
export async function chat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  model = "sarvam-105b"
): Promise<string> {
  const res = await call("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  })
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content ?? ""
}
