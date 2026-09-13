import { Hono } from "hono";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import { attachmentService } from "../services/attachment.service.js";
import { sendSuccess } from "../utils/response.js";
import { BadRequestError } from "../errors/index.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(value: string | undefined, paramName: string): string {
  if (!value || !UUID_REGEX.test(value)) {
    throw new BadRequestError(`Invalid ${paramName} format: must be a valid UUID`);
  }
  return value;
}

/**
 * Attachments Router (/api/v1/groups/:groupId/expenses/:expenseId/attachments).
 *
 * Enforces:
 * - Better Auth server-side authentication.
 * - Group membership authorization.
 * - Expense context verification.
 * - Storage path safety (server-generated keys, no client-specified paths/buckets).
 * - Magic-byte file validation and size boundaries.
 * - Storage and database consistency.
 */
export const attachmentsRoutes = new Hono();
attachmentsRoutes.use("*", requireAuth());

// POST / — Upload and attach a file to an authorized expense
attachmentsRoutes.post("/", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");

  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      throw new BadRequestError("Valid 'file' field is required in multipart form data");
    }

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    const attachment = await attachmentService.uploadAttachment(
      actor.id,
      groupId,
      expenseId,
      {
        data,
        originalFileName: file.name || "receipt",
        mimeType: file.type || "application/octet-stream",
        fileSizeBytes: file.size,
      }
    );

    return sendSuccess(c, attachment, 201);
  } else if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new BadRequestError("Invalid JSON payload");
    }

    const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
    const originalFileName =
      typeof body.originalFileName === "string" ? body.originalFileName : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";

    if (!fileBase64 || !originalFileName || !mimeType) {
      throw new BadRequestError(
        "fileBase64, originalFileName, and mimeType are required for JSON upload"
      );
    }

    let data: Uint8Array;
    try {
      const binaryString = atob(fileBase64);
      data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }
    } catch {
      throw new BadRequestError("Invalid base64 encoding in fileBase64");
    }

    const attachment = await attachmentService.uploadAttachment(
      actor.id,
      groupId,
      expenseId,
      {
        data,
        originalFileName,
        mimeType,
        fileSizeBytes: data.length,
      }
    );

    return sendSuccess(c, attachment, 201);
  } else {
    throw new BadRequestError(
      "Unsupported Content-Type. Expected multipart/form-data or application/json"
    );
  }
});

// GET / — List attachments for an authorized expense
attachmentsRoutes.get("/", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");

  const attachments = await attachmentService.listExpenseAttachments(
    actor.id,
    groupId,
    expenseId
  );

  return sendSuccess(c, attachments, 200, { total: attachments.length });
});

// GET /:attachmentId — Retrieve attachment detail and signed download URL
attachmentsRoutes.get("/:attachmentId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");
  const attachmentId = validateUuid(c.req.param("attachmentId"), "attachmentId");

  const attachment = await attachmentService.getAttachment(
    actor.id,
    groupId,
    expenseId,
    attachmentId
  );

  return sendSuccess(c, attachment, 200);
});

// DELETE /:attachmentId — Delete an attachment (authorized uploader, expense creator, or admin)
attachmentsRoutes.delete("/:attachmentId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");
  const attachmentId = validateUuid(c.req.param("attachmentId"), "attachmentId");

  const result = await attachmentService.deleteAttachment(
    actor.id,
    groupId,
    expenseId,
    attachmentId
  );

  return sendSuccess(c, result, 200);
});
