import { createFileRoute } from "@tanstack/react-router"

async function apiHandler({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}) {
  const { handleBackendRequest } = await import("@/server/backend.server")
  return handleBackendRequest(request, `/${params._splat ?? ""}`)
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: apiHandler,
      POST: apiHandler,
      PATCH: apiHandler,
      PUT: apiHandler,
      DELETE: apiHandler,
    },
  },
})
