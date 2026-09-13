import "dotenv/config";
import { z } from "zod";

/**
 * List of known development and placeholder secrets that must never be accepted in production.
 */
const INSECURE_PLACEHOLDER_SECRETS = [
  "dev_secret_key_at_least_32_characters_long_for_better_auth_foundation",
  "your_development_secret_here_minimum_32_characters",
  "12345678901234567890123456789012",
  "changeme_changeme_changeme_changeme",
];

const DEFAULT_DEV_AUTH_SECRET =
  "dev_secret_key_at_least_32_characters_long_for_better_auth_foundation";
const DEFAULT_DEV_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/moneycomes";
const DEFAULT_DEV_ORIGINS =
  "http://localhost:3000,http://localhost:8081,exp://localhost:8081";

/**
 * Schema for backend environment variables.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"], {
        message: "NODE_ENV must be one of: development, production, test",
      })
      .default("development"),
    PORT: z.coerce
      .number({ message: "PORT must be a valid number" })
      .int("PORT must be an integer")
      .min(1, "PORT must be at least 1")
      .max(65535, "PORT must be at most 65535")
      .default(3000),
    HOST: z.string().default("0.0.0.0"),
    CORS_ORIGIN: z.string().default(DEFAULT_DEV_ORIGINS),
    DATABASE_URL: z
      .string()
      .refine(
        (url) => url.startsWith("postgresql://") || url.startsWith("postgres://"),
        {
          message: "DATABASE_URL must be a valid postgresql:// or postgres:// URI",
        }
      )
      .default(DEFAULT_DEV_DATABASE_URL),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters long")
      .default(DEFAULT_DEV_AUTH_SECRET),
    BETTER_AUTH_URL: z
      .string()
      .url("BETTER_AUTH_URL must be a valid absolute URL")
      .default("http://localhost:3000"),
    TRUSTED_ORIGINS: z.string().default(DEFAULT_DEV_ORIGINS),
    SUPABASE_URL: z
      .string()
      .url("SUPABASE_URL must be a valid absolute URL")
      .default("http://localhost:54321"),
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .default("dev_supabase_service_role_key_placeholder"),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default("attachments"),
  })
  .superRefine((data, ctx) => {
    // Production-specific strict guardrails
    if (data.NODE_ENV === "production") {
      // 1. BETTER_AUTH_SECRET must be explicitly set and not a placeholder
      if (
        INSECURE_PLACEHOLDER_SECRETS.includes(data.BETTER_AUTH_SECRET) ||
        data.BETTER_AUTH_SECRET.toLowerCase().includes("placeholder") ||
        data.BETTER_AUTH_SECRET.toLowerCase().includes("changeme") ||
        data.BETTER_AUTH_SECRET.toLowerCase().includes("development")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "BETTER_AUTH_SECRET must be explicitly set to a cryptographically secure random secret in production mode",
          path: ["BETTER_AUTH_SECRET"],
        });
      }

      // 2. DATABASE_URL cannot be the local development default or point to localhost
      if (
        data.DATABASE_URL === DEFAULT_DEV_DATABASE_URL ||
        data.DATABASE_URL.includes("@localhost") ||
        data.DATABASE_URL.includes("@127.0.0.1") ||
        data.DATABASE_URL.includes("//localhost") ||
        data.DATABASE_URL.includes("//127.0.0.1")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "DATABASE_URL cannot point to localhost or 127.0.0.1 in production mode",
          path: ["DATABASE_URL"],
        });
      }

      // 3. CORS_ORIGIN cannot be wildcard in production when credentials are true
      const corsOrigins = data.CORS_ORIGIN.split(",").map((o) => o.trim());
      if (corsOrigins.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "CORS_ORIGIN cannot be a wildcard (*) in production mode when credentials are enabled. Provide an explicit comma-separated list of origins.",
          path: ["CORS_ORIGIN"],
        });
      }

      // 4. BETTER_AUTH_URL cannot be localhost in production
      if (
        data.BETTER_AUTH_URL.includes("localhost") ||
        data.BETTER_AUTH_URL.includes("127.0.0.1")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "BETTER_AUTH_URL cannot point to localhost or 127.0.0.1 in production mode",
          path: ["BETTER_AUTH_URL"],
        });
      }

      // 5. TRUSTED_ORIGINS cannot be wildcard in production
      const trustedOrigins = data.TRUSTED_ORIGINS.split(",").map((o) => o.trim());
      if (trustedOrigins.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "TRUSTED_ORIGINS cannot contain wildcard (*) in production mode",
          path: ["TRUSTED_ORIGINS"],
        });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

/**
 * Custom error class for environment configuration failures.
 * Never prints secret values.
 */
export class ConfigurationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => ` - ${i}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

/**
 * Pure function to validate and return backend configuration from an environment object.
 * Does not mutate process.env and can be safely called in tests.
 */
export function validateConfig(
  rawEnv: Record<string, string | undefined> = process.env
): Config {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "environment";
      return `${field}: ${issue.message}`;
    });

    // Safe error message: names the failing keys and rules without printing secret values
    throw new ConfigurationError(issues);
  }

  return parsed.data;
}

/**
 * Environment predicates for clean branching.
 */
export const isProduction = (env: string = (process.env.NODE_ENV || "development")): boolean =>
  env === "production";
export const isDevelopment = (env: string = (process.env.NODE_ENV || "development")): boolean =>
  env === "development";
export const isTest = (env: string = (process.env.NODE_ENV || "development")): boolean =>
  env === "test";

/**
 * Validated singleton configuration for the running backend process.
 */
export const config: Config = validateConfig(process.env);
