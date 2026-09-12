import { apiRequest } from "./client.js";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  defaultCurrencyCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserProfileInput {
  name?: string;
  image?: string | null;
  defaultCurrencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
}

/**
 * Retrieves the currently authenticated user's profile.
 */
export async function getCurrentUserProfile(): Promise<UserProfile> {
  return apiRequest<UserProfile>("/api/v1/users/me", {
    method: "GET",
  });
}

/**
 * Updates the currently authenticated user's profile fields.
 */
export async function updateCurrentUserProfile(
  input: UpdateUserProfileInput
): Promise<UserProfile> {
  return apiRequest<UserProfile>("/api/v1/users/me", {
    method: "PATCH",
    body: input,
  });
}

/**
 * Retrieves a user profile by ID (if permitted).
 */
export async function getUserProfileById(id: string): Promise<UserProfile> {
  return apiRequest<UserProfile>(`/api/v1/users/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}
