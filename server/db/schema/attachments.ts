import {
  pgTable,
  uuid,
  text,
  varchar,
  bigint,
  timestamp,
  check,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { expenses } from "./expenses.js";
import { users } from "./users.js";

/**
 * Attachments Database Schema (Phase 3.10)
 *
 * Stores metadata and external object-storage references for files (receipts, invoices,
 * images, documents) associated with expenses.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Storage Separation: PostgreSQL stores ONLY metadata and external object-storage references
 *    (e.g., Supabase Storage, S3-compatible storage). No binary/blob data (BYTEA or base64)
 *    is stored in the database.
 * 2. Deletion Strategy & Physical Cleanup:
 *    - `expense_id` has ON DELETE cascade: when an expense is deleted, its attachment metadata
 *      records are automatically removed in PostgreSQL.
 *    - CRITICAL DISTINCTION: Deleting a database row does NOT automatically delete the physical file
 *      in external object storage. The future application/worker layer is responsible for external
 *      object storage file deletion/cleanup.
 *    - `uploaded_by_id` has ON DELETE restrict: preserves financial audit history and prevents
 *      accidental deletion of users who uploaded transaction receipts.
 * 3. Financial Isolation: Attachments contain no monetary amounts, splits, shares, or balances.
 *    The Expense and Financial Domain Engine remain the authoritative financial source of truth.
 * 4. Multi-attachment Support: Enforces a 1:N relationship (one expense can have multiple attachments)
 *    with no accidental uniqueness constraint on `expense_id`.
 * 5. Minimal & Relational Design (No Overengineering):
 *    - Storage Provider: No provider enum. Storage keys are provider-agnostic relative object paths;
 *      the active storage backend is managed via centralized server configuration.
 *    - Upload Status: No status enum. Direct or signed-URL upload flows in API phases manage state
 *      without requiring speculative asynchronous queue state machines in Phase 1.
 *    - Attachment Type: No type enum. All Phase 1 attachments represent expense receipts/invoices.
 *    - Original Filename: Stored as untrusted user input; never used as storage key or executed.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    originalFileName: varchar("original_file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 127 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("attachments_file_size_non_negative_check", sql`${table.fileSizeBytes} >= 0`),
    unique("attachments_storage_key_uq").on(table.storageKey),
    index("attachments_expense_created_at_idx").on(table.expenseId, table.createdAt),
    index("attachments_uploaded_by_idx").on(table.uploadedById),
  ]
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

/**
 * Validates an attachment input at the domain/schema boundary.
 * Enforces:
 * - expenseId is a non-empty string.
 * - uploadedById is a non-empty string.
 * - storageKey is a non-empty string and does not contain directory traversal sequences ("..").
 * - originalFileName is a non-empty string.
 * - mimeType is a non-empty string.
 * - fileSizeBytes is a non-negative safe integer representing file size in bytes.
 * - createdAt defaults to current date if omitted.
 */
export function validateAttachmentInput(input: {
  expenseId: string;
  uploadedById: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt?: Date | null;
}): {
  expenseId: string;
  uploadedById: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: Date;
} {
  if (!input) {
    throw new Error("Attachment input is required");
  }

  const {
    expenseId,
    uploadedById,
    storageKey,
    originalFileName,
    mimeType,
    fileSizeBytes,
    createdAt,
  } = input;

  if (!expenseId || typeof expenseId !== "string" || !expenseId.trim()) {
    throw new Error("Valid expenseId is required for attachment");
  }

  if (!uploadedById || typeof uploadedById !== "string" || !uploadedById.trim()) {
    throw new Error("Valid uploadedById is required for attachment");
  }

  if (!storageKey || typeof storageKey !== "string" || !storageKey.trim()) {
    throw new Error("Valid storageKey is required for attachment");
  }

  const cleanStorageKey = storageKey.trim();
  if (cleanStorageKey.includes("..")) {
    throw new Error("Security violation: storageKey must not contain directory traversal sequences");
  }

  if (!originalFileName || typeof originalFileName !== "string" || !originalFileName.trim()) {
    throw new Error("Valid originalFileName is required for attachment");
  }

  if (!mimeType || typeof mimeType !== "string" || !mimeType.trim()) {
    throw new Error("Valid mimeType is required for attachment");
  }

  if (
    typeof fileSizeBytes !== "number" ||
    !Number.isInteger(fileSizeBytes) ||
    fileSizeBytes < 0 ||
    fileSizeBytes > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      "fileSizeBytes must be a non-negative safe integer representing file size in bytes"
    );
  }

  return {
    expenseId: expenseId.trim(),
    uploadedById: uploadedById.trim(),
    storageKey: cleanStorageKey,
    originalFileName: originalFileName.trim(),
    mimeType: mimeType.trim().toLowerCase(),
    fileSizeBytes,
    createdAt: createdAt instanceof Date ? createdAt : new Date(),
  };
}
