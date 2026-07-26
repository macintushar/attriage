import { createServerOnlyFn } from "@tanstack/react-start"

const serverApiFetch = createServerOnlyFn(
  async (path: string, init?: RequestInit): Promise<Response> => {
    const { getRequestHeaders } = await import("@tanstack/react-start/server")
    const { handleBackendRequest } = await import("@/server/backend.server")
    const clean = path.startsWith("/") ? path : `/${path}`
    const headers = new Headers(getRequestHeaders())
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    const request = new Request(new URL(clean, "http://tanstack.local"), {
      ...init,
      headers,
    })
    return handleBackendRequest(request, clean.replace(/^\/api/, "") || "/")
  }
)

/**
 * Browser calls use the public API route. SSR loaders dispatch to the same
 * backend handler in-process, avoiding a fragile HTTP call back into the app.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const clean = path.startsWith("/") ? path : `/${path}`
  if (typeof window !== "undefined") return fetch(clean, init)
  return serverApiFetch(clean, init)
}
