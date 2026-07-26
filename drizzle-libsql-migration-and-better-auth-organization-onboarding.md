# Drizzle/libSQL Migration and Better Auth Organization Onboarding

## Summary

Replace the raw `node:sqlite` persistence layer with Drizzle ORM using the generic SQLite guide’s `@libsql/client` driver and `drizzle-orm/libsql`. Add Better Auth with email/password authentication and organization-based tenant isolation.

Existing SQLite data may be discarded. The implementation will also finish the in-progress channel/session refactor and make organizations the owner of agents, channels, sessions, messages, and runs.

Reference: [Drizzle SQLite guide](https://orm.drizzle.team/docs/get-started/sqlite-new).

## Dependencies

Pin the compatible release-candidate stack exactly so schema generation is
reproducible:

- `drizzle-orm@1.0.0-rc.4`
- `@libsql/client@0.17.4`
- `better-auth@1.7.0-rc.2`
- `@better-auth/drizzle-adapter@1.7.0-rc.2`

Add development dependencies:

- `drizzle-kit@1.0.0-rc.4`
- `auth@1.7.0-rc.2`

Continue using Bun for package management and application scripts, but do not use `bun:sqlite` or `drizzle-orm/bun-sqlite`. The database layer will remain portable to Node-based tooling and Vitest.

Do not use `latest`, `rc`, or another floating tag in package scripts. Upgrade
Better Auth, its CLI, its Drizzle adapter, Drizzle ORM, and Drizzle Kit together
in a dedicated change that regenerates the auth schema and validates migration
output.

## Database configuration

Add:

- `control-plane/drizzle.config.ts`
- `control-plane/drizzle/`
- `control-plane/src/server/db/client.ts`
- `control-plane/src/server/db/migrate.ts`
- `control-plane/src/server/db/queries/tenant.ts`
- `control-plane/src/server/db/queries/system.ts`
- `control-plane/src/server/db/queries/shared.ts`
- `control-plane/src/server/db/schema/app.ts`
- `control-plane/src/server/db/schema/auth.ts`
- `control-plane/src/server/db/schema/index.ts`

### Connection

Create the libSQL client with:

- Driver: `@libsql/client`
- Drizzle import: `drizzle-orm/libsql`
- Local URL: `file:${paths.db()}`

Expose a `createDatabase(url)` factory for tests and scripts. The application
uses that factory to retain a process-global singleton for both the libSQL
client and Drizzle instance so Vite reloads do not create unnecessary
connections.

Set SQLite pragmas through the libSQL client:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`

Run the pragmas before migrations or queries for every created local client.

Use the Better Auth Relations v2 adapter:

- Import `drizzleAdapter` from
  `@better-auth/drizzle-adapter/relations-v2`.
- Pass `provider: "sqlite"` and the combined table schema to the adapter.
- Initialize Drizzle with application relations followed by the generated
  `authRelations`; the generated partial relations must be spread last.

Because libSQL queries are asynchronous, convert the persistence interface and all database-dependent callers to async functions. Do not conceal promises behind synchronous compatibility wrappers.

### Startup readiness

Create two process-global, cached promise barriers:

- `ensureDatabaseReady(): Promise<void>` creates the client, applies pragmas,
  and applies all pending checked-in migrations.
- `ensureBackendReady(): Promise<void>` awaits database readiness, then starts
  the reaper and Sarvam shim, reconnects paired channels, and starts non-blocking
  maintenance such as the audio-duration backfill.

Better Auth handlers, organization hooks, seed scripts, and CLI scripts await
only `ensureDatabaseReady()`. Application API handlers and internal application
SSR dispatch await `ensureBackendReady()`. This prevents scripts and auth-only
requests from starting long-lived background services.

Concurrent first callers share the appropriate promise. A migration or
initialization failure rejects requests and logs the original actionable error;
services must not start against a partially migrated database.

### Drizzle Kit

Configure:

- `dialect: "sqlite"`
- Schema entry point `./src/server/db/schema/index.ts`
- Output directory `./drizzle`
- Database credentials using the same `file:` URL as the runtime

Add scripts:

- `db:generate`: `drizzle-kit generate --config drizzle.config.ts`
- `db:migrate`: `drizzle-kit migrate --config drizzle.config.ts`
- `db:studio`: `drizzle-kit studio --config drizzle.config.ts`
- `auth:generate`:
  `auth generate --config ./src/server/auth.ts --output ./src/server/db/schema/auth.ts --yes`

Use checked-in generated migrations. Do not use `drizzle-kit push` as the normal application migration path.

Schema/code-generation order is:

1. Create the database client and Better Auth configuration without importing a
   not-yet-generated auth schema.
2. Configure all Better Auth plugins and rate-limit storage.
3. Run `bun run auth:generate`.
4. Wire the generated auth tables and `authRelations` into the final adapter and
   Drizzle instance.
5. Define the application schema and its foreign keys to the generated
   `organization` table.
6. Run `bun run db:generate`.
7. Review and check in the generated SQL and Drizzle metadata.

The final checked-in runtime configuration must not contain a placeholder,
conditional schema, or bootstrap-only branch.

## Application schema

### `agents`

- `id`: globally unique UUID text primary key, generated with
  `crypto.randomUUID()`
- `organizationId`: non-null FK to Better Auth `organization.id`
- `slug`: non-null organization-local slug
- `name`: non-null text
- `voice`: integer boolean, default true
- `tools`: JSON text, default `[]`
- `systemPrompt`: text, default empty
- `goal`: text, default empty
- `language`: text, default `auto`
- `ttsSpeaker`: text, default `shubh`
- `createdAt`: integer timestamp
- Unique index on `(organizationId, id)`
- Unique index on `(organizationId, slug)`

Remove the obsolete agent `channel` property.

Application timestamps remain Unix milliseconds and use Drizzle integer
columns without Date conversion.

Interactive creation slugifies the submitted name and adds a numeric suffix
until `(organizationId, slug)` is free. Callers cannot submit or replace an
opaque `id`. Seed and system initialization code may supply a fixed slug but
still use generated UUID IDs.

### `connectors`

- `organizationId`: non-null
- `agentId`: non-null
- `slug`
- `connectionName`
- `allowedActions`: JSON text
- `credentialEnv`: JSON text
- `config`: JSON text
- Composite primary key `(organizationId, agentId, slug)`
- Composite FK `(organizationId, agentId)` to
  `agents(organizationId, id)`, cascade on deletion

### `channels`

- `id`: globally unique UUID text primary key, generated with
  `crypto.randomUUID()`
- `organizationId`: non-null FK to `organization.id`, cascade on deletion
- `slug`: non-null organization-local slug
- `name`
- `kind`
- `defaultAgentId`: nullable
- `status`
- `phone`
- `lastError`
- `createdAt`
- Unique index on `(organizationId, id)`
- Unique index on `(organizationId, slug)`
- Composite FK `(organizationId, defaultAgentId)` to
  `agents(organizationId, id)` with `ON DELETE RESTRICT`
- Partial unique index on `(organizationId, kind)` where `kind = 'playground'`

Create one organization-scoped playground channel during onboarding. Remove
the global `PLAYGROUND_CHANNEL_ID`; resolve the channel by organization and
`kind = 'playground'`.

### Operational `sessions`

Keep this plural table distinct from Better Auth’s singular `session` table.

- `id`: globally unique UUID text primary key
- `organizationId`: non-null
- `channelId`: non-null
- `peerJid`
- `agentId`: nullable
- `agentPinned`: integer boolean
- `workdir`
- `containerId`
- `status`
- `createdAt`
- `lastActiveAt`
- Unique index on `(organizationId, id)`
- Unique index on `(organizationId, channelId, peerJid)`
- Composite FK `(organizationId, channelId)` to
  `channels(organizationId, id)`, cascade on deletion
- Composite FK `(organizationId, agentId)` to
  `agents(organizationId, id)` with `ON DELETE RESTRICT`
- Index on `lastActiveAt`

Agent deletion is a transaction that first nulls `channels.defaultAgentId` and
`sessions.agentId` for the same organization, deletes its connectors, and then
deletes the agent. Composite foreign keys use `RESTRICT` because SQLite
`SET NULL` would also try to null the shared non-null `organizationId`.

### `messages` and `runs`

Retain their existing fields and add a non-null `organizationId`. Define typed
Drizzle tables, relations, and indexes, with composite cascading FKs
`(organizationId, sessionId)` to operational
`sessions(organizationId, id)`. All message/run lookups include both
organization and session identity.

Centralize JSON parsing in the query layer. Corrupt JSON values fall back to
type-correct empty defaults (`[]` for lists and `{}` for maps) rather than
crashing an API request.

Use Drizzle transactions for agent creation with connectors, connector
replacement, organization application-resource initialization, and other
multi-write operations. Better Auth organization creation and activation are
separate auth operations and are not represented as part of an application
database transaction.

Every write that relates two resources must include the active organization in
its predicate and rely on the composite foreign keys as a second enforcement
layer.

## Fresh database transition

Existing application data is intentionally disposable.

Migration authoring will:

1. Update the Better Auth configuration and application schema.
2. Regenerate `schema/auth.ts`.
3. Generate the combined Drizzle migration.
4. Review and check in the generated schema and migration artifacts.

The documented local reset procedure will:

1. Stop processes using SQLite.
2. Remove `app.db`, `app.db-wal`, and `app.db-shm`.
3. Apply the already checked-in migrations to a new libSQL-backed local
   database.
4. Optionally run the updated seed script.

Normal startup must never delete or recreate an existing database automatically.

## Channel/session refactor

Complete the model already started in the working tree:

- Agents describe behavior and no longer own a `channel` field.
- Channels are independent organization-owned records.
- Sessions resolve agents through their channel.
- Unpinned sessions follow the channel’s current default agent.
- Pinned sessions retain their selected agent.
- Playground sessions use an organization-scoped playground channel.
- Agent, channel, and session IDs are opaque global UUIDs; organization-local
  slugs retain readable seed and lookup identities.
- WhatsApp connections and credential directories use channel IDs.
- Update pipeline, sandbox, reaper, event bus, API, seed, and CLI callers to await the new async libSQL query functions.

Session workdirs and container names use the globally unique session UUID.
Channel credential directories use the globally unique channel UUID. Do not
derive filesystem or Docker identities from organization-local slugs.

## Better Auth

Create:

- `src/server/auth.ts`
- `src/lib/auth-client.ts`

Configure:

- Drizzle adapter with provider `"sqlite"`
- Relations v2 adapter with the combined application and generated auth table
  schema
- Email/password sign-up and sign-in
- Database-backed sessions
- Default `/api/auth` base path
- Organization server and client plugins
- Open self-registration
- Up to five organizations per user
- `disableOrganizationDeletion: true`
- `organizationHooks.afterCreateOrganization` calls the idempotent application
  organization initializer
- Database-backed auth rate limiting
- Default Better Auth password hashing
- No email verification or password reset in this pass
- No teams, invitations UI, member administration, or custom roles

Environment variables:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL=http://localhost:3000`

Fail startup with an actionable error when either variable is absent.

Generate the Better Auth schema after configuring the organization plugin, then generate the Drizzle migration containing both application and auth tables.

Organization deletion remains disabled until a later plan defines how to stop
live WhatsApp connections and sandboxes and how to dispose of credential,
workspace, and media directories.

## Authentication and authorization boundary

Add a dedicated `/api/auth/*` catch-all route. It awaits
`ensureDatabaseReady()` and then passes the original `Request` directly to
Better Auth. The existing application catch-all must not process auth paths.

Keep only these endpoints public:

- `/api/auth/*`
- `GET /api/health`

Every other API request must:

1. Await `ensureBackendReady()`.
2. Resolve the Better Auth session from request headers.
3. Require an active organization.
4. Verify organization membership.
5. Scope every database query to that organization.

Responses:

- `401` when unauthenticated
- `403` when authenticated without a usable active organization
- `404` for resources belonging to another organization

Never accept an organization ID from request input as authorization. Use the validated active organization from the session.

Update internal SSR API dispatch to copy the incoming request’s `cookie` and
`authorization` headers into its synthetic request. Do not accept caller-supplied
values for those headers when server rendering. Route loaders use the same
tenant resolver and response semantics as network requests.

### Media authorization

The media route must not construct a filesystem path from request parameters
alone. Resolve media through an organization-scoped query that joins the active
organization, operational session, and stored message:

- Require the session to belong to the active organization.
- Require the requested basename to match that message’s stored `audioPath`.
- Read only the exact stored path returned by the authorized query.
- Return `404` for another organization’s session, an unrecorded filename, or a
  missing file.

## Tenant isolation

Organizations own agents and channels. Sessions, messages, runs, connectors, media, SSE streams, WhatsApp operations, and sandboxes inherit ownership through those records.

Replace unrestricted database interfaces with organization-scoped signatures such as:

- `listAgents(organizationId)`
- `getAgent(organizationId, agentId)`
- `createAgent(organizationId, input)`
- `getChannel(organizationId, channelId)`
- `findSession(organizationId, channelId, peerJid)`
- `listMessages(organizationId, sessionId)`

Request handlers may import only `db/queries/tenant.ts`. Global maintenance
jobs use explicitly privileged functions from `db/queries/system.ts`:

- Reconnect every eligible WhatsApp channel at startup.
- Find and reap stale sessions across organizations.
- Find messages requiring audio-duration backfill.

System query results always include `organizationId`, and subsequent updates
match both organization and resource ID. `system.ts` must not be imported by
route or request-handler modules.

All organization members are trusted and may operate control-plane resources
in this pass. Role-specific permissions, connector credential authorization,
and secret hardening are explicitly deferred to the later RBAC work.

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
- Calls `POST /api/onboarding/complete` after activation
- Redirects to `/`

`POST /api/onboarding/complete` is a protected application endpoint. It uses
only the validated active organization and runs the idempotent application
organization initializer in a Drizzle transaction. That initializer looks up
the organization’s playground channel by the partial unique key, inserts it
with a UUID and slug `playground` if missing, and returns the existing or new
record.

The Better Auth `afterCreateOrganization` hook calls the same initializer for
eager setup. The onboarding completion endpoint remains the correctness and
repair path for hook failures and existing organizations. The authenticated
layout loader also calls it once before loading application data, including
after an organization switch.

If organization creation, activation, or completion fails, remain on
`/onboarding`, show the returned error, and allow retry. Never redirect into the
application until activation and completion both succeed.

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

Implement switching as: set the active organization, call onboarding
completion, clear the agent and channel stores plus active SSE subscriptions,
then perform a full route invalidation. A completion failure leaves the old
page state intact and displays an error.

## Seed behavior

Require `SEED_ORGANIZATION_ID`.

The seed script must:

- Fail with clear instructions when no organization ID is supplied
- Never create a fake auth user
- Create or update the demo agent by
  `(organizationId, slug = 'patient-intake')`
- Initialize the organization’s playground channel if missing
- Remain idempotent

The seeded WhatsApp channel is likewise found by
`(organizationId, slug = 'hospital-whatsapp')`. IDs are generated only on first
insert and retained on subsequent seed runs.

## Testing

Use a temporary `file:` libSQL database per suite and apply actual migrations.

Cover:

- Applying checked-in migrations to an empty database and applying them again
- Concurrent first requests sharing one migration/readiness promise
- Foreign-key enforcement
- Rejection of cross-organization channel/default-agent and
  session/pinned-agent relationships
- Duplicate agent/channel slugs allowed across organizations but rejected
  within one organization
- Exactly one playground channel per organization
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
- Media requests for another organization, an unrecorded filename, and a
  missing file
- Organization deletion disabled through the Better Auth endpoint
- Organization initialization hook failure followed by successful idempotent
  onboarding repair
- Protected route redirects
- Organization switching and cache reset
- SSR requests with forwarded session cookies
- System maintenance queries spanning organizations without being available to
  request handlers

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
- Application resource IDs are opaque global UUIDs; readable slugs are unique
  only within an organization.
- Registration is open.
- Authentication is email/password only.
- Email verification and password reset are deferred.
- Users may create or select organizations, up to five per user.
- Current organization members are trusted. Role-specific permissions,
  connector credential authorization, and host-secret hardening are deferred
  to later RBAC work.
- Organization deletion is disabled until external resource cleanup is
  designed.
- The exact Better Auth 1.7 RC and Drizzle 1.0 RC versions listed above are
  intentional and are upgraded as one compatibility unit.
- The centered-card authentication UI is used.
- The unfinished channel/session refactor is completed during the Drizzle migration.
