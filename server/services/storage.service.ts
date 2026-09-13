import { config } from "../config/index.js";

export interface IStorageService {
  uploadObject(
    bucket: string,
    path: string,
    data: Uint8Array,
    mimeType: string
  ): Promise<{ path: string }>;

  createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number
  ): Promise<{ signedUrl: string; expiresIn: number }>;

  deleteObject(bucket: string, path: string): Promise<void>;
}

/**
 * Production-grade Supabase Storage client using standard Web fetch APIs.
 * Fully compatible with Cloudflare Workers runtime and Node.js.
 * Strictly encapsulates service-role credentials server-side.
 */
export class SupabaseStorageService implements IStorageService {
  constructor(
    private readonly baseUrl: string = config.SUPABASE_URL,
    private readonly serviceRoleKey: string = config.SUPABASE_SERVICE_ROLE_KEY
  ) {}

  /**
   * Upload an object into a private Supabase Storage bucket.
   */
  async uploadObject(
    bucket: string,
    path: string,
    data: Uint8Array,
    mimeType: string
  ): Promise<{ path: string }> {
    const cleanPath = path.replace(/^\/+/, "");
    const url = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        "Content-Type": mimeType,
        "x-upsert": "true",
      },
      body: data,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown storage error");
      throw new Error(
        `Failed to upload object to Supabase Storage (status ${res.status}): ${errorText.slice(0, 200)}`
      );
    }

    return { path: cleanPath };
  }

  /**
   * Generates a short-lived signed download URL for an object in a private bucket.
   */
  async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number = 300
  ): Promise<{ signedUrl: string; expiresIn: number }> {
    const cleanPath = path.replace(/^\/+/, "");
    const url = `${this.baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${cleanPath}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown storage error");
      throw new Error(
        `Failed to create signed URL from Supabase Storage (status ${res.status}): ${errorText.slice(0, 200)}`
      );
    }

    const json = (await res.json()) as { signedURL?: string; url?: string };
    const rawUrl = json.signedURL || json.url || "";

    if (!rawUrl) {
      throw new Error("Supabase Storage returned an empty signed URL");
    }

    // Standardize URL: if relative path returned, prepend Supabase storage base
    const finalUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : `${this.baseUrl}${rawUrl.startsWith("/storage/v1") ? "" : "/storage/v1"}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;

    return {
      signedUrl: finalUrl,
      expiresIn: expiresInSeconds,
    };
  }

  /**
   * Delete an object from a Supabase Storage bucket.
   */
  async deleteObject(bucket: string, path: string): Promise<void> {
    const cleanPath = path.replace(/^\/+/, "");
    const url = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`;

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [cleanPath] }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown storage error");
      throw new Error(
        `Failed to delete object from Supabase Storage (status ${res.status}): ${errorText.slice(0, 200)}`
      );
    }
  }
}

export const storageService = new SupabaseStorageService();
