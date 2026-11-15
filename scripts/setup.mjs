// One-command local setup for Sprout (Windows, macOS, Linux).
// Usage: node scripts/setup.mjs [--codex] [--no-open]
//
// Does: builds the extension and server, creates the pairing token if missing,
// writes the MCP entry into the Codex config (with a one-time backup), copies
// the token to the clipboard, and opens chrome://extensions with the dist
// folder ready to load. Chrome does not allow loading an unpacked extension
// from a script, so the final "Load unpacked" click stays manual.
//
// Does NOT: commit, push, or touch git. Does NOT print the token (SEC-004).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

function run(cwd, cmd, argv) {
  execFileSync(cmd, argv, { cwd, stdio: "inherit", shell: isWindows });
}

function step(msg) {
  console.log(`\n==> ${msg}`);
}

// 1. Build both packages so dist/ is current.
step("Installing and building the extension");
const extDir = path.join(root, "extension");
if (!existsSync(path.join(extDir, "node_modules"))) run(extDir, npm, ["install"]);
run(extDir, npm, ["run", "build"]);

step("Installing and building the server");
const serverDir = path.join(root, "server");
if (!existsSync(path.join(serverDir, "node_modules"))) run(serverDir, npm, ["install"]);
run(serverDir, npm, ["run", "build"]);

// 2. Pairing token. The server creates it on first run; we only read it.
const tokenFile = path.join(os.homedir(), ".sprout", "token");
step("Checking the pairing token");
if (!existsSync(tokenFile)) {
  console.log(`No token yet at ${tokenFile}.`);
  console.log("Start the server once (Codex or any MCP client will do it), then re-run this script.");
} else {
  console.log(`Token found at ${tokenFile}`);
}

// 3. Codex MCP entry. Idempotent: replaces any existing [mcp_servers.sprout] block.
if (args.has("--codex") || !args.has("--no-codex")) {
  step("Wiring Sprout into Codex");
  const codexConfig = path.join(os.homedir(), ".codex", "config.toml");
  const serverEntry = path.join(serverDir, "dist", "index.js");
  const block = [
    "[mcp_servers.sprout]",
    'command = "node"',
    `args = ['${serverEntry}']`,
    "",
  ].join("\n");

  if (!existsSync(path.dirname(codexConfig))) {
    console.log(`Codex is not set up (no ${path.dirname(codexConfig)}). Skipping.`);
  } else {
    const current = existsSync(codexConfig) ? readFileSync(codexConfig, "utf8") : "";
    const backup = `${codexConfig}.bak-sprout`;
    if (current && !existsSync(backup)) copyFileSync(codexConfig, backup);

    // Drop the old sprout block (header up to the next table header), then append the new one.
    const stripped = current.replace(/^\[mcp_servers\.sprout\][\s\S]*?(?=^\[|(?![\s\S]))/m, "").replace(/\n{3,}/g, "\n\n");
    writeFileSync(codexConfig, `${stripped.trimEnd()}\n\n${block}`);
    console.log(`Updated ${codexConfig} (backup: ${backup})`);
  }
}

// 4. Clipboard + open Chrome page and the dist folder.
if (!args.has("--no-open")) {
  step("Preparing the extension install");
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, "utf8").trim();
    try {
      const clip = isWindows ? "clip" : process.platform === "darwin" ? "pbcopy" : "xclip";
      const argv = clip === "xclip" ? ["-selection", "clipboard"] : [];
      const p = spawn(clip, argv, { stdio: ["pipe", "ignore", "ignore"], shell: isWindows });
      p.stdin.end(token);
      console.log("Token copied to clipboard.");
    } catch {
      console.log(`Could not copy automatically. Open ${tokenFile} and copy it.`);
    }
  }
  const dist = path.join(extDir, "dist");
  if (isWindows) {
    spawn("cmd", ["/c", "start", "", "chrome", "chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
    spawn("explorer", [dist], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-a", "Google Chrome", "chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
    spawn("open", [dist], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [dist], { detached: true, stdio: "ignore" }).unref();
  }
}

console.log(`
Last steps (manual, Chrome blocks scripted loading):
  1. chrome://extensions -> Developer mode on -> Load unpacked -> select extension/dist
  2. Open the Sprout popup and paste the token (already on your clipboard)
  3. Restart Codex, run /mcp, confirm sprout is listed and connected
`);
