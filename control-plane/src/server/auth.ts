import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins/organization"

import { required } from "./env"
import { db } from "./db/client"
import * as schema from "./db/schema/auth"

export const auth = betterAuth({
  appName: "Attriage",
  baseURL: required("BETTER_AUTH_URL"),
  secret: required("BETTER_AUTH_SECRET"),
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    storeSessionInDatabase: true,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      teams: { enabled: false },
    }),
  ],
})

export type AuthSession = typeof auth.$Infer.Session
