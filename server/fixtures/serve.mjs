// Local fixture server for manual and layer 3 tests. No dependencies.
//   npm run fixtures            -> http://127.0.0.1:8787/
// Sprout blocks 127.0.0.1 by default. To test, opt in on both sides:
//   server env SPROUT_ALLOW_PRIVATE_HOSTS=1
//   extension worker console: chrome.storage.local.set({ allowPrivateHosts: true })
// Trap paths (/exfil, /trap) log every hit to stderr: a hit means an attack worked.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.FIXTURE_PORT ?? 8787);
const ROOT = fileURLToPath(new URL("./pages/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/exfil") || url.pathname.startsWith("/trap")) {
    console.error(`TRAP HIT ${new Date().toISOString()} ${req.method} ${url.pathname}${url.search}`);
    res.writeHead(200, { "content-type": "text/plain" }).end("trap");
    return;
  }

  if (url.pathname === "/submitted" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    console.error(`FORM SUBMIT ${body}`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Submitted</title><h1>Submitted</h1><pre id="body"></pre>
<script>document.getElementById("body").textContent = ${JSON.stringify(body)};</script>`);
    return;
  }

  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = normalize(join(ROOT, relative));
  if (!file.startsWith(normalize(ROOT))) {
    res.writeHead(403).end();
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.error(`Sprout fixtures on http://127.0.0.1:${PORT}/`);
});
