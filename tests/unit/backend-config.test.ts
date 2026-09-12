import { describe, it, expect } from "vitest";
import {
  config,
  validateConfig,
  isProduction,
  isDevelopment,
  isTest,
  ConfigurationError,
} from "../../server/config/index.js";

describe("Backend Configuration Hardening (Phase 1.6)", () => {
  describe("Singleton Config & Defaults", () => {
    it("loads and validates default environment configuration", () => {
      expect(config).toBeDefined();
      expect(typeof config.PORT).toBe("number");
      expect(config.PORT).toBeGreaterThanOrEqual(1);
      expect(config.PORT).toBeLessThanOrEqual(65535);
      expect(["development", "production", "test"]).toContain(config.NODE_ENV);
      expect(config.DATABASE_URL).toBeDefined();
      expect(config.DATABASE_URL.startsWith("postgresql://")).toBe(true);
      expect(config.BETTER_AUTH_SECRET).toBeDefined();
      expect(config.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(config.BETTER_AUTH_URL).toBeDefined();
      expect(config.CORS_ORIGIN).toBeDefined();
      expect(config.TRUSTED_ORIGINS).toBeDefined();
    });

    it("evaluates environment predicates accurately", () => {
      expect(isProduction("production")).toBe(true);
      expect(isProduction("development")).toBe(false);
      expect(isDevelopment("development")).toBe(true);
      expect(isDevelopment("production")).toBe(false);
      expect(isTest("test")).toBe(true);
      expect(isTest("development")).toBe(false);
    });
  });

  describe("Development Environment Validation", () => {
    it("accepts valid development configuration with defaults", () => {
      const devConfig = validateConfig({
        NODE_ENV: "development",
      });

      expect(devConfig.NODE_ENV).toBe("development");
      expect(devConfig.PORT).toBe(3000);
      expect(devConfig.HOST).toBe("0.0.0.0");
      expect(devConfig.DATABASE_URL).toContain("localhost");
      expect(devConfig.BETTER_AUTH_URL).toBe("http://localhost:3000");
    });

    it("coerces string port to integer", () => {
      const customConfig = validateConfig({
        NODE_ENV: "development",
        PORT: "4000",
      });

      expect(customConfig.PORT).toBe(4000);
    });
  });

  describe("Field Constraint Validations", () => {
    it("rejects invalid NODE_ENV value", () => {
      expect(() =>
        validateConfig({
          NODE_ENV: "staging",
        })
      ).toThrow(ConfigurationError);
    });

    it("rejects out-of-range port numbers", () => {
      expect(() =>
        validateConfig({
          PORT: "0",
        })
      ).toThrow(ConfigurationError);

      expect(() =>
        validateConfig({
          PORT: "70000",
        })
      ).toThrow(ConfigurationError);

      expect(() =>
        validateConfig({
          PORT: "invalid-port",
        })
      ).toThrow(ConfigurationError);
    });

    it("rejects non-postgres database URLs", () => {
      expect(() =>
        validateConfig({
          DATABASE_URL: "mysql://user:pass@localhost:3306/db",
        })
      ).toThrow(ConfigurationError);
    });

    it("rejects invalid URL for BETTER_AUTH_URL", () => {
      expect(() =>
        validateConfig({
          BETTER_AUTH_URL: "not-a-valid-url",
        })
      ).toThrow(ConfigurationError);
    });

    it("rejects short BETTER_AUTH_SECRET (< 32 characters)", () => {
      expect(() =>
        validateConfig({
          BETTER_AUTH_SECRET: "short_secret",
        })
      ).toThrow(ConfigurationError);
    });
  });

  describe("Production Fail-Fast & Safety Guardrails", () => {
    const validProductionEnv = {
      NODE_ENV: "production",
      PORT: "8080",
      DATABASE_URL: "postgresql://cloud_user:sUpEr$eCrEt@db.remotehost.com:5432/moneycomes_prod",
      BETTER_AUTH_SECRET: "k9V#m2X$zL7pQ!wR4tY6uI1oP8aS3dF5gH7jK9lM2nB4vC6",
      BETTER_AUTH_URL: "https://api.moneycomes.com",
      CORS_ORIGIN: "https://app.moneycomes.com,https://moneycomes.com",
      TRUSTED_ORIGINS: "https://app.moneycomes.com,https://moneycomes.com",
    };

    it("accepts well-formed production configuration", () => {
      const prodConfig = validateConfig(validProductionEnv);

      expect(prodConfig.NODE_ENV).toBe("production");
      expect(prodConfig.PORT).toBe(8080);
      expect(prodConfig.DATABASE_URL).toContain("db.remotehost.com");
      expect(prodConfig.BETTER_AUTH_URL).toBe("https://api.moneycomes.com");
      expect(prodConfig.CORS_ORIGIN).not.toContain("*");
    });

    it("fails fast if production uses default development auth secret", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          BETTER_AUTH_SECRET:
            "dev_secret_key_at_least_32_characters_long_for_better_auth_foundation",
        })
      ).toThrow("BETTER_AUTH_SECRET must be explicitly set to a cryptographically secure random secret");
    });

    it("fails fast if production uses placeholder or weak auth secret", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          BETTER_AUTH_SECRET: "your_development_secret_here_minimum_32_characters",
        })
      ).toThrow("BETTER_AUTH_SECRET must be explicitly set to a cryptographically secure random secret");

      expect(() =>
        validateConfig({
          ...validProductionEnv,
          BETTER_AUTH_SECRET: "placeholder_auth_secret_longer_than_32_chars_for_testing",
        })
      ).toThrow("BETTER_AUTH_SECRET must be explicitly set to a cryptographically secure random secret");
    });

    it("fails fast if production points to localhost or 127.0.0.1 database", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/moneycomes",
        })
      ).toThrow("DATABASE_URL cannot point to localhost or 127.0.0.1 in production mode");

      expect(() =>
        validateConfig({
          ...validProductionEnv,
          DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/moneycomes",
        })
      ).toThrow("DATABASE_URL cannot point to localhost or 127.0.0.1 in production mode");
    });

    it("fails fast if production enables wildcard CORS origin", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          CORS_ORIGIN: "*",
        })
      ).toThrow("CORS_ORIGIN cannot be a wildcard (*) in production mode");

      expect(() =>
        validateConfig({
          ...validProductionEnv,
          CORS_ORIGIN: "https://app.moneycomes.com, *",
        })
      ).toThrow("CORS_ORIGIN cannot be a wildcard (*) in production mode");
    });

    it("fails fast if production auth URL points to localhost", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          BETTER_AUTH_URL: "http://localhost:3000",
        })
      ).toThrow("BETTER_AUTH_URL cannot point to localhost or 127.0.0.1 in production mode");
    });

    it("fails fast if production trusted origins contain wildcard", () => {
      expect(() =>
        validateConfig({
          ...validProductionEnv,
          TRUSTED_ORIGINS: "*",
        })
      ).toThrow("TRUSTED_ORIGINS cannot contain wildcard (*) in production mode");
    });
  });

  describe("Secret Masking & Error Message Safety", () => {
    it("never exposes sensitive database credentials in error messages", () => {
      const sensitivePassword = "SuperSecretPassword123!";
      try {
        validateConfig({
          NODE_ENV: "production",
          DATABASE_URL: `postgresql://admin:${sensitivePassword}@localhost:5432/prod_db`,
        });
        expect.unreachable("Validation should have failed");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const errorMessage = (err as Error).message;
        expect(errorMessage).not.toContain(sensitivePassword);
        expect(errorMessage).toContain("DATABASE_URL");
      }
    });

    it("never exposes sensitive auth secrets in error messages", () => {
      const sensitiveSecret = "my-secret-key-that-is-too-short";
      try {
        validateConfig({
          BETTER_AUTH_SECRET: sensitiveSecret,
        });
        expect.unreachable("Validation should have failed");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        const errorMessage = (err as Error).message;
        expect(errorMessage).not.toContain(sensitiveSecret);
        expect(errorMessage).toContain("BETTER_AUTH_SECRET");
      }
    });
  });

  describe("Test Environment Isolation", () => {
    it("safely isolates test configuration with non-production defaults", () => {
      const testConfig = validateConfig({
        NODE_ENV: "test",
      });

      expect(testConfig.NODE_ENV).toBe("test");
      expect(testConfig.PORT).toBe(3000);
      expect(testConfig.DATABASE_URL).toBeDefined();
    });
  });
});
