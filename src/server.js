import { createServer } from "node:http";
import { createApp } from "./app.js";
import { RedisCounter } from "./redis-client.js";

function readPort(name, fallback) {
  const rawValue = process.env[name] ?? fallback;
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(name + " must be an integer from 1 through 65535");
  }

  return value;
}

const port = readPort("PORT", "3000");
const redisHost = process.env.REDIS_HOST ?? "redis";
const redisPort = readPort("REDIS_PORT", "6379");

const redisClient = new RedisCounter({ host: redisHost, port: redisPort });

const app = createApp(redisClient);
const server = createServer(app);
server.listen(port, "0.0.0.0", () => {
  console.log("HTTP service listening on port " + port);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log("Received " + signal + "; shutting down");

  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
