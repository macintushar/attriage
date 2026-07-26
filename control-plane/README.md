# Attriage

The complete TanStack Start application for the WhatsApp agent platform. The
browser UI and `/api/*` backend run in one process; server-only modules under
`src/server/` own SQLite, WhatsApp/Baileys connections, Sarvam calls, Docker
sandboxes, the event buses, and the agent pipeline.

From this directory:

```bash
bun install
bun run seed
bun run dev
```

Open <http://localhost:3000>. Use `bun run start` after `bun run build` to run
the production preview bundle.

Backend state lives in `data/` and is ignored by Git because it includes
WhatsApp credentials. Environment variables are loaded from `../.env`.
