import { defineConfig } from "drizzle-kit"
import { resolve } from "node:path"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${resolve(process.env.DATA_DIR ?? "./data", "app.db")}`,
  },
})
