import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3107;
const ROOT_URL = `http://127.0.0.1:${PORT}`;
const API_URL = `${ROOT_URL}/api`;

let server;
let tempDir;
let token;
let user;

async function readBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${ROOT_URL}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Test server did not start");
}

async function createTestUser() {
  const email = `fetch-test-${Date.now()}@example.com`;
  const password = "password123";

  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password
    })
  });

  const body = await readBody(response);

  assert.equal(response.status, 201, JSON.stringify(body));

  user = body.user;

  return {
    email,
    password,
    user
  };
}

async function authenticateTestUser({email,password,user}){
  if(!user){
    throw assert.AssertionError("Register must happen before Login.")
  }


  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password
    })
  });

  const body = await readBody(response);

  assert.equal(response.status, 200, JSON.stringify(body));

  user=body.user
  token=body.token

  return {
    token,
    user
  };
}


test.before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "availability-backend-"));

  server = spawn("node", ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      DB_PATH: path.join(tempDir, "test.sqlite"),
      JWT_SECRET: "test-secret",
      JWT_EXPIRES_IN: "1h"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  server.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  await waitForServer();
  const creds=await createTestUser();
  await authenticateTestUser(creds);
});

test.after(async () => {
  if (server) {
    server.kill("SIGTERM");
  }

  if (tempDir) {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  }
});

test("GET /health returns ok", async () => {
  const response = await fetch(`${ROOT_URL}/health`);
  const body = await readBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    status: "ok"
  });
});

test("registered test user exists", async () => {
  assert.equal(typeof token, "string");
  assert.equal(typeof user.id, "number");
  assert.match(user.email, /^fetch-test-/);
});

test("GET /api/auth/me returns authenticated user", async () => {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const body = await readBody(response);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.id, user.id);
  assert.equal(body.email, user.email);
});

test("GET /api/monitors rejects unauthenticated requests", async () => {
  const response = await fetch(`${API_URL}/monitors`);
  const body = await readBody(response);

  assert.equal(response.status, 401, JSON.stringify(body));
  assert.equal(typeof body.message, "string");
});

test("monitor lifecycle works with fetch", async () => {
  const authHeaders = {
    Authorization: `Bearer ${token}`
  };

  const createResponse = await fetch(`${API_URL}/monitors`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Local Health Endpoint",
      rawUrl: `${ROOT_URL}/health`,
      method: "GET"
    })
  });

  const createdMonitor = await readBody(createResponse);

  assert.equal(createResponse.status, 201, JSON.stringify(createdMonitor));
  assert.equal(createdMonitor.name, "Local Health Endpoint");
  assert.equal(createdMonitor.method, "GET");
  assert.equal(createdMonitor.rawUrl, `${ROOT_URL}/health`);
  assert.equal(createdMonitor.lastStatus, "unknown");

  const monitorId = createdMonitor.id;

  assert.equal(typeof monitorId, "number");

  const listResponse = await fetch(`${API_URL}/monitors`, {
    headers: authHeaders
  });

  const monitors = await readBody(listResponse);

  assert.equal(listResponse.status, 200, JSON.stringify(monitors));
  assert.equal(Array.isArray(monitors), true);
  assert.equal(
    monitors.some((monitor) => monitor.id === monitorId),
    true
  );

  const getResponse = await fetch(`${API_URL}/monitors/${monitorId}`, {
    headers: authHeaders
  });

  const fetchedMonitor = await readBody(getResponse);

  assert.equal(getResponse.status, 200, JSON.stringify(fetchedMonitor));
  assert.equal(fetchedMonitor.id, monitorId);
  assert.equal(fetchedMonitor.name, "Local Health Endpoint");

  const checkNowResponse = await fetch(
    `${API_URL}/monitors/${monitorId}/check-now`,
    {
      method: "POST",
      headers: authHeaders
    }
  );

  const checkResult = await readBody(checkNowResponse);

  assert.equal(checkNowResponse.status, 201, JSON.stringify(checkResult));
  assert.equal(checkResult.monitorId, monitorId);
  assert.equal(checkResult.status, "up");
  assert.equal(checkResult.httpStatusCode, 200);
  assert.equal(typeof checkResult.responseTimeMs, "number");

  const checksResponse = await fetch(
    `${API_URL}/monitors/${monitorId}/checks?limit=5`,
    {
      headers: authHeaders
    }
  );

  const checks = await readBody(checksResponse);

  assert.equal(checksResponse.status, 200, JSON.stringify(checks));
  assert.equal(Array.isArray(checks), true);
  assert.equal(checks.length >= 1, true);
  assert.equal(checks[0].monitorId, monitorId);
  assert.equal(checks[0].status, "up");

  const deleteResponse = await fetch(`${API_URL}/monitors/${monitorId}`, {
    method: "DELETE",
    headers: authHeaders
  });

  assert.equal(deleteResponse.status, 204);

  const getDeletedResponse = await fetch(`${API_URL}/monitors/${monitorId}`, {
    headers: authHeaders
  });

  const getDeletedBody = await readBody(getDeletedResponse);

  assert.equal(getDeletedResponse.status, 404, JSON.stringify(getDeletedBody));
  assert.equal(typeof getDeletedBody.message, "string");
});