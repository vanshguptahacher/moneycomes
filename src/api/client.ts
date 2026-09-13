/**
 * Base HTTP client for MoneyComes API requests.
 * - Targets EXPO_PUBLIC_API_URL or local defaults.
 * - Handles JSON serialization/deserialization.
 * - Passes credentials for Better Auth session management.
 * - Formats standardized ApiClientError on non-2xx responses.
 */

export interface ApiClientErrorDetails {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(error: ApiClientErrorDetails) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = error.status;
    this.code = error.code;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

export function getBaseApiUrl(): string {
  if (typeof process !== "undefined" && process.env && process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, "");
  }
  return "http://10.0.2.2:3000";
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getBaseApiUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };

  let bodyContent: BodyInit | undefined;
  if (options.body !== undefined) {
    if (
      (typeof FormData !== "undefined" && options.body instanceof FormData) ||
      (typeof Blob !== "undefined" && options.body instanceof Blob) ||
      options.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(options.body)
    ) {
      bodyContent = options.body as BodyInit;
    } else {
      headers["Content-Type"] = "application/json";
      bodyContent = JSON.stringify(options.body);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: bodyContent,
    credentials: "include",
  });

  let data: Record<string, unknown> | null = null;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errorPayload = data?.error as ApiClientErrorDetails | undefined;
    throw new ApiClientError({
      status: response.status,
      code: errorPayload?.code || `HTTP_${response.status}`,
      message: errorPayload?.message || response.statusText || "An API error occurred",
      requestId: errorPayload?.requestId,
      details: errorPayload?.details,
    });
  }

  return (data?.data !== undefined ? data.data : data) as T;
}
