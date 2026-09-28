import { URL } from "node:url";

export const POUNDS_TO_KG = 0.45359237;
export const FORMULA = "kg = lbs * 0.45359237";

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function parsePounds(url) {
  const rawPounds = url.searchParams.get("lbs");

  if (rawPounds === null || rawPounds.trim() === "") {
    return { error: "lbs is required and must be numeric", statusCode: 400 };
  }

  const pounds = Number(rawPounds);
  if (Number.isNaN(pounds)) {
    return { error: "lbs must be numeric", statusCode: 400 };
  }

  if (!Number.isFinite(pounds) || pounds < 0) {
    return { error: "lbs must be finite and non-negative", statusCode: 422 };
  }

  return { pounds };
}

function storageError(response, error) {
  console.error("Request failed:", error.message);
  sendJson(response, 503, { error: "Persistent storage is unavailable" });
}

export function createApp(redisClient) {
  return async function app(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname === "/convert") {
      const parsedPounds = parsePounds(url);
      if (parsedPounds.statusCode) {
        sendJson(response, parsedPounds.statusCode, { error: parsedPounds.error });
        return;
      }

      try {
        await redisClient.incr("conversions");
        sendJson(response, 200, {
          lbs: parsedPounds.pounds,
          kg: Number((parsedPounds.pounds * POUNDS_TO_KG).toFixed(3)),
          formula: FORMULA
        });
      } catch (error) {
        storageError(response, error);
      }
      return;
    }

    if (url.pathname === "/stats") {
      try {
        const storedCount = await redisClient.get("conversions");
        const conversions = storedCount === null ? 0 : Number(storedCount);

        if (!Number.isSafeInteger(conversions) || conversions < 0) {
          throw new Error("Redis conversions value is invalid");
        }

        sendJson(response, 200, { conversions });
      } catch (error) {
        storageError(response, error);
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  };
}
