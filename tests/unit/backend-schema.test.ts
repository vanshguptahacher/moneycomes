import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  users,
  currencies,
  categories,
  friendships,
  groups,
  groupMembers,
  expenses,
  expenseSplits,
  settlements,
  activityEvents,
  sessions,
  accounts,
  verifications,
  usersRelations,
  currenciesRelations,
  categoriesRelations,
  friendshipsRelations,
  groupsRelations,
  groupMembersRelations,
  expensesRelations,
  expenseSplitsRelations,
  settlementsRelations,
  activityEventsRelations,
  sessionsRelations,
  accountsRelations,
} from "../../server/db/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Database Schema Foundation (Phase 1.2 & 1.3)", () => {
  describe("Table Exports and Registrations", () => {
    it("exports all 13 core and auth tables from database schema", () => {
      expect(users).toBeDefined();
      expect(currencies).toBeDefined();
      expect(categories).toBeDefined();
      expect(friendships).toBeDefined();
      expect(groups).toBeDefined();
      expect(groupMembers).toBeDefined();
      expect(expenses).toBeDefined();
      expect(expenseSplits).toBeDefined();
      expect(settlements).toBeDefined();
      expect(activityEvents).toBeDefined();
      expect(sessions).toBeDefined();
      expect(accounts).toBeDefined();
      expect(verifications).toBeDefined();
    });

    it("exports all relation definitions", () => {
      expect(usersRelations).toBeDefined();
      expect(currenciesRelations).toBeDefined();
      expect(categoriesRelations).toBeDefined();
      expect(friendshipsRelations).toBeDefined();
      expect(groupsRelations).toBeDefined();
      expect(groupMembersRelations).toBeDefined();
      expect(expensesRelations).toBeDefined();
      expect(expenseSplitsRelations).toBeDefined();
      expect(settlementsRelations).toBeDefined();
      expect(activityEventsRelations).toBeDefined();
      expect(sessionsRelations).toBeDefined();
      expect(accountsRelations).toBeDefined();
    });
  });

  describe("Users Table", () => {
    const cols = getTableColumns(users);

    it("has required columns for Better Auth compatibility and profile info", () => {
      expect(cols.id).toBeDefined();
      expect(cols.id.dataType).toBe("string");
      expect(cols.id.primary).toBe(true);

      expect(cols.name).toBeDefined();
      expect(cols.name.notNull).toBe(true);

      expect(cols.email).toBeDefined();
      expect(cols.email.notNull).toBe(true);
      expect(cols.email.isUnique).toBe(true);

      expect(cols.emailVerified).toBeDefined();
      expect(cols.emailVerified.default).toBe(false);

      expect(cols.image).toBeDefined();
      expect(cols.defaultCurrencyCode).toBeDefined();
      expect(cols.defaultCurrencyCode.default).toBe("INR");

      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    });
  });

  describe("Currencies Table", () => {
    const cols = getTableColumns(currencies);

    it("supports ISO code primary key, minor units, and active state", () => {
      expect(cols.code).toBeDefined();
      expect(cols.code.primary).toBe(true);

      expect(cols.name).toBeDefined();
      expect(cols.symbol).toBeDefined();

      expect(cols.minorUnits).toBeDefined();
      expect(cols.minorUnits.default).toBe(2);

      expect(cols.isActive).toBeDefined();
      expect(cols.isActive.default).toBe(true);
    });
  });

  describe("Categories Table", () => {
    const cols = getTableColumns(categories);

    it("supports category name uniqueness and predefined flag", () => {
      expect(cols.id).toBeDefined();
      expect(cols.id.primary).toBe(true);

      expect(cols.name).toBeDefined();
      expect(cols.name.isUnique).toBe(true);

      expect(cols.isPredefined).toBeDefined();
      expect(cols.isPredefined.default).toBe(true);

      expect(cols.sortOrder).toBeDefined();
      expect(cols.sortOrder.default).toBe(0);
    });
  });

  describe("Friendships Table", () => {
    const cols = getTableColumns(friendships);

    it("enforces canonical two-user model with status", () => {
      expect(cols.id).toBeDefined();
      expect(cols.userId1).toBeDefined();
      expect(cols.userId2).toBeDefined();
      expect(cols.status).toBeDefined();
      expect(cols.status.default).toBe("active");
    });
  });

  describe("Groups and Group Members Tables", () => {
    const groupCols = getTableColumns(groups);
    const memberCols = getTableColumns(groupMembers);

    it("defines group attributes and default currency", () => {
      expect(groupCols.id).toBeDefined();
      expect(groupCols.name).toBeDefined();
      expect(groupCols.defaultCurrencyCode).toBeDefined();
      expect(groupCols.createdById).toBeDefined();
      expect(groupCols.isArchived).toBeDefined();
      expect(groupCols.isArchived.default).toBe(false);
    });

    it("defines group membership with roles", () => {
      expect(memberCols.id).toBeDefined();
      expect(memberCols.groupId).toBeDefined();
      expect(memberCols.userId).toBeDefined();
      expect(memberCols.role).toBeDefined();
      expect(memberCols.role.default).toBe("member");
      expect(memberCols.joinedAt).toBeDefined();
    });
  });

  describe("Expenses Table & Money Safety", () => {
    const expCols = getTableColumns(expenses);
    const splitCols = getTableColumns(expenseSplits);

    it("stores authoritative expense amounts as integer minor units (bigint), never floating-point", () => {
      expect(expCols.amountMinor).toBeDefined();
      expect(expCols.amountMinor.columnType).toBe("PgBigInt53");
      expect(expCols.amountMinor.dataType).toBe("number");
      expect(expCols.amountMinor.notNull).toBe(true);

      expect(expCols.currencyCode).toBeDefined();
      expect(expCols.splitMethod).toBeDefined();
      expect(expCols.payerId).toBeDefined();
      expect(expCols.createdById).toBeDefined();
      expect(expCols.date).toBeDefined();
      expect(expCols.isDeleted).toBeDefined();
      expect(expCols.isDeleted.default).toBe(false);
    });

    it("stores split allocations in integer minor units with support for exact, percentage, and shares", () => {
      expect(splitCols.allocatedAmountMinor).toBeDefined();
      expect(splitCols.allocatedAmountMinor.columnType).toBe("PgBigInt53");
      expect(splitCols.allocatedAmountMinor.dataType).toBe("number");
      expect(splitCols.allocatedAmountMinor.notNull).toBe(true);

      expect(splitCols.percentageBasisPoints).toBeDefined();
      expect(splitCols.shares).toBeDefined();
      expect(splitCols.expenseId).toBeDefined();
      expect(splitCols.userId).toBeDefined();
    });
  });

  describe("Settlements Table & Money Safety", () => {
    const cols = getTableColumns(settlements);

    it("stores authoritative settlement amounts as integer minor units (bigint)", () => {
      expect(cols.amountMinor).toBeDefined();
      expect(cols.amountMinor.columnType).toBe("PgBigInt53");
      expect(cols.amountMinor.dataType).toBe("number");
      expect(cols.amountMinor.notNull).toBe(true);

      expect(cols.payerId).toBeDefined();
      expect(cols.receiverId).toBeDefined();
      expect(cols.currencyCode).toBeDefined();
      expect(cols.settledAt).toBeDefined();
      expect(cols.createdById).toBeDefined();
    });
  });

  describe("Activity Events Table", () => {
    const cols = getTableColumns(activityEvents);

    it("provides audit log event structure with JSONB metadata", () => {
      expect(cols.id).toBeDefined();
      expect(cols.type).toBeDefined();
      expect(cols.actorId).toBeDefined();
      expect(cols.groupId).toBeDefined();
      expect(cols.entityType).toBeDefined();
      expect(cols.entityId).toBeDefined();
      expect(cols.metadata).toBeDefined();
      expect(cols.metadata.dataType).toBe("json");
      expect(cols.createdAt).toBeDefined();
    });
  });

  describe("Auth Tables (Sessions, Accounts, Verifications)", () => {
    const sessionCols = getTableColumns(sessions);
    const accountCols = getTableColumns(accounts);
    const verifCols = getTableColumns(verifications);

    it("defines sessions table with token uniqueness and user reference", () => {
      expect(sessionCols.id).toBeDefined();
      expect(sessionCols.id.primary).toBe(true);
      expect(sessionCols.token).toBeDefined();
      expect(sessionCols.token.isUnique).toBe(true);
      expect(sessionCols.userId).toBeDefined();
      expect(sessionCols.expiresAt).toBeDefined();
      expect(sessionCols.createdAt).toBeDefined();
      expect(sessionCols.updatedAt).toBeDefined();
    });

    it("defines accounts table with provider and user reference", () => {
      expect(accountCols.id).toBeDefined();
      expect(accountCols.id.primary).toBe(true);
      expect(accountCols.accountId).toBeDefined();
      expect(accountCols.providerId).toBeDefined();
      expect(accountCols.userId).toBeDefined();
      expect(accountCols.password).toBeDefined();
      expect(accountCols.createdAt).toBeDefined();
      expect(accountCols.updatedAt).toBeDefined();
    });

    it("defines verifications table with identifier and expiration", () => {
      expect(verifCols.id).toBeDefined();
      expect(verifCols.id.primary).toBe(true);
      expect(verifCols.identifier).toBeDefined();
      expect(verifCols.value).toBeDefined();
      expect(verifCols.expiresAt).toBeDefined();
    });
  });

  describe("Generated Migration SQL File Verification", () => {
    const migrationFilePath0000 = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const migrationFilePath0001 = path.resolve(process.cwd(), "drizzle/migrations/0001_true_blue_marvel.sql");

    it("both migration files exist on disk", () => {
      expect(fs.existsSync(migrationFilePath0000)).toBe(true);
      expect(fs.existsSync(migrationFilePath0001)).toBe(true);
    });

    it("initial migration 0000 contains core domain tables", () => {
      const sql = fs.readFileSync(migrationFilePath0000, "utf-8");

      expect(sql).toContain('CREATE TABLE "users"');
      expect(sql).toContain('CREATE TABLE "currencies"');
      expect(sql).toContain('CREATE TABLE "categories"');
      expect(sql).toContain('CREATE TABLE "friendships"');
      expect(sql).toContain('CREATE TABLE "groups"');
      expect(sql).toContain('CREATE TABLE "group_members"');
      expect(sql).toContain('CREATE TABLE "expenses"');
      expect(sql).toContain('CREATE TABLE "expense_splits"');
      expect(sql).toContain('CREATE TABLE "settlements"');
      expect(sql).toContain('CREATE TABLE "activity_events"');
    });

    it("auth migration 0001 contains accounts, sessions, and verifications tables with cascade foreign keys", () => {
      const sql = fs.readFileSync(migrationFilePath0001, "utf-8");

      expect(sql).toContain('CREATE TABLE "accounts"');
      expect(sql).toContain('CREATE TABLE "sessions"');
      expect(sql).toContain('CREATE TABLE "verifications"');
      expect(sql).toContain('ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade');
      expect(sql).toContain('ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade');
      expect(sql).toContain('CREATE INDEX "sessions_user_idx"');
      expect(sql).toContain('CREATE INDEX "sessions_token_idx"');
      expect(sql).toContain('CREATE INDEX "accounts_user_idx"');
      expect(sql).toContain('CREATE INDEX "verifications_identifier_idx"');
    });

    it("migration contains canonical ordering check and money constraints", () => {
      const sql = fs.readFileSync(migrationFilePath0000, "utf-8");

      // Canonical friendship constraint
      expect(sql).toContain('CONSTRAINT "friendships_canonical_order_check" CHECK ("friendships"."user_id_1" < "friendships"."user_id_2")');
      expect(sql).toContain('CONSTRAINT "friendships_users_uq" UNIQUE("user_id_1","user_id_2")');

      // Expense positive amount constraint
      expect(sql).toContain('CONSTRAINT "expenses_amount_positive_check" CHECK ("expenses"."amount_minor" > 0)');

      // Split non-negative amount constraint
      expect(sql).toContain('CONSTRAINT "expense_splits_amount_non_negative_check" CHECK ("expense_splits"."allocated_amount_minor" >= 0)');
      expect(sql).toContain('CONSTRAINT "expense_splits_expense_user_uq" UNIQUE("expense_id","user_id")');

      // Settlement positive amount and distinct users constraint
      expect(sql).toContain('CONSTRAINT "settlements_amount_positive_check" CHECK ("settlements"."amount_minor" > 0)');
      expect(sql).toContain('CONSTRAINT "settlements_distinct_users_check" CHECK ("settlements"."payer_id" != "settlements"."receiver_id")');

      // Group member uniqueness
      expect(sql).toContain('CONSTRAINT "group_members_group_user_uq" UNIQUE("group_id","user_id")');
    });

    it("migration creates indexes on foreign keys and critical query fields", () => {
      const sql = fs.readFileSync(migrationFilePath0000, "utf-8");

      expect(sql).toContain('CREATE INDEX "users_email_idx"');
      expect(sql).toContain('CREATE INDEX "friendships_user1_idx"');
      expect(sql).toContain('CREATE INDEX "friendships_user2_idx"');
      expect(sql).toContain('CREATE INDEX "group_members_group_idx"');
      expect(sql).toContain('CREATE INDEX "group_members_user_idx"');
      expect(sql).toContain('CREATE INDEX "expenses_group_idx"');
      expect(sql).toContain('CREATE INDEX "expenses_payer_idx"');
      expect(sql).toContain('CREATE INDEX "expenses_date_idx"');
      expect(sql).toContain('CREATE INDEX "settlements_payer_idx"');
      expect(sql).toContain('CREATE INDEX "settlements_receiver_idx"');
      expect(sql).toContain('CREATE INDEX "activity_created_at_idx"');
    });
  });
});
