import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { authClient, useSession } from "@/lib/auth-client"
import { AuthCard, Field } from "./sign-in"

export const Route = createFileRoute("/onboarding")({ component: Onboarding })

type Organization = { id: string; name: string; slug: string }

function Onboarding() {
  const navigate = useNavigate()
  const session = useSession()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (session.isPending) return
    if (!session.data) {
      void navigate({ to: "/sign-in" })
      return
    }
    void authClient.organization
      .list()
      .then(({ data }) => setOrganizations((data ?? []) as Organization[]))
  }, [navigate, session.data, session.isPending])

  async function activate(organizationId: string) {
    setBusy(true)
    setError("")
    const result = await authClient.organization.setActive({ organizationId })
    if (result.error) {
      setBusy(false)
      return setError(result.error.message ?? "Unable to select organization")
    }
    const initialized = await fetch("/api/onboarding", { method: "POST" })
    if (!initialized.ok) {
      setBusy(false)
      return setError("Unable to initialize organization")
    }
    window.location.assign("/")
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = await authClient.organization.create({
      name: String(form.get("name")).trim(),
      slug: String(form.get("slug")).trim(),
    })
    if (result.error) {
      return setError(result.error.message ?? "Unable to create organization")
    }
    await activate(result.data.id)
  }

  return (
    <AuthCard
      title="Choose an organization"
      description="Your agents, channels, and conversations stay isolated inside an organization."
    >
      {organizations.length > 0 && (
        <div className="mb-6 space-y-2">
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              disabled={busy}
              onClick={() => void activate(organization.id)}
              className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted"
            >
              <span className="font-medium">{organization.name}</span>
              <span className="text-xs text-muted-foreground">
                {organization.slug}
              </span>
            </button>
          ))}
        </div>
      )}
      <form className="space-y-4 border-t pt-5" onSubmit={create}>
        <h2 className="font-medium">Create an organization</h2>
        <Field name="name" label="Organization name" />
        <Field name="slug" label="Slug" pattern="[a-z0-9-]+" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={busy}>
          {busy ? "Setting up…" : "Create organization"}
        </Button>
      </form>
    </AuthCard>
  )
}
