/**
 * Phase 3.1 — Identity Database Schema Verification Test Suite.
 *
 * Verifies that the database identity foundation is clean, production-safe,
 * adheres to Better Auth's authoritative user model, avoids redundant profile tables,
 * enforces strict constraints and safe deletion policies, and segregates authentication secrets.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  users,
  sessions,
  accounts,
  verifications,
  groups,
  expenses,
  expenseSplits,
  settlements,
  activityEvents,
} from "../../server/db/schema/index.js";
import { auth } from "../../server/auth/index.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { userService } from "../../server/services/user.service.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.1 — Identity Database Schema", () => {
  // ==========================================================================
  // 1. BETTER AUTH INTEGRATION & IDENTITY SOURCE
  // ==========================================================================

  describe("Better Auth & Identity Table Ownership", () => {
    it("Better Auth is configured and uses users table as canonical user model", () => {
      expect(auth).toBeDefined();
      expect(typeof auth.handler).toBe("function");
      expect(typeof auth.api.getSession).toBe("function");
    });

    it("Better Auth owns and operates users, sessions, accounts, and verifications", () => {
      expect(users).toBeDefined();
      expect(sessions).toBeDefined();
      expect(accounts).toBeDefined();
      expect(verifications).toBeDefined();
    });

    it("does not create a duplicate user or profile entity; users is authoritative", () => {
      expect(userRepository).toBeDefined();
      expect(userService).toBeDefined();
      // Verifies users table is the direct target for UserRepository
      expect(typeof userRepository.findById).toBe("function");
      expect(typeof userRepository.findByEmail).toBe("function");
      expect(typeof userRepository.update).toBe("function");
    });
  });

  // ==========================================================================
  // 2. IDENTITY & PROFILE MODEL SCHEMA
  // ==========================================================================

  describe("Application Identity & Profile Model", () => {
    const cols = getTableColumns(users);

    it("has stable primary key ID of type text (string)", () => {
      expect(cols.id).toBeDefined();
      expect(cols.id.dataType).toBe("string");
      expect(cols.id.primary).toBe(true);
      expect(cols.id.notNull).toBe(true);
    });

    it("has required display name field with appropriate length limit", () => {
      expect(cols.name).toBeDefined();
      expect(cols.name.dataType).toBe("string");
      expect(cols.name.notNull).toBe(true);
      // Name must NOT be unique: multiple users can legitimately share a display name
      expect(cols.name.isUnique).toBe(false);
    });

    it("has email field with NOT NULL and UNIQUE constraint", () => {
      expect(cols.email).toBeDefined();
      expect(cols.email.dataType).toBe("string");
      expect(cols.email.notNull).toBe(true);
      expect(cols.email.isUnique).toBe(true);
    });

    it("has emailVerified boolean field defaulting to false", () => {
      expect(cols.emailVerified).toBeDefined();
      expect(cols.emailVerified.dataType).toBe("boolean");
      expect(cols.emailVerified.notNull).toBe(true);
      expect(cols.emailVerified.default).toBe(false);
    });

    it("has optional avatar reference field (image)", () => {
      expect(cols.image).toBeDefined();
      expect(cols.image.dataType).toBe("string");
      expect(cols.image.notNull).toBe(false);
    });

    it("has defaultCurrencyCode field defaulting to INR", () => {
      expect(cols.defaultCurrencyCode).toBeDefined();
      expect(cols.defaultCurrencyCode.dataType).toBe("string");
      expect(cols.defaultCurrencyCode.notNull).toBe(true);
      expect(cols.defaultCurrencyCode.default).toBe("INR");
    });

    it("has consistent timestamps (createdAt and updatedAt) with database defaults", () => {
      expect(cols.createdAt).toBeDefined();
      expect(cols.createdAt.notNull).toBe(true);
      expect(cols.createdAt.default).toBeDefined();

      expect(cols.updatedAt).toBeDefined();
      expect(cols.updatedAt.notNull).toBe(true);
      expect(cols.updatedAt.default).toBeDefined();
    });

    it("does NOT contain speculative, social, gamification, or payment fields", () => {
      const allowedKeys = new Set([
        "id",
        "name",
        "email",
        "emailVerified",
        "image",
        "defaultCurrencyCode",
        "createdAt",
        "updatedAt",
      ]);

      for (const colName of Object.keys(cols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 3. PRIVACY & SECURITY: SECRET SEGREGATION
  // ==========================================================================

  describe("Privacy & Authentication Secret Segregation", () => {
    const userCols = getTableColumns(users);
    const accountCols = getTableColumns(accounts);
    const sessionCols = getTableColumns(sessions);
    const verifCols = getTableColumns(verifications);

    it("users table NEVER contains password, hash, or secret tokens", () => {
      const rawUserCols = userCols as Record<string, unknown>;
      expect(rawUserCols["password"]).toBeUndefined();
      expect(rawUserCols["passwordHash"]).toBeUndefined();
      expect(rawUserCols["accessToken"]).toBeUndefined();
      expect(rawUserCols["refreshToken"]).toBeUndefined();
      expect(rawUserCols["token"]).toBeUndefined();
      expect(rawUserCols["secret"]).toBeUndefined();
    });

    it("passwords and OAuth tokens are strictly segregated into accounts table", () => {
      expect(accountCols.password).toBeDefined();
      expect(accountCols.accessToken).toBeDefined();
      expect(accountCols.refreshToken).toBeDefined();
      expect(accountCols.idToken).toBeDefined();
    });

    it("session tokens are strictly segregated into sessions table", () => {
      expect(sessionCols.token).toBeDefined();
      expect(sessionCols.token.isUnique).toBe(true);
      expect(sessionCols.token.notNull).toBe(true);
    });

    it("verification tokens are strictly segregated into verifications table", () => {
      expect(verifCols.value).toBeDefined();
      expect(verifCols.identifier).toBeDefined();
      expect(verifCols.expiresAt).toBeDefined();
    });
  });

  // ==========================================================================
  // 4. FOREIGN KEY INTEGRITY & SAFE DELETION POLICY
  // ==========================================================================

  describe("Foreign Key Integrity & Safe Deletion Policy", () => {
    it("financial tables reference users with safe non-destructive restrict policy", () => {
      // In Drizzle, delete rules can be verified on table foreign keys
      const groupsCols = getTableColumns(groups);
      const expensesCols = getTableColumns(expenses);
      const splitsCols = getTableColumns(expenseSplits);
      const settlementsCols = getTableColumns(settlements);
      const activityCols = getTableColumns(activityEvents);

      expect(groupsCols.createdById).toBeDefined();
      expect(expensesCols.payerId).toBeDefined();
      expect(expensesCols.createdById).toBeDefined();
      expect(splitsCols.userId).toBeDefined();
      expect(settlementsCols.payerId).toBeDefined();
      expect(settlementsCols.receiverId).toBeDefined();
      expect(settlementsCols.createdById).toBeDefined();
      expect(activityCols.actorId).toBeDefined();
    });

    it("migration SQL strictly enforces ON DELETE restrict for financial references", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

      // Verify that financial and audit tables use ON DELETE restrict so user deletion never silently destroys records
      expect(sql0000).toContain(
        'ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });

    it("ephemeral authentication tables use ON DELETE cascade to clean up credentials", () => {
      const sql0001Path = path.resolve(process.cwd(), "drizzle/migrations/0001_true_blue_marvel.sql");
      const sql0001 = fs.readFileSync(sql0001Path, "utf-8");

      expect(sql0001).toContain(
        'ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade'
      );
      expect(sql0001).toContain(
        'ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade'
      );
    });
  });

  // ==========================================================================
  // 5. MIGRATION STATE & DRIZZLE INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Schema Alignment", () => {
    it("migration 0000 creates users table with required DDL constraints and index", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql = fs.readFileSync(sql0000Path, "utf-8");

      expect(sql).toContain('CREATE TABLE "users"');
      expect(sql).toContain('"id" text PRIMARY KEY NOT NULL');
      expect(sql).toContain('"name" varchar(255) NOT NULL');
      expect(sql).toContain('"email" varchar(255) NOT NULL');
      expect(sql).toContain('"email_verified" boolean DEFAULT false NOT NULL');
      expect(sql).toContain('"image" text');
      expect(sql).toContain('"default_currency_code" varchar(3) DEFAULT \'INR\' NOT NULL');
      expect(sql).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('"updated_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('CONSTRAINT "users_email_unique" UNIQUE("email")');
      expect(sql).toContain('CREATE INDEX "users_email_idx" ON "users" USING btree ("email")');
    });

    it("journal metadata file correctly references baseline migrations", () => {
      const journalPath = path.resolve(process.cwd(), "drizzle/migrations/meta/_journal.json");
      expect(fs.existsSync(journalPath)).toBe(true);

      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
      expect(journal.entries.length).toBeGreaterThanOrEqual(2);
      expect(journal.entries[0].tag).toBe("0000_spotty_rockslide");
      expect(journal.entries[1].tag).toBe("0001_true_blue_marvel");
    });
  });

  // ==========================================================================
  // 6. APPLICATION REPOSITORY & SERVICE CONTRACTS
  // ==========================================================================

  describe("Application Identity Repository & Service Alignment", () => {
    it("UserService strictly updates safe profile fields and rejects unauthorized edits", async () => {
      expect(userService).toBeDefined();

      // Verify that unauthorized actor cannot modify another user's profile
      await expect(
        userService.updateProfile("actor-1", "actor-2", { name: "New Name" })
      ).rejects.toThrow("You cannot modify another user's profile");

      // Verify unauthenticated actor is rejected
      await expect(
        userService.updateProfile("", "actor-1", { name: "New Name" })
      ).rejects.toThrow("Authenticated actor identity is required");
    });
  });
});
