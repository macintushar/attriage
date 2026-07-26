import { useState } from "react"
import type { FormEvent } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { signUp } from "@/lib/auth-client"
import { AuthCard, Field } from "./sign-in"

export const Route = createFileRoute("/sign-up")({ component: SignUp })

function SignUp() {
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password"))
    if (password !== String(form.get("confirmation"))) {
      return setError("Passwords do not match")
    }
    setBusy(true)
    setError("")
    const result = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password,
    })
    setBusy(false)
    if (result.error)
      return setError(result.error.message ?? "Unable to create account")
    await navigate({ to: "/onboarding" })
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your first organization and start building agents."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field name="name" label="Name" autoComplete="name" />
        <Field name="email" label="Email" type="email" autoComplete="email" />
        <Field
          name="password"
          label="Password"
          type="password"
          minLength={8}
          autoComplete="new-password"
        />
        <Field
          name="confirmation"
          label="Confirm password"
          type="password"
          minLength={8}
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/sign-in" className="text-primary underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
