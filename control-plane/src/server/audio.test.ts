import { describe, expect, it } from "vitest"

import { audioDuration, oggOpusDuration } from "./audio"

const OPUS_RATE = 48_000

/** One Ogg page: 27-byte header, one segment, then the payload. */
function page(opts: {
  granule: bigint
  payload: Buffer
  sequence: number
}): Buffer {
  const header = Buffer.alloc(27 + 1)
  header.write("OggS", 0, "latin1")
  header[4] = 0 // version
  header[5] = opts.sequence === 0 ? 0x02 : 0 // beginning-of-stream flag
  header.writeBigUInt64LE(opts.granule, 6)
  header.writeUInt32LE(1, 14) // serial
  header.writeUInt32LE(opts.sequence, 18)
  header.writeUInt32LE(0, 22) // checksum — never verified here
  header[26] = 1 // one segment
  header[27] = Math.min(opts.payload.length, 255)
  return Buffer.concat([header, opts.payload])
}

function opusHead(preSkip: number): Buffer {
  const payload = Buffer.alloc(19)
  payload.write("OpusHead", 0, "latin1")
  payload[8] = 1 // version
  payload[9] = 1 // channels
  payload.writeUInt16LE(preSkip, 10)
  payload.writeUInt32LE(OPUS_RATE, 12)
  return payload
}

/** A minimal but structurally real ogg/opus stream of a known length. */
function stream(opts: {
  seconds: number
  preSkip?: number
  trailingEmptyPage?: boolean
}): Buffer {
  const preSkip = opts.preSkip ?? 312
  const granule = BigInt(Math.round(opts.seconds * OPUS_RATE) + preSkip)
  const pages = [
    page({ granule: 0n, payload: opusHead(preSkip), sequence: 0 }),
    page({ granule, payload: Buffer.from("audio-data"), sequence: 1 }),
  ]
  if (opts.trailingEmptyPage) {
    // Real encoders emit these: a continued packet with nothing completed yet.
    pages.push(
      page({
        granule: 0xffff_ffff_ffff_ffffn,
        payload: Buffer.from("cont"),
        sequence: 2,
      })
    )
  }
  return Buffer.concat(pages)
}

describe("oggOpusDuration", () => {
  it("reads the duration from the final granule position", () => {
    expect(oggOpusDuration(stream({ seconds: 7.5 }))).toBeCloseTo(7.5, 5)
  })

  it("excludes the decoder pre-skip, which is not audible", () => {
    const preSkip = 48_000 // an absurd 1s, to make the difference visible
    const withSkip = oggOpusDuration(stream({ seconds: 3, preSkip }))
    expect(withSkip).toBeCloseTo(3, 5)
  })

  it("walks back past a final page that reports no granule", () => {
    // Taking the last page blindly would return a nonsense duration here.
    expect(
      oggOpusDuration(stream({ seconds: 12, trailingEmptyPage: true }))
    ).toBeCloseTo(12, 5)
  })

  it("handles durations well past a minute", () => {
    expect(oggOpusDuration(stream({ seconds: 185 }))).toBeCloseTo(185, 5)
  })

  it("returns null for WebM, which we store under the same .ogg name", () => {
    // A browser without ogg support records WebM; its magic is EBML, not OggS.
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(64),
    ])
    expect(oggOpusDuration(webm)).toBeNull()
  })

  it("returns null rather than throwing on a truncated file", () => {
    expect(oggOpusDuration(Buffer.from("Ogg"))).toBeNull()
    expect(oggOpusDuration(Buffer.alloc(0))).toBeNull()
    expect(oggOpusDuration(stream({ seconds: 5 }).subarray(0, 20))).toBeNull()
  })

  it("returns null for an ogg stream that isn't opus", () => {
    const vorbis = page({
      granule: 480_000n,
      payload: Buffer.from("\x01vorbis"),
      sequence: 0,
    })
    expect(oggOpusDuration(vorbis)).toBeNull()
  })
})

describe("audioDuration", () => {
  it("prefers the measured duration over what the client claimed", () => {
    // The browser's MediaRecorder timing includes permission and startup delay.
    expect(audioDuration(stream({ seconds: 4 }), 9)).toBe(4)
  })

  it("falls back to the reported duration when the file can't be measured", () => {
    const webm = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(64),
    ])
    expect(audioDuration(webm, 6)).toBe(6)
  })

  it("is undefined when neither source knows — never a misleading zero", () => {
    expect(audioDuration(Buffer.alloc(0))).toBeUndefined()
    expect(audioDuration(Buffer.alloc(0), 0)).toBeUndefined()
  })
})
