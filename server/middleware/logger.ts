import { createMiddleware } from "hono/factory";

export const structuredLogger = () =>
  createMiddleware(async (c, next) => {
    const start = Date.now();
    const { method, path } = c.req;
    const reqId = c.get("requestId") || c.req.header("x-request-id") || "unknown";

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    // Lightweight structured log (never logs auth tokens, cookies, or secrets)
    const logEntry = {
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      requestId: reqId,
      method,
      path,
      status,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      console.error(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  });
