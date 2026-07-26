import { AsyncLocalStorage } from "node:async_hooks"

type LogLevel = "debug" | "info" | "warn" | "error"
type LogFields = Record<string, unknown>

interface LogContext {
  requestId?: string
  runId?: number
  channelId?: string
  sessionId?: string
  agentId?: string
}

const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}
const requestedLevel = process.env.LOG_LEVEL?.toLowerCase()
const configuredLevel: LogLevel =
  requestedLevel && requestedLevel in levels
    ? (requestedLevel as LogLevel)
    : "info"
const context = new AsyncLocalStorage<LogContext>()
const SECRET_KEY =
  /authorization|cookie|token|secret|password|credential|api.?key/i

function safe(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]"
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause ? safe(value.cause, "cause", depth + 1) : undefined,
    }
  }
  if (typeof value === "bigint") return value.toString()
  if (depth >= 5) return "[MAX_DEPTH]"
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => safe(item, key, depth + 1))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([childKey, child]) => [childKey, safe(child, childKey, depth + 1)]
      )
    )
  }
  return value
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  if (levels[level] < levels[configuredLevel]) return
  const record = safe({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context.getStore(),
    ...fields,
  })
  const line = JSON.stringify(record)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
}

export function withLogContext<T>(fields: LogContext, callback: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, callback)
}
