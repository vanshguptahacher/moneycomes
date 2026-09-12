import { describe, it, expect } from "vitest";
import { app } from "../../server/app.js";

describe("Backend Health Endpoints", () => {
  it("GET /health returns 200 OK with liveness data and request ID", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.timestamp).toBeDefined();

    const reqId = res.headers.get("x-request-id");
    expect(reqId).toBeDefined();
    expect(reqId?.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/health mounts correctly under /api/v1 prefix", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /health/ready responds with readiness status object", async () => {
    const res = await app.request("/health/ready");
    // Returns 200 if DB is reachable, or 503 if DB is not running locally in CI/test
    expect([200, 503]).toContain(res.status);

    const body = await res.json();
    expect(["ready", "degraded"]).toContain(body.status);
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBeDefined();
  });
});
