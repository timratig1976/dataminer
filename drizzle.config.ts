import { defineConfig } from "drizzle-kit";

const DEFAULT_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:5432/dataminer`;

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL?.trim() || DEFAULT_URL,
  },
  verbose: true,
  strict: true,
});
