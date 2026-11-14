import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Layer 2: startup failures. The server must say what is wrong on stderr and
// exit, instead of dying on an unhandled 'error' event (BB-008).

const dir = mkdtempSync(path.join(tmpdir(), "sprout-lifecycle-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function occupyPort(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

function runServerOnce(port: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        SPROUT_PORT: String(port),
        SPROUT_TOKEN_FILE: path.join(dir, "token"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => resolve({ code, stderr }));

    // A hung server would fail the test with a confusing timeout instead.
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  });
}

describe("startup", () => {
  it("BB-008: explains a port that is already in use and exits 1", async () => {
    const occupied = await occupyPort();

    try {
      const { code, stderr } = await runServerOnce(occupied.port);
      expect(code).toBe(1);
      expect(stderr).toContain("already in use");
      expect(stderr).toContain("SPROUT_PORT");
    } finally {
      occupied.close();
    }
  });

  it("BB-012: rejects an invalid SPROUT_PORT with a clear message", async () => {
    const { code, stderr } = await runServerOnce(Number.NaN);
    expect(code).toBe(1);
    expect(stderr).toContain("SPROUT_PORT");
  });
});

// The MCP client owns the server's lifetime. When it goes away (stdin closes),
// an orphaned server would keep holding the bridge port and the next client
// would hit "already in use" (BB-027).
function exitAfterStdinCloses(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        SPROUT_PORT: String(20000 + Math.floor(Math.random() * 10000)),
        SPROUT_TOKEN_FILE: path.join(dir, "token"),
      },
      stdio: ["pipe", "ignore", "pipe"],
    });

    child.stderr.on("data", (chunk) => {
      if (chunk.toString().includes("ready on stdio")) child.stdin.end();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("server was still running 3s after stdin closed"));
    }, 3_000);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("shutdown", () => {
  it("BB-027: exits when the MCP client closes stdin", async () => {
    expect(await exitAfterStdinCloses()).toBe(0);
  });
});

// MCP clients often save the server's stderr in their own logs, so the token
// must never be printed there. Only the file path is (SEC-004, SEC-050).
function startupStderr(tokenFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        SPROUT_PORT: String(20000 + Math.floor(Math.random() * 10000)),
        SPROUT_TOKEN_FILE: tokenFile,
      },
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.includes("ready on stdio")) child.stdin.end();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("server did not start"));
    }, 5_000);

    child.on("exit", () => {
      clearTimeout(timer);
      resolve(stderr);
    });
  });
}

describe("token handling", () => {
  it("SEC-004: never prints the pairing token, only where it is saved", async () => {
    const tokenFile = path.join(dir, "fresh-token");

    const stderr = await startupStderr(tokenFile);
    const token = readFileSync(tokenFile, "utf-8").trim();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(stderr).not.toContain(token);
    expect(stderr).toContain(tokenFile);
  });

  it("SEC-004: --rotate-token writes a new token and exits without printing it", async () => {
    const tokenFile = path.join(dir, "rotate-token");
    await startupStderr(tokenFile);
    const before = readFileSync(tokenFile, "utf-8").trim();

    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ["dist/index.js", "--rotate-token"], {
        cwd: path.resolve("."),
        env: { ...process.env, SPROUT_TOKEN_FILE: tokenFile },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk.toString()));
      child.on("exit", (exitCode) => resolve({ code: exitCode, stderr: err }));
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });

    const after = readFileSync(tokenFile, "utf-8").trim();
    expect(code).toBe(0);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
    expect(stderr).not.toContain(after);
    expect(stderr).toContain(tokenFile);
  });
});
