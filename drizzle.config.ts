import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DIRECT_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://localhost/private_share",
  },
  strict: true,
  verbose: true,
});
