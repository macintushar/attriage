/**
 * Voice-note duration, read from the audio itself.
 *
 * Every path produces the same bytes on disk, so measuring the file is the only
 * way to get one number that works for all of them: WhatsApp's inbound ogg,
 * Bulbul's TTS reply, and the browser's recording. A client-reported duration
 * covers only the third, and is unverifiable anyway.
 */

/** Opus granule positions are always at 48 kHz, whatever the input rate was. */
const OPUS_GRANULE_RATE = 48_000
const OGG_PAGE = "OggS"
const OGG_HEADER_BYTES = 27
/** A page with no completed packet reports a granule position of -1. */
const NO_GRANULE = 0xffff_ffff_ffff_ffffn

function isPageStart(data: Buffer, at: number): boolean {
  // The version byte after the capture pattern is 0 in every stream ever
  // written; checking it rejects an "OggS" that is really packet payload.
  return at >= 0 && at + OGG_HEADER_BYTES <= data.length && data[at + 4] === 0
}

/**
 * Duration in seconds of an Ogg-encapsulated Opus stream, or null if the buffer
 * is not one — a browser that lacked ogg support hands us WebM, which we store
 * under the same `.ogg` name.
 */
export function oggOpusDuration(data: Buffer): number | null {
  if (data.length < OGG_HEADER_BYTES) return null
  if (data.toString("latin1", 0, 4) !== OGG_PAGE) return null

  // OpusHead sits in the first page and carries the pre-skip: samples the
  // decoder throws away, which are not part of the audible duration.
  const head = data.indexOf("OpusHead", 0, "latin1")
  if (head < 0 || head + 12 > data.length) return null
  const preSkip = data.readUInt16LE(head + 10)

  // The last page's granule position is the stream's total sample count. Walk
  // backwards past any page that doesn't report one.
  let at = data.lastIndexOf(OGG_PAGE, data.length - 4, "latin1")
  while (at >= 0) {
    if (isPageStart(data, at)) {
      const granule = data.readBigUInt64LE(at + 6)
      if (granule !== NO_GRANULE) {
        const samples = Number(granule) - preSkip
        return samples > 0 ? samples / OPUS_GRANULE_RATE : 0
      }
    }
    if (at === 0) break
    at = data.lastIndexOf(OGG_PAGE, at - 1, "latin1")
  }
  return null
}

/**
 * Best available duration for a voice note, in whole seconds.
 *
 * Measuring the file wins over whatever the client claimed, since the client
 * can only ever be guessing about its own recording.
 */
export function audioDuration(
  data: Buffer,
  reported?: number
): number | undefined {
  const measured = oggOpusDuration(data)
  if (measured !== null && measured > 0) return Math.round(measured)
  return reported && reported > 0 ? Math.round(reported) : undefined
}
