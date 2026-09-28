import { createConnection } from "node:net";

const CRLF = Buffer.from("\r\n");
const COMMAND_TIMEOUT_MS = 5000;

function encodeCommand(parts) {
  const frames = [Buffer.from("*" + parts.length + "\r\n")];

  for (const part of parts) {
    const value = Buffer.from(String(part));
    frames.push(Buffer.from("$" + value.length + "\r\n"), value, CRLF);
  }

  return Buffer.concat(frames);
}

function parseResponse(buffer) {
  if (buffer.length === 0) {
    return null;
  }

  const lineEnd = buffer.indexOf(CRLF, 1);
  if (lineEnd === -1) {
    return null;
  }

  const type = String.fromCharCode(buffer[0]);
  const line = buffer.subarray(1, lineEnd).toString("utf8");

  if (type === "+") {
    return { value: line };
  }

  if (type === "-") {
    return { error: new Error("Redis error: " + line) };
  }

  if (type === ":") {
    const value = Number(line);
    if (!Number.isSafeInteger(value)) {
      return { error: new Error("Redis returned an invalid integer") };
    }
    return { value };
  }

  if (type === "$") {
    const byteLength = Number(line);
    if (!Number.isInteger(byteLength) || byteLength < -1) {
      return { error: new Error("Redis returned an invalid bulk string") };
    }
    if (byteLength === -1) {
      return { value: null };
    }

    const contentStart = lineEnd + CRLF.length;
    const contentEnd = contentStart + byteLength;
    if (buffer.length < contentEnd + CRLF.length) {
      return null;
    }
    return { value: buffer.subarray(contentStart, contentEnd).toString("utf8") };
  }

  return { error: new Error("Redis returned an unsupported response type") };
}

function sendCommand(connection, parts) {
  return new Promise((resolve, reject) => {
    let responseBuffer = Buffer.alloc(0);
    let settled = false;
    const socket = createConnection(connection);

    function finish(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      callback(value);
    }

    const timeout = setTimeout(() => {
      finish(reject, new Error("Redis command timed out"));
    }, COMMAND_TIMEOUT_MS);

    socket.once("connect", () => {
      socket.write(encodeCommand(parts));
    });

    socket.on("data", (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const response = parseResponse(responseBuffer);

      if (response === null) {
        return;
      }
      if (response.error) {
        finish(reject, response.error);
        return;
      }
      finish(resolve, response.value);
    });

    socket.once("error", (error) => finish(reject, error));
    socket.once("close", () => {
      if (!settled) {
        finish(reject, new Error("Redis connection closed before responding"));
      }
    });
  });
}

export class RedisCounter {
  constructor(connection) {
    this.connection = connection;
  }

  async incr(key) {
    const result = await sendCommand(this.connection, ["INCR", key]);
    if (!Number.isSafeInteger(result)) {
      throw new Error("Redis INCR returned an invalid value");
    }
    return result;
  }

  async get(key) {
    const result = await sendCommand(this.connection, ["GET", key]);
    if (result !== null && typeof result !== "string") {
      throw new Error("Redis GET returned an invalid value");
    }
    return result;
  }
}
