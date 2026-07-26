import type { ChannelEvent, RunEvent } from "./types"

type Listener<T> = (event: T) => void

/**
 * Per-topic fan-out for SSE. Deliberately in-memory and lossy: a browser that
 * reconnects gets the current state from the REST endpoints, not a replay.
 *
 * Run topics are `session:<id>`, `channel:<id>` and `agent:<id>`; channel
 * pairing topics are channel ids.
 */
class Bus<T> {
  private listeners = new Map<string, Set<Listener<T>>>()

  subscribe(key: string, listener: Listener<T>): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
    }
  }

  emit(key: string, event: T) {
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        // A broken SSE pipe must not take down the pipeline that emitted into it.
      }
    }
  }
}

const EVENTS_KEY = Symbol.for("sarvam-control-plane.events")
const globals = globalThis as typeof globalThis & {
  [EVENTS_KEY]?: {
    runBus: Bus<RunEvent>
    channelBus: Bus<ChannelEvent>
  }
}

const buses =
  globals[EVENTS_KEY] ??
  (globals[EVENTS_KEY] = {
    runBus: new Bus<RunEvent>(),
    channelBus: new Bus<ChannelEvent>(),
  })

export const runBus = buses.runBus
export const channelBus = buses.channelBus

/** Publishes one run event to every topic watching it. */
export function emitRun(topics: string[], event: RunEvent) {
  for (const topic of topics) runBus.emit(topic, event)
}

export const runTopic = {
  session: (id: string) => `session:${id}`,
  channel: (id: string) => `channel:${id}`,
  agent: (id: string) => `agent:${id}`,
}
