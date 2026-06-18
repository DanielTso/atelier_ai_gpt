import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-pooled) connection — migrations must not run through the pooler.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
