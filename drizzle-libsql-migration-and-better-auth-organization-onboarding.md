# Drizzle/libSQL Migration and Better Auth Organization Onboarding

## Summary

Replace the raw `node:sqlite` persistence layer with Drizzle ORM using the generic SQLite guide’s `@libsql/client` driver and `drizzle-orm/libsql`. Add Better Auth with email/password authentication and organization-based tenant isolation.

Existing SQLite data may be discarded. The implementation will also finish the in-progress channel/session refactor and make organizations the owner of agents, channels, sessions, messages, and runs.

Reference: [Drizzle SQLite guide](https://orm.drizzle.team/docs/get-started/sqlite-new).

## Dependencies

Add runtime dependencies:

- `drizzle-orm@rc`
- `@libsql/client`
- `better-auth`
- `@better-auth/drizzle-adapter`

Add development dependencies:

- `drizzle-kit@rc`
- The current Better Auth CLI package

Continue using Bun for package management and application scripts, but do not use `bun:sqlite` or `drizzle-orm/bun-sqlite`. The database layer will remain portable to Node-based tooling and Vitest.

## Database configuration

Add:

- `control-plane/drizzle.config.ts`
- `control-plane/drizzle/`
- `control-plane/src/server/db/client.ts`
- `control-plane/src/server/db/migrate.ts`
- `control-plane/src/server/db/queries.ts`
- `control-plane/src/server/db/schema/app.ts`
- `control-plane/src/server/db/schema/auth.ts`
- `control-plane/src/server/db/schema/index.ts`

### Connection

Create the libSQL client with:

- Driver: `@libsql/client`
- Drizzle import: `drizzle-orm/libsql`
- Local URL: `file:${paths.db()}`

Retain a process-global singleton for both the libSQL client and Drizzle instance so Vite reloads do not create unnecessary connections.

Set SQLite pragmas through the libSQL client:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`

Because libSQL queries are asynchronous, convert the persistence interface and all database-dependent callers to async functions. Do not conceal promises behind synchronous compatibility wrappers.

### Drizzle Kit

Configure:

- `dialect: "sqlite"`
- Combined schema under `src/server/db/schema`
- Output directory `./drizzle`
- Database credentials using the same `file:` URL as the runtime

Add scripts:

- `db:generate`
- `db:migrate`
- `db:studio`
- `auth:generate`

Use checked-in generated migrations. Do not use `drizzle-kit push` as the normal application migration path.

Application startup applies pending checked-in migrations once per process before starting database-dependent services.

## Application schema

### `agents`

- `id`: text primary key
- `organizationId`: non-null FK to Better Auth `organization.id`
- `name`: non-null text
- `voice`: integer boolean, default true
- `tools`: JSON text, default `[]`
- `systemPrompt`: text, default empty
- `goal`: text, default empty
- `language`: text, default `auto`
- `ttsSpeaker`: text, default `shubh`
- `createdAt`: integer timestamp
- Unique index on `(organizationId, id)`

Remove the obsolete agent `channel` property.

### `connectors`

- `agentId`: FK to `agents.id`, cascade on deletion
- `slug`
- `connectionName`
- `allowedActions`: JSON text
- `credentialEnv`: JSON text
- `config`: JSON text
- Composite primary key `(agentId, slug)`

### `channels`

- `id`: text primary key
- `organizationId`: FK to `organization.id`, cascade on deletion
- `name`
- `kind`
- `defaultAgentId`: nullable FK to `agents.id`
- `status`
- `phone`
- `lastError`
- `createdAt`
- Unique index on `(organizationId, id)`

Create one organization-scoped playground channel during onboarding.

### Operational `sessions`

Keep this plural table distinct from Better Auth’s singular `session` table.

- `id`: text primary key
- `channelId`: FK to `channels.id`
- `peerJid`
- `agentId`: nullable FK to `agents.id`
- `agentPinned`: integer boolean
- `workdir`
- `containerId`
- `status`
- `createdAt`
- `lastActiveAt`
- Unique index on `(channelId, peerJid)`
- Index on `lastActiveAt`

### `messages` and `runs`

Retain their existing fields while adding typed Drizzle definitions, relations, indexes, and cascading foreign keys to operational sessions.

Centralize JSON parsing in the query layer. Corrupt JSON values fall back to empty defaults rather than crashing an API request.

Use Drizzle transactions for agent creation, connector replacement, onboarding initialization, and other multi-write operations.

## Fresh database transition

Existing application data is intentionally disposable.

The documented reset procedure will:

1. Stop processes using SQLite.
2. Remove `app.db`, `app.db-wal`, and `app.db-shm`.
3. Generate the combined application and Better Auth migration.
4. Apply the migration to a new libSQL-backed local database.
5. Optionally run the updated seed script.

Normal startup must never delete or recreate an existing database automatically.

## Channel/session refactor

Complete the model already started in the working tree:

- Agents describe behavior and no longer own a `channel` field.
- Channels are independent organization-owned records.
- Sessions resolve agents through their channel.
- Unpinned sessions follow the channel’s current default agent.
- Pinned sessions retain their selected agent.
- Playground sessions use an organization-scoped playground channel.
- WhatsApp connections and credential directories use channel IDs.
- Update pipeline, sandbox, reaper, event bus, API, seed, and CLI callers to await the new async libSQL query functions.

## Better Auth

Create:

- `src/server/auth.ts`
- `src/lib/auth-client.ts`

Configure:

- Drizzle adapter with provider `"sqlite"`
- Combined application and generated auth schema
- Email/password sign-up and sign-in
- Database-backed sessions
- Default `/api/auth` base path
- Organization server and client plugins
- Open self-registration
- Up to five organizations per user
- Database-backed auth rate limiting
- Default Better Auth password hashing
- No email verification or password reset in this pass
- No teams, invitations UI, member administration, or custom roles

Environment variables:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL=http://localhost:3000`

Fail startup with an actionable error when either variable is absent.

Generate the Better Auth schema after configuring the organization plugin, then generate the Drizzle migration containing both application and auth tables.

## Authentication and authorization boundary

Route `/api/auth/*` directly to Better Auth.

Keep only these endpoints public:

- `/api/auth/*`
- `GET /api/health`

Every other API request must:

1. Resolve the Better Auth session from request headers.
2. Require an active organization.
3. Verify organization membership.
4. Scope every database query to that organization.

Responses:

- `401` when unauthenticated
- `403` when authenticated without a usable active organization
- `404` for resources belonging to another organization

Never accept an organization ID from request input as authorization. Use the validated active organization from the session.

Update internal SSR API dispatch to forward incoming cookie headers.

## Tenant isolation

Organizations own agents and channels. Sessions, messages, runs, connectors, media, SSE streams, WhatsApp operations, and sandboxes inherit ownership through those records.

Replace unrestricted database interfaces with organization-scoped signatures such as:

- `listAgents(organizationId)`
- `getAgent(organizationId, agentId)`
- `createAgent(organizationId, input)`
- `getChannel(organizationId, channelId)`
- `findSession(organizationId, channelId, peerJid)`
- `listMessages(organizationId, sessionId)`

All organization members may operate control-plane resources in this pass. Role-specific permissions are deferred.

## Authentication UI

Add centered-card pages matching the existing design:

- `/sign-in`
- `/sign-up`
- `/onboarding`

Sign-up collects name, email, password, and password confirmation.

Onboarding:

- Lists the user’s organizations
- Allows selecting an existing organization
- Allows creating an organization with editable name and slug
- Assigns the creator as owner
- Sets the organization active
- Idempotently creates its playground channel
- Redirects to `/`

Move existing application pages beneath a pathless authenticated layout while retaining their URLs.

The layout redirects:

- Signed-out users to `/sign-in`
- Users without an active organization to `/onboarding`

Update navigation with:

- Active organization selector
- Create-organization action
- Current user identity
- Sign-out action

Switching organizations clears organization-scoped client caches and reloads route data.

## Seed behavior

Require `SEED_ORGANIZATION_ID`.

The seed script must:

- Fail with clear instructions when no organization ID is supplied
- Never create a fake auth user
- Create or update the demo agent inside the selected organization
- Initialize the organization’s playground channel if missing
- Remain idempotent

## Testing

Use a temporary `file:` libSQL database per suite and apply actual migrations.

Cover:

- Migration creation and idempotency
- Foreign-key enforcement
- Typed CRUD and JSON serialization
- Transactions and cascade behavior
- Async query callers
- Channel/session routing and pinning
- Sign-up, sign-in, session, and sign-out
- Organization creation and activation
- Playground initialization
- Public versus protected endpoints
- Missing-active-organization behavior
- Cross-organization isolation for every resource type
- Protected route redirects
- Organization switching and cache reset
- SSR requests with forwarded session cookies

Final validation:

- `bun run typecheck`
- `bun run lint`
- `bun run check`
- `bun test`
- `bun run build`

## Assumptions and defaults

- The linked generic SQLite guide implies use of its demonstrated libSQL driver.
- `@libsql/client` replaces both `node:sqlite` and the previously planned `bun:sqlite`.
- Bun remains the project’s package manager and normal command runner.
- Database operations become asynchronous.
- Existing SQLite contents are disposable.
- Organizations are true tenant boundaries.
- Registration is open.
- Authentication is email/password only.
- Email verification and password reset are deferred.
- Users may create or select organizations, up to five per user.
- The centered-card authentication UI is used.
- The unfinished channel/session refactor is completed during the Drizzle migration.
