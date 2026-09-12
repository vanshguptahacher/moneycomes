import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config/index.js";

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  },
  (info) => {
    console.log(
      JSON.stringify({
        level: "info",
        message: `MoneyComes API server listening on http://${info.address}:${info.port}`,
        env: config.NODE_ENV,
        host: info.address,
        port: info.port,
        timestamp: new Date().toISOString(),
      })
    );
  }
);

// Graceful shutdown
const shutdown = () => {
  console.log("Shutting down API server gracefully...");
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
