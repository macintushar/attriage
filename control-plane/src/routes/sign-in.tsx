import { useState } from "react"
import type { FormEvent } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"

import { signIn } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/sign-in")({ component: SignIn })

function SignIn() {
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const form = new FormData(event.currentTarget)
    const result = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    })
    setBusy(false)
    if (result.error)
      return setError(result.error.message ?? "Unable to sign in")
    await navigate({ to: "/onboarding" })
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to manage your agents and channels."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field name="email" label="Email" type="email" autoComplete="email" />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/sign-up" className="text-primary underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  )
}

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-6">
      <section className="w-full max-w-md rounded-2xl border bg-background p-7 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold">{title}</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">{description}</p>
        {children}
      </section>
    </main>
  )
}

export function Field(
  props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }
) {
  const { label, ...input } = props
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        {...input}
        required
        className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}
