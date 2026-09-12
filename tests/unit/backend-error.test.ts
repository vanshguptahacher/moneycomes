import { describe, it, expect } from "vitest";
import { app } from "../../server/app.js";

describe("Backend Error Handling", () => {
  it("returns 404 with structured JSON for unmapped routes", async () => {
    const res = await app.request("/api/v1/non-existent-endpoint");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("Route not found");
  });
});
