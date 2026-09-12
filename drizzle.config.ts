import { defineConfig } from "drizzle-kit";
import { config } from "./server/config/index.js";

export default defineConfig({
  schema: "./server/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: config.DATABASE_URL,
  },
});
