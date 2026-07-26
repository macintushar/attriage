import { useEffect, useState } from "react"
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { IconSparkles } from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import { authClient, signOut, useSession } from "@/lib/auth-client"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Attriage — Sarvam WhatsApp Agents",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function TopNav() {
  const { pathname } = useLocation()
  const session = useSession()
  const [organizations, setOrganizations] = useState<
    Array<{ id: string; name: string }>
  >([])
  useEffect(() => {
    if (!session.data) return
    void authClient.organization
      .list()
      .then(({ data }) => setOrganizations(data ?? []))
  }, [session.data])
  const links = [
    {
      to: "/",
      label: "Agents",
      active: pathname === "/" || pathname.startsWith("/agents"),
    },
    {
      to: "/channels",
      label: "Channels",
      // A session page is reached from a channel, so it belongs to that tab.
      active:
        pathname.startsWith("/channels") || pathname.startsWith("/sessions"),
    },
    { to: "/tools", label: "Tools", active: pathname.startsWith("/tools") },
  ]
  return (
    <nav className="flex h-14 shrink-0 items-center gap-6 border-b px-6">
      <Link
        to="/"
        className="flex items-center gap-2 font-heading text-sm font-semibold"
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconSparkles className="size-4" />
        </span>
        Attriage
      </Link>
      <div className="flex gap-1">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground",
              l.active && "bg-muted font-medium text-foreground"
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <select
          aria-label="Active organization"
          value={session.data?.session.activeOrganizationId ?? ""}
          onChange={async (event) => {
            await authClient.organization.setActive({
              organizationId: event.target.value,
            })
            window.location.assign("/")
          }}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
        <Link
          to="/onboarding"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          New organization
        </Link>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {session.data?.user.name}
        </span>
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={async () => {
            await signOut()
            window.location.assign("/sign-in")
          }}
        >
          Sign out
        </button>
        <RuntimeBadge />
      </div>
    </nav>
  )
}

interface Health {
  ok: boolean
  docker: boolean
  sarvamKey: boolean
  model: string
}

/**
 * Surfaces the two things that silently break every demo: a missing Sarvam key
 * and an unreachable Docker daemon.
 */
function RuntimeBadge() {
  const [health, setHealth] = useState<Health | null>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      fetch("/api/health")
        .then((res) =>
          res.ok ? res.json() : Promise.reject(new Error("bad status"))
        )
        .then((data: Health) => {
          if (cancelled) return
          setHealth(data)
          setDown(false)
        })
        .catch(() => !cancelled && setDown(true))
    void poll()
    const timer = setInterval(poll, 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const problems: string[] = []
  if (health && !health.sarvamKey) problems.push("no SARVAM_API_KEY")
  if (health && !health.docker) problems.push("docker unreachable")

  const tone = down
    ? "bg-destructive/10 text-destructive"
    : problems.length
      ? "bg-amber-500/10 text-amber-600"
      : "bg-emerald-500/10 text-emerald-600"

  return (
    <span
      className={cn("ml-auto rounded-full px-3 py-1 text-xs font-medium", tone)}
      title={health?.model ? `model: ${health.model}` : undefined}
    >
      {down
        ? "backend offline"
        : problems.length
          ? problems.join(" · ")
          : health
            ? "backend ready"
            : "checking…"}
    </span>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const session = useSession()
  const publicPage =
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/onboarding"

  useEffect(() => {
    if (session.isPending) return
    if (!session.data && !publicPage) window.location.assign("/sign-in")
    if (
      session.data &&
      !session.data.session.activeOrganizationId &&
      !publicPage
    ) {
      window.location.assign("/onboarding")
    }
  }, [publicPage, session.data, session.isPending])

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {publicPage ? (
          children
        ) : (
          <div className="flex h-svh flex-col">
            <TopNav />
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        )}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
