import { readFile } from "node:fs/promises"

import { oggOpusDuration } from "./audio"
import { messagesMissingAudioDuration, setMessageAudioSeconds } from "./db"

/**
 * Recovers durations for voice notes recorded before they were stored.
 *
 * The audio is still in the session workspace, so the length is measurable
 * after the fact — without this, every historical voice note reads 0:00 forever.
 * Runs once at boot, newest first, and is a no-op on a database that has none.
 *
 * Kept out of `db.ts` deliberately: that module runs its schema work at import
 * time, and reading files there would make importing the database do disk I/O.
 */
export async function backfillAudioDurations(limit = 500): Promise<number> {
  const pending = await messagesMissingAudioDuration(limit)
  if (!pending.length) return 0

  let filled = 0
  for (const message of pending) {
    try {
      const seconds = oggOpusDuration(await readFile(message.audioPath))
      // A row we cannot measure is left alone rather than written as 0: on the
      // next boot the file may be readable, and 0:00 is what we are fixing.
      if (seconds === null || seconds <= 0) continue
      await setMessageAudioSeconds(message.id, Math.round(seconds))
      filled++
    } catch {
      // Reaped workspace, deleted media, or a container that never wrote it.
      // Not worth failing a boot over.
    }
  }

  if (filled) {
    console.log(`measured ${filled} historical voice note(s)`)
  }
  return filled
}
