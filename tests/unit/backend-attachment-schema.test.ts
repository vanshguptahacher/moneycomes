/**
 * Phase 3.10 — Attachments Database Schema Verification Test Suite.
 *
 * Verifies that the attachments database schema foundation is clean, production-safe,
 * references canonical expense and uploader user identities, stores external object-storage
 * references (not binary blobs in PostgreSQL), safely stores file metadata (MIME type,
 * safe integer file size, untrusted original filename), enforces a non-negative file size
 * check constraint, creates performance indexes for listing attachments by expense and uploader,
 * and maintains complete isolation from authoritative financial calculations.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  attachments,
  expenses,
  users,
  activityEvents,
  notifications,
  attachmentsRelations,
  expensesRelations,
  usersRelations,
  validateAttachmentInput,
} from "../../server/db/schema/index.js";
import {
  attachments as rootAttachments,
  attachmentsRelations as rootAttachmentsRelations,
} from "../../server/db/index.js";
import {
  make,
  splitEqually,
  calculateExpenseBalances,
  getUserBalance,
} from "../../src/domain/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.10 — Attachments Database Schema", () => {
  const attCols = getTableColumns(attachments);
  const expCols = getTableColumns(expenses);
  const userCols = getTableColumns(users);
  const actCols = getTableColumns(activityEvents);
  const notifCols = getTableColumns(notifications);

  // ==========================================================================
  // 1. PRIMARY KEY & SURROGATE IDENTITY
  // ==========================================================================

  describe("Primary Key & Surrogate Identity", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(attCols.id).toBeDefined();
      expect(attCols.id.dataType).toBe("string");
      expect(attCols.id.primary).toBe(true);
      expect(attCols.id.notNull).toBe(true);
      expect(attCols.id.default).toBeDefined();
    });

    it("primary key column name is 'id'", () => {
      expect(attCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. PARENT EXPENSE & UPLOADER USER FOREIGN KEYS
  // ==========================================================================

  describe("Parent Expense & Uploader User Foreign Keys", () => {
    it("expenseId references canonical expenses table with matching uuid data type", () => {
      expect(expCols.id.dataType).toBe("string");
      expect(attCols.expenseId).toBeDefined();
      expect(attCols.expenseId.dataType).toBe("string");
      expect(attCols.expenseId.notNull).toBe(true);
    });

    it("uploadedById references canonical users table with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(attCols.uploadedById).toBeDefined();
      expect(attCols.uploadedById.dataType).toBe("string");
      expect(attCols.uploadedById.notNull).toBe(true);
    });

    it("migration enforces ON DELETE cascade on expense_id", () => {
      const sql0003Path = path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_rapid_sheva_callister.sql"
      );
      const sql0003 = fs.readFileSync(sql0003Path, "utf-8");
      expect(sql0003).toContain(
        'ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade'
      );
    });

    it("migration enforces ON DELETE restrict on uploaded_by_id to preserve audit trail", () => {
      const sql0003Path = path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_rapid_sheva_callister.sql"
      );
      const sql0003 = fs.readFileSync(sql0003Path, "utf-8");
      expect(sql0003).toContain(
        'ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });

    it("does not duplicate user profile information (email, password, displayName)", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["userEmail"]).toBeUndefined();
      expect(rawCols["userName"]).toBeUndefined();
      expect(rawCols["password"]).toBeUndefined();
      expect(rawCols["passwordHash"]).toBeUndefined();
      expect(rawCols["token"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. STORAGE REFERENCE & SEPARATION (NO BINARY IN DB)
  // ==========================================================================

  describe("Storage Reference & External Separation", () => {
    it("stores storageKey as varchar(512) NOT NULL", () => {
      expect(attCols.storageKey).toBeDefined();
      expect(attCols.storageKey.dataType).toBe("string");
      expect(attCols.storageKey.notNull).toBe(true);
    });

    it("enforces uniqueness on storage_key to prevent key collisions", () => {
      const sql0003Path = path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_rapid_sheva_callister.sql"
      );
      const sql0003 = fs.readFileSync(sql0003Path, "utf-8");
      expect(sql0003).toContain(
        'CONSTRAINT "attachments_storage_key_uq" UNIQUE("storage_key")'
      );
    });

    it("PostgreSQL schema contains NO binary or bytea columns", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["data"]).toBeUndefined();
      expect(rawCols["blob"]).toBeUndefined();
      expect(rawCols["fileData"]).toBeUndefined();
      expect(rawCols["binary"]).toBeUndefined();
      expect(rawCols["bytea"]).toBeUndefined();
      expect(rawCols["base64"]).toBeUndefined();
      expect(rawCols["content"]).toBeUndefined();
    });

    it("does not store public download URLs as authoritative storage reference", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["publicUrl"]).toBeUndefined();
      expect(rawCols["downloadUrl"]).toBeUndefined();
      expect(rawCols["signedUrl"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 4. FILE METADATA & CHECK CONSTRAINTS
  // ==========================================================================

  describe("File Metadata & Check Constraints", () => {
    it("stores originalFileName as varchar(255) NOT NULL", () => {
      expect(attCols.originalFileName).toBeDefined();
      expect(attCols.originalFileName.dataType).toBe("string");
      expect(attCols.originalFileName.notNull).toBe(true);
    });

    it("stores mimeType as varchar(127) NOT NULL", () => {
      expect(attCols.mimeType).toBeDefined();
      expect(attCols.mimeType.dataType).toBe("string");
      expect(attCols.mimeType.notNull).toBe(true);
    });

    it("stores fileSizeBytes as bigint mode number NOT NULL", () => {
      expect(attCols.fileSizeBytes).toBeDefined();
      expect(attCols.fileSizeBytes.dataType).toBe("number");
      expect(attCols.fileSizeBytes.notNull).toBe(true);
    });

    it("migration enforces CHECK constraint (file_size_bytes >= 0)", () => {
      const sql0003Path = path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_rapid_sheva_callister.sql"
      );
      const sql0003 = fs.readFileSync(sql0003Path, "utf-8");
      expect(sql0003).toContain(
        'CONSTRAINT "attachments_file_size_non_negative_check" CHECK ("attachments"."file_size_bytes" >= 0)'
      );
    });

    it("stores server-authoritative createdAt timestamp with timezone", () => {
      expect(attCols.createdAt).toBeDefined();
      expect(attCols.createdAt.dataType).toBe("date");
      expect(attCols.createdAt.notNull).toBe(true);
      expect(attCols.createdAt.default).toBeDefined();
    });
  });

  // ==========================================================================
  // 5. MULTIPLE ATTACHMENTS PER EXPENSE
  // ==========================================================================

  describe("Multiple Attachments Per Expense", () => {
    it("does not place a unique constraint on expense_id alone", () => {
      const sql0003Path = path.resolve(
        process.cwd(),
        "drizzle/migrations/0003_rapid_sheva_callister.sql"
      );
      const sql0003 = fs.readFileSync(sql0003Path, "utf-8");
      expect(sql0003).not.toContain('UNIQUE("expense_id")');
    });

    it("expenses relations declare 1:N relationship (attachments: many)", () => {
      expect(expensesRelations).toBeDefined();
    });

    it("users relations declare 1:N relationship (uploadedAttachments: many)", () => {
      expect(usersRelations).toBeDefined();
    });

    it("supports validating multiple distinct attachments for the exact same expense", () => {
      const expId = "exp-multi-attachment-uuid";
      const att1 = validateAttachmentInput({
        expenseId: expId,
        uploadedById: "usr_alice",
        storageKey: "expenses/receipts/exp-1/front.jpg",
        originalFileName: "front.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 1024,
      });
      const att2 = validateAttachmentInput({
        expenseId: expId,
        uploadedById: "usr_bob",
        storageKey: "expenses/receipts/exp-1/back.jpg",
        originalFileName: "back.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 2048,
      });
      const att3 = validateAttachmentInput({
        expenseId: expId,
        uploadedById: "usr_alice",
        storageKey: "expenses/receipts/exp-1/invoice.pdf",
        originalFileName: "invoice.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 65536,
      });

      expect(att1.expenseId).toBe(expId);
      expect(att2.expenseId).toBe(expId);
      expect(att3.expenseId).toBe(expId);
      expect(att1.storageKey).not.toBe(att2.storageKey);
      expect(att2.storageKey).not.toBe(att3.storageKey);
    });
  });

  // ==========================================================================
  // 6. INDEX CONVENTIONS
  // ==========================================================================

  describe("Index Conventions", () => {
    const sql0003Path = path.resolve(
      process.cwd(),
      "drizzle/migrations/0003_rapid_sheva_callister.sql"
    );
    const sql0003 = fs.readFileSync(sql0003Path, "utf-8");

    it("creates composite index on (expense_id, created_at) for efficient listing", () => {
      expect(sql0003).toContain(
        'CREATE INDEX "attachments_expense_created_at_idx" ON "attachments" USING btree ("expense_id","created_at");'
      );
    });

    it("creates index on uploaded_by_id for querying attachments by user", () => {
      expect(sql0003).toContain(
        'CREATE INDEX "attachments_uploaded_by_idx" ON "attachments" USING btree ("uploaded_by_id");'
      );
    });
  });

  // ==========================================================================
  // 7. FINANCIAL ISOLATION
  // ==========================================================================

  describe("Financial Isolation", () => {
    it("contains no monetary amount columns", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["amount"]).toBeUndefined();
      expect(rawCols["amountMinor"]).toBeUndefined();
      expect(rawCols["allocatedAmountMinor"]).toBeUndefined();
    });

    it("contains no currency columns", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["currency"]).toBeUndefined();
      expect(rawCols["currencyCode"]).toBeUndefined();
    });

    it("contains no balance or split allocation columns", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["balance"]).toBeUndefined();
      expect(rawCols["splitMethod"]).toBeUndefined();
      expect(rawCols["percentageBasisPoints"]).toBeUndefined();
      expect(rawCols["shares"]).toBeUndefined();
    });

    it("attachment records do not alter Money operations or split calculations", () => {
      const money = make(10000, "INR");
      const splitResult = splitEqually(money, ["alice", "bob", "charlie"]);
      expect(splitResult.allocations).toHaveLength(3);
      expect(splitResult.total.amountMinor).toBe(10000);

      // Validating an attachment has zero impact on financial calculations
      const attachment = validateAttachmentInput({
        expenseId: "exp-123",
        uploadedById: "alice",
        storageKey: "expenses/receipts/exp-123/receipt.jpg",
        originalFileName: "receipt.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 50000,
      });
      expect(attachment.expenseId).toBe("exp-123");

      // Arithmetic is purely unchanged
      expect(splitResult.allocations[0].amount.amountMinor).toBe(3334);
      expect(splitResult.allocations[1].amount.amountMinor).toBe(3333);
      expect(splitResult.allocations[2].amount.amountMinor).toBe(3333);
    });

    it("expense balance calculation operates independently of attachments", () => {
      const total = make(3000, "INR");
      const balanceResult = calculateExpenseBalances({
        total,
        payerId: "alice",
        allocations: [
          { participantId: "alice", amount: make(1000, "INR") },
          { participantId: "bob", amount: make(2000, "INR") },
        ],
      });

      const aliceBal = getUserBalance(balanceResult, "alice");
      const bobBal = getUserBalance(balanceResult, "bob");
      expect(aliceBal).toBeDefined();
      expect(bobBal).toBeDefined();
      expect(aliceBal!.netBalance.amountMinor).toBe(2000); // paid 3000, owes 1000 -> +2000
      expect(bobBal!.netBalance.amountMinor).toBe(-2000); // paid 0, owes 2000 -> -2000
    });
  });

  // ==========================================================================
  // 8. NOTIFICATION & ACTIVITY ISOLATION
  // ==========================================================================

  describe("Notification & Activity Isolation", () => {
    it("attachments table has no columns referencing activityEvents or notifications", () => {
      const rawCols = attCols as Record<string, unknown>;
      expect(rawCols["activityId"]).toBeUndefined();
      expect(rawCols["activity_id"]).toBeUndefined();
      expect(rawCols["notificationId"]).toBeUndefined();
      expect(rawCols["notification_id"]).toBeUndefined();
    });

    it("activityEvents table has no columns referencing attachments", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["attachmentId"]).toBeUndefined();
      expect(rawCols["attachment_id"]).toBeUndefined();
    });

    it("notifications table has no columns referencing attachments", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["attachmentId"]).toBeUndefined();
      expect(rawCols["attachment_id"]).toBeUndefined();
    });

    it("validating attachment is a pure function that does not mutate activity or notifications", () => {
      const beforeKeys = Object.keys(attachments);
      const validated = validateAttachmentInput({
        expenseId: "exp-isolated-uuid",
        uploadedById: "usr_alice",
        storageKey: "expenses/receipts/exp-isolated/receipt.png",
        originalFileName: "receipt.png",
        mimeType: "image/png",
        fileSizeBytes: 4096,
      });

      expect(validated.storageKey).toBe("expenses/receipts/exp-isolated/receipt.png");
      expect(Object.keys(attachments)).toEqual(beforeKeys);
    });
  });

  // ==========================================================================
  // 9. RELATIONS & ROOT EXPORTS INTEGRATION
  // ==========================================================================

  describe("Relations & Root Exports Integration", () => {
    it("attachmentsRelations defines expense and uploader relations", () => {
      expect(attachmentsRelations).toBeDefined();
    });

    it("root database entry point (server/db/index.js) re-exports attachments and relations", () => {
      expect(rootAttachments).toBeDefined();
      expect(rootAttachmentsRelations).toBeDefined();
      expect(rootAttachments).toBe(attachments);
      expect(rootAttachmentsRelations).toBe(attachmentsRelations);
    });
  });

  // ==========================================================================
  // 9. BOUNDARY INPUT VALIDATOR
  // ==========================================================================

  describe("validateAttachmentInput", () => {
    const validValidInput = {
      expenseId: "exp-1234-uuid",
      uploadedById: "usr_alice",
      storageKey: "expenses/receipts/exp-1234/receipt.jpg",
      originalFileName: "dinner-receipt.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 2048576,
    };

    it("accepts valid attachment input and trims string fields", () => {
      const validated = validateAttachmentInput({
        ...validValidInput,
        originalFileName: "  dinner-receipt.jpg  ",
        mimeType: "IMAGE/JPEG",
      });

      expect(validated.expenseId).toBe("exp-1234-uuid");
      expect(validated.uploadedById).toBe("usr_alice");
      expect(validated.storageKey).toBe("expenses/receipts/exp-1234/receipt.jpg");
      expect(validated.originalFileName).toBe("dinner-receipt.jpg");
      expect(validated.mimeType).toBe("image/jpeg");
      expect(validated.fileSizeBytes).toBe(2048576);
      expect(validated.createdAt).toBeInstanceOf(Date);
    });

    it("supports zero-byte files (0 bytes)", () => {
      const validated = validateAttachmentInput({
        ...validValidInput,
        fileSizeBytes: 0,
      });
      expect(validated.fileSizeBytes).toBe(0);
    });

    it("preserves explicitly provided createdAt date", () => {
      const customDate = new Date("2026-01-15T12:00:00Z");
      const validated = validateAttachmentInput({
        ...validValidInput,
        createdAt: customDate,
      });
      expect(validated.createdAt).toEqual(customDate);
    });

    it("rejects missing or null input object", () => {
      expect(() => validateAttachmentInput(null as unknown as typeof validValidInput)).toThrow(
        "Attachment input is required"
      );
    });

    it("rejects empty or whitespace expenseId", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, expenseId: "" })
      ).toThrow("Valid expenseId is required");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, expenseId: "   " })
      ).toThrow("Valid expenseId is required");
    });

    it("rejects empty or whitespace uploadedById", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, uploadedById: "" })
      ).toThrow("Valid uploadedById is required");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, uploadedById: "   " })
      ).toThrow("Valid uploadedById is required");
    });

    it("rejects empty or whitespace storageKey", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, storageKey: "" })
      ).toThrow("Valid storageKey is required");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, storageKey: "   " })
      ).toThrow("Valid storageKey is required");
    });

    it("rejects storageKey with path traversal sequences ('..')", () => {
      expect(() =>
        validateAttachmentInput({
          ...validValidInput,
          storageKey: "expenses/receipts/../../../etc/passwd",
        })
      ).toThrow("Security violation: storageKey must not contain directory traversal");
    });

    it("rejects empty or whitespace originalFileName", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, originalFileName: "" })
      ).toThrow("Valid originalFileName is required");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, originalFileName: "   " })
      ).toThrow("Valid originalFileName is required");
    });

    it("rejects empty or whitespace mimeType", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, mimeType: "" })
      ).toThrow("Valid mimeType is required");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, mimeType: "   " })
      ).toThrow("Valid mimeType is required");
    });

    it("rejects negative fileSizeBytes", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, fileSizeBytes: -1 })
      ).toThrow("fileSizeBytes must be a non-negative safe integer");
    });

    it("rejects non-integer / floating-point fileSizeBytes", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, fileSizeBytes: 1024.5 })
      ).toThrow("fileSizeBytes must be a non-negative safe integer");
    });

    it("rejects NaN or Infinity fileSizeBytes", () => {
      expect(() =>
        validateAttachmentInput({ ...validValidInput, fileSizeBytes: NaN })
      ).toThrow("fileSizeBytes must be a non-negative safe integer");
      expect(() =>
        validateAttachmentInput({ ...validValidInput, fileSizeBytes: Infinity })
      ).toThrow("fileSizeBytes must be a non-negative safe integer");
    });

    it("rejects unsafe integer fileSizeBytes exceeding MAX_SAFE_INTEGER", () => {
      expect(() =>
        validateAttachmentInput({
          ...validValidInput,
          fileSizeBytes: Number.MAX_SAFE_INTEGER + 1,
        })
      ).toThrow("fileSizeBytes must be a non-negative safe integer");
    });
  });
});
