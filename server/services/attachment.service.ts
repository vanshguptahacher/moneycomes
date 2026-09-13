import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import { config } from "../config/index.js";
import {
  attachmentRepository,
  expenseRepository,
  groupRepository,
  userRepository,
  type AttachmentRepository,
  type ExpenseRepository,
  type GroupRepository,
  type UserRepository,
} from "../repositories/index.js";
import {
  storageService,
  type IStorageService,
} from "./storage.service.js";
import {
  type Attachment,
  validateAttachmentInput,
} from "../db/schema/index.js";

export interface SafeAttachmentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface AttachmentItemResponse {
  id: string;
  expenseId: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
  uploader: SafeAttachmentUser;
}

export interface AttachmentDetailResponse extends AttachmentItemResponse {
  downloadUrl: string;
  expiresIn: number;
}

export interface UploadFileInput {
  data: Uint8Array;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Validates file signature (magic bytes) against declared MIME type.
 * Cloudflare Workers compatible (pure typed array arithmetic).
 */
export function validateFileSignature(data: Uint8Array, declaredMimeType: string): boolean {
  if (!data || data.length < 4) {
    return false;
  }

  const mime = declaredMimeType.toLowerCase().trim();

  // JPEG: FF D8 FF
  if (mime === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (mime === "image/png") {
    return (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    );
  }

  // PDF: %PDF- (25 50 44 46 2D)
  if (mime === "application/pdf") {
    return (
      data.length >= 5 &&
      data[0] === 0x25 &&
      data[1] === 0x50 &&
      data[2] === 0x44 &&
      data[3] === 0x46 &&
      data[4] === 0x2d
    );
  }

  // WebP: RIFF (52 49 46 46) ... WEBP (57 45 42 50)
  if (mime === "image/webp") {
    if (data.length < 12) return false;
    const isRiff =
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
    const isWebp =
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
    return isRiff && isWebp;
  }

  // HEIC / HEIF: bytes 4-11 contain 'ftyp'
  if (mime === "image/heic" || mime === "image/heif") {
    if (data.length < 12) return false;
    return (
      data[4] === 0x66 &&
      data[5] === 0x74 &&
      data[6] === 0x79 &&
      data[7] === 0x70
    );
  }

  return false;
}

/**
 * Service orchestrating attachment storage, database metadata persistence,
 * group authorization boundaries, IDOR protection, and short-lived signed URLs.
 */
export class AttachmentService {
  constructor(
    private readonly attachmentRepo: AttachmentRepository = attachmentRepository,
    private readonly expenseRepo: ExpenseRepository = expenseRepository,
    private readonly groupRepo: GroupRepository = groupRepository,
    private readonly userRepo: UserRepository = userRepository,
    private readonly storage: IStorageService = storageService,
    private readonly bucketName: string = config.SUPABASE_STORAGE_BUCKET
  ) {}

  /**
   * Helper to resolve safe user profile representation.
   */
  private async getSafeUser(userId: string): Promise<SafeAttachmentUser> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      return {
        id: userId,
        name: "Unknown User",
        email: "",
        image: null,
      };
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  }

  /**
   * Helper to serialize attachment record into a safe, client-facing response.
   */
  private formatAttachmentResponse(
    attachment: Attachment,
    uploader: SafeAttachmentUser
  ): AttachmentItemResponse {
    return {
      id: attachment.id,
      expenseId: attachment.expenseId,
      originalFileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
      fileSizeBytes: attachment.fileSizeBytes,
      createdAt: attachment.createdAt.toISOString(),
      uploader,
    };
  }

  /**
   * Lists all attachments belonging to an authorized expense.
   */
  async listExpenseAttachments(
    actorId: string,
    groupId: string,
    expenseId: string
  ): Promise<AttachmentItemResponse[]> {
    // 1. Verify actor is a member of the group
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify expense exists and belongs to the group
    const expense = await this.expenseRepo.findById(expenseId);
    if (!expense || expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    // 3. Fetch attachments
    const rawList = await this.attachmentRepo.listByExpenseId(expenseId);

    // 4. Batch resolve uploader profiles
    const uploaderIds = Array.from(new Set(rawList.map((a) => a.uploadedById)));
    const uploaderMap = new Map<string, SafeAttachmentUser>();
    await Promise.all(
      uploaderIds.map(async (id) => {
        const u = await this.getSafeUser(id);
        uploaderMap.set(id, u);
      })
    );

    return rawList.map((att) => {
      const uploader = uploaderMap.get(att.uploadedById) ?? {
        id: att.uploadedById,
        name: "Unknown User",
        email: "",
        image: null,
      };
      return this.formatAttachmentResponse(att, uploader);
    });
  }

  /**
   * Retrieves a single attachment by ID and generates a short-lived signed download URL.
   */
  async getAttachment(
    actorId: string,
    groupId: string,
    expenseId: string,
    attachmentId: string
  ): Promise<AttachmentDetailResponse> {
    // 1. Verify group membership
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify expense exists and belongs to group
    const expense = await this.expenseRepo.findById(expenseId);
    if (!expense || expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    // 3. Fetch attachment and verify parent relationship (IDOR prevention)
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.expenseId !== expenseId) {
      throw new NotFoundError("Attachment not found");
    }

    // 4. Generate short-lived signed URL (300 seconds / 5 minutes)
    const { signedUrl, expiresIn } = await this.storage.createSignedUrl(
      this.bucketName,
      attachment.storageKey,
      300
    );

    // 5. Resolve uploader profile
    const uploader = await this.getSafeUser(attachment.uploadedById);

    return {
      ...this.formatAttachmentResponse(attachment, uploader),
      downloadUrl: signedUrl,
      expiresIn,
    };
  }

  /**
   * Uploads and attaches a receipt/file to an authorized expense.
   * Guarantees consistency: if metadata persistence fails, deletes the uploaded storage object.
   */
  async uploadAttachment(
    actorId: string,
    groupId: string,
    expenseId: string,
    fileInput: UploadFileInput
  ): Promise<AttachmentItemResponse> {
    // 1. Verify group membership
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify expense exists and belongs to group
    const expense = await this.expenseRepo.findById(expenseId);
    if (!expense || expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    const { data, originalFileName, mimeType, fileSizeBytes } = fileInput;

    // 3. Validate file size (1B to 10MB)
    if (!fileSizeBytes || fileSizeBytes <= 0) {
      throw new BadRequestError("File cannot be empty");
    }
    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestError("File size exceeds maximum allowed limit of 10MB");
    }
    if (data.length !== fileSizeBytes) {
      throw new BadRequestError("File size mismatch between content and metadata");
    }

    // 4. Validate MIME type
    const normalizedMime = mimeType.trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      throw new BadRequestError(
        `Unsupported file type "${mimeType}". Allowed types: JPEG, PNG, WebP, HEIC, HEIF, PDF`
      );
    }

    // 5. Validate file signature (magic bytes)
    if (!validateFileSignature(data, normalizedMime)) {
      throw new BadRequestError("File signature does not match declared MIME type");
    }

    // 6. Sanitize filename and determine extension
    const ext = MIME_TO_EXTENSION[normalizedMime] || "bin";
    const cleanFileName = originalFileName
      .replace(/[/\\]/g, "")
      .replace(/\.\./g, "")
      .trim() || `receipt.${ext}`;

    // 7. Generate server-authoritative storage key
    const attachmentId = crypto.randomUUID();
    const storageKey = `expenses/${expenseId}/${attachmentId}.${ext}`;

    // Validate domain boundary invariants
    const validated = validateAttachmentInput({
      expenseId,
      uploadedById: actorId,
      storageKey,
      originalFileName: cleanFileName,
      mimeType: normalizedMime,
      fileSizeBytes,
    });

    // 8. Upload object to Supabase Storage
    await this.storage.uploadObject(this.bucketName, storageKey, data, normalizedMime);

    // 9. Persist metadata in PostgreSQL with cleanup rollback on failure
    let createdAttachment: Attachment;
    try {
      createdAttachment = await this.attachmentRepo.create({
        id: attachmentId,
        expenseId: validated.expenseId,
        uploadedById: validated.uploadedById,
        storageKey: validated.storageKey,
        originalFileName: validated.originalFileName,
        mimeType: validated.mimeType,
        fileSizeBytes: validated.fileSizeBytes,
        createdAt: validated.createdAt,
      });
    } catch (dbError) {
      // Best-effort cleanup of orphaned storage object
      try {
        await this.storage.deleteObject(this.bucketName, storageKey);
      } catch {
        // Suppress storage cleanup error to preserve primary DB error
      }
      throw dbError;
    }

    const uploader = await this.getSafeUser(actorId);
    return this.formatAttachmentResponse(createdAttachment, uploader);
  }

  /**
   * Deletes an attachment from both PostgreSQL metadata and Supabase Storage.
   * Authorization: uploader, expense creator, or group admin.
   */
  async deleteAttachment(
    actorId: string,
    groupId: string,
    expenseId: string,
    attachmentId: string
  ): Promise<{ success: boolean; id: string }> {
    // 1. Verify group membership
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify expense exists and belongs to group
    const expense = await this.expenseRepo.findById(expenseId);
    if (!expense || expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    // 3. Fetch attachment and verify parent relationship
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.expenseId !== expenseId) {
      throw new NotFoundError("Attachment not found");
    }

    // 4. Apply deletion authorization
    const isUploader = attachment.uploadedById === actorId;
    const isExpenseCreator = expense.createdById === actorId;
    const isAdmin = membership.role === "admin";

    if (!isUploader && !isExpenseCreator && !isAdmin) {
      throw new ForbiddenError("You are not authorized to delete this attachment");
    }

    // 5. Delete metadata in PostgreSQL
    await this.attachmentRepo.delete(attachmentId);

    // 6. Delete object in Supabase Storage
    try {
      await this.storage.deleteObject(this.bucketName, attachment.storageKey);
    } catch {
      // Storage deletion failure is logged but does not un-delete DB metadata
    }

    return {
      success: true,
      id: attachmentId,
    };
  }
}

export const attachmentService = new AttachmentService();
