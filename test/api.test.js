import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createApp, FORMULA } from "../src/app.js";

class FakeRedis {
  constructor() {
    this.isReady = true;
    this.values = new Map();
  }

  async incr(key) {
    const nextValue = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, String(nextValue));
    return nextValue;
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }
}

async function startServer(redisClient) {
  const server = createServer(createApp(redisClient)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    baseUrl: "http://127.0.0.1:" + address.port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path) {
  const response = await fetch(baseUrl + path);
  return {
    status: response.status,
    body: await response.json()
  };
}

test("implements the required conversion API and counter behavior", async (context) => {
  const redisClient = new FakeRedis();
  const server = await startServer(redisClient);
  context.after(server.close);

  const health = await request(server.baseUrl, "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: "ok" });

  const zero = await request(server.baseUrl, "/convert?lbs=0");
  assert.equal(zero.status, 200);
  assert.deepEqual(zero.body, { lbs: 0, kg: 0, formula: FORMULA });

  const oneHundredFifty = await request(server.baseUrl, "/convert?lbs=150");
  assert.equal(oneHundredFifty.status, 200);
  assert.deepEqual(oneHundredFifty.body, { lbs: 150, kg: 68.039, formula: FORMULA });

  const decimal = await request(server.baseUrl, "/convert?lbs=0.1");
  assert.equal(decimal.status, 200);
  assert.deepEqual(decimal.body, { lbs: 0.1, kg: 0.045, formula: FORMULA });

  for (const path of ["/convert", "/convert?lbs=abc"]) {
    const result = await request(server.baseUrl, path);
    assert.equal(result.status, 400);
  }

  const negative = await request(server.baseUrl, "/convert?lbs=-5");
  assert.equal(negative.status, 422);

  const negativeUnderflow = await request(server.baseUrl, "/convert?lbs=-1e-400");
  assert.equal(negativeUnderflow.status, 422);

  const stats = await request(server.baseUrl, "/stats");
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.body, { conversions: 3 });
});

test("reports a storage outage without recording a conversion", async (context) => {
  const redisClient = new FakeRedis();
  redisClient.incr = async () => {
    throw new Error("Redis is unavailable");
  };
  const server = await startServer(redisClient);
  context.after(server.close);

  const conversion = await request(server.baseUrl, "/convert?lbs=1");
  assert.equal(conversion.status, 503);
  assert.equal(redisClient.values.size, 0);
});
