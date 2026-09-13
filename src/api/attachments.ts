import { apiRequest } from "./client.js";

export interface SafeAttachmentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface AttachmentItem {
  id: string;
  expenseId: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
  uploader: SafeAttachmentUser;
}

export interface AttachmentDetailItem extends AttachmentItem {
  downloadUrl: string;
  expiresIn: number;
}

export interface JsonUploadPayload {
  fileBase64: string;
  originalFileName: string;
  mimeType: string;
}

/**
 * List all attachments belonging to an authorized group expense.
 */
export async function listExpenseAttachments(
  groupId: string,
  expenseId: string
): Promise<AttachmentItem[]> {
  return apiRequest<AttachmentItem[]>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/attachments`,
    { method: "GET" }
  );
}

/**
 * Retrieves a single attachment by ID including its short-lived signed download URL.
 */
export async function getAttachment(
  groupId: string,
  expenseId: string,
  attachmentId: string
): Promise<AttachmentDetailItem> {
  return apiRequest<AttachmentDetailItem>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "GET" }
  );
}

/**
 * Uploads an attachment to a group expense using multipart FormData or JSON payload.
 */
export async function uploadAttachment(
  groupId: string,
  expenseId: string,
  payload: FormData | JsonUploadPayload
): Promise<AttachmentItem> {
  return apiRequest<AttachmentItem>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/attachments`,
    {
      method: "POST",
      body: payload,
    }
  );
}

/**
 * Deletes an attachment from a group expense.
 */
export async function deleteAttachment(
  groupId: string,
  expenseId: string,
  attachmentId: string
): Promise<{ success: boolean; id: string }> {
  return apiRequest<{ success: boolean; id: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" }
  );
}
