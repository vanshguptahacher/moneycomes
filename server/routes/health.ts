import { Hono } from "hono";
import { checkDatabaseConnection } from "../db/client.js";

export const healthRoutes = new Hono();

// Liveness probe (checks process is running)
healthRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Readiness probe (checks critical dependencies like database)
healthRoutes.get("/ready", async (c) => {
  const dbHealthy = await checkDatabaseConnection();
  const status = dbHealthy ? "ready" : "degraded";

  return c.json(
    {
      status,
      checks: {
        database: dbHealthy ? "ok" : "unreachable",
      },
      timestamp: new Date().toISOString(),
    },
    dbHealthy ? 200 : 503
  );
});
