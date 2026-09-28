import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectName = "project1-grade-demo";
const volumeName = projectName + "_redis-data";
const hostPort = process.env.DEMO_HOST_PORT ?? "8081";
const baseUrl = "http://127.0.0.1:" + hostPort;
const transcriptPath = resolve(rootDirectory, "docs", "operational-demo.log");
const transcript = [];

function record(message = "") {
  const text = String(message)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd().replace(/[^\x20-\x7E]/g, "."))
    .join("\n")
    .trimEnd();
  console.log(text);
  transcript.push(text);
}

function formatCommand(args) {
  return "docker " + args.map((arg) => (arg.includes(" ") ? '"' + arg + '"' : arg)).join(" ");
}

function runDocker(args, options = {}) {
  const { allowFailure = false, captureOutput = false } = options;
  record("$ " + formatCommand(args));

  const result = spawnSync("docker", args, {
    cwd: rootDirectory,
    encoding: "utf8",
    env: { ...process.env, HOST_PORT: hostPort },
    windowsHide: true
  });

  if (result.error) {
    throw new Error(
      "Docker CLI unavailable: " + result.error.message + ". Start Docker Desktop and ensure docker is on PATH."
    );
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("").trimEnd();
  if (captureOutput && output) {
    record(output);
  }

  if (result.status !== 0 && !allowFailure) {
    throw new Error("Command failed with exit code " + result.status + (output ? ": " + output : ""));
  }

  return { output, status: result.status ?? 1 };
}

function runCompose(args, options) {
  return runDocker(["compose", "--project-name", projectName, ...args], options);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function waitForHealth() {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + "/health");
      const body = await response.json();
      if (response.status === 200 && body.status === "ok") {
        record("PASS: health endpoint is ready");
        return;
      }
    } catch {
      // The published host port is not available until the app has started.
    }

    await sleep(1000);
  }

  throw new Error("Application health endpoint did not become ready within 60 seconds");
}

async function request(path, expectedStatus, expectedFields = {}) {
  const response = await fetch(baseUrl + path);
  const bodyText = await response.text();
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(path + " returned invalid JSON: " + bodyText);
  }

  record("GET " + path + " -> " + response.status + " " + bodyText);
  assert(response.status === expectedStatus, path + " returned " + response.status + ", expected " + expectedStatus);

  for (const [field, expectedValue] of Object.entries(expectedFields)) {
    assert(
      body[field] === expectedValue,
      path + " returned " + field + "=" + JSON.stringify(body[field]) + ", expected " + JSON.stringify(expectedValue)
    );
  }
}

function writeTranscript() {
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, transcript.join("\n") + "\n", "utf8");
  console.log("Transcript written to " + transcriptPath);
}

function volumeExists() {
  return runDocker(["volume", "inspect", volumeName], { allowFailure: true }).status === 0;
}

let succeeded = false;
let exitCode = 0;

try {
  record("Project 1 container operational demonstration");
  record("Compose project: " + projectName);
  record("Host port: " + hostPort);

  runCompose(["down", "-v"], { captureOutput: true });
  runCompose(["up", "--build", "-d"]);
  await waitForHealth();

  const running = runCompose(["ps"], { captureOutput: true }).output;
  assert(running.includes("127.0.0.1:" + hostPort + "->3000/tcp"), "Application host port is not published");
  assert(!running.includes("6379->"), "Redis must not publish port 6379 to the host");

  await request("/stats", 200, { conversions: 0 });
  await request("/convert?lbs=0", 200, { lbs: 0, kg: 0, formula: "kg = lbs * 0.45359237" });
  await request("/convert?lbs=150", 200, { lbs: 150, kg: 68.039, formula: "kg = lbs * 0.45359237" });
  await request("/convert?lbs=0.1", 200, { lbs: 0.1, kg: 0.045, formula: "kg = lbs * 0.45359237" });
  await request("/convert", 400);
  await request("/convert?lbs=abc", 400);
  await request("/convert?lbs=-5", 422);
  await request("/convert?lbs=-1e-400", 422);
  await request("/stats", 200, { conversions: 3 });

  const identity = runCompose(["exec", "-T", "app", "id"], { captureOutput: true }).output;
  assert(identity.includes("uid=1000(node)"), "Application container is not running as the node user");
  runCompose(["logs", "app"], { captureOutput: true });

  runCompose(["stop"], { captureOutput: true });
  runCompose(["start"], { captureOutput: true });
  await waitForHealth();

  runCompose(["down"], { captureOutput: true });
  assert(volumeExists(), "Redis named volume did not survive docker compose down");
  record("PASS: named Redis volume survived docker compose down");

  runCompose(["up", "-d"]);
  await waitForHealth();
  await request("/stats", 200, { conversions: 3 });
  succeeded = true;
} catch (error) {
  exitCode = 1;
  record("FAIL / BLOCKED: " + error.message);
} finally {
  try {
    runCompose(["down", "-v", "--rmi", "local"], { captureOutput: true });
    assert(!volumeExists(), "Redis named volume remains after docker compose down -v");
    record("PASS: final cleanup removed the named volume");
  } catch (cleanupError) {
    exitCode = 1;
    succeeded = false;
    record("FAIL / BLOCKED: cleanup failed: " + cleanupError.message);
  }

  if (succeeded) {
    record("PASS: complete container operational demonstration.");
  }
  writeTranscript();
}

process.exitCode = exitCode;
