// One-off icon pipeline for the installable web app. Rasterises public/logo.svg
// through the installed Edge runtime (headless), so the project keeps zero native
// image dependencies and no paid tooling is involved.
//
//   node dev/tools/make-icons.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "public");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9334;

const RENDER_HTML = `<!doctype html><meta charset="utf-8"><title>icons</title>
<script>
async function render(url, size, insetRatio, background) {
  const image = new Image();
  image.decoding = "sync";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("logo load failed"));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  const inset = Math.round(size * insetRatio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
</script>`;

const TARGETS = [
  { name: "icon-192.png", size: 192, inset: 0.1, background: "#0B0B10" },
  { name: "icon-512.png", size: 512, inset: 0.1, background: "#0B0B10" },
  { name: "icon-maskable-512.png", size: 512, inset: 0.2, background: "#0B0B10" },
  { name: "apple-touch-icon.png", size: 180, inset: 0.12, background: "#0B0B10" },
];

function serve() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://x").pathname);
    if (pathname === "/render.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(RENDER_HTML);
      return;
    }
    const file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const type = file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(9556, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-icons-"));
  const browser = spawn(edge, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-extensions",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    let wsUrl = null;
    for (let attempt = 0; attempt < 60 && !wsUrl; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        wsUrl = list.find((page) => page.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {
        /* Edge still starting */
      }
    }
    if (!wsUrl) throw new Error("Edge DevTools endpoint unavailable");

    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

    await send("Page.enable");
    await send("Page.navigate", { url: "http://127.0.0.1:9556/render.html" });
    await new Promise((resolve) => setTimeout(resolve, 600));

    for (const target of TARGETS) {
      const expression = `render(${JSON.stringify("http://127.0.0.1:9556/public/logo.svg")}, ${target.size}, ${target.inset}, ${JSON.stringify(target.background)})`;
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      const file = path.join(outDir, target.name);
      fs.writeFileSync(file, Buffer.from(result.result.value, "base64"));
      console.log(target.name, fs.statSync(file).size, "bytes");
    }
    socket.close();
  } finally {
    browser.kill();
    server.close();
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Edge may hold the temporary profile briefly. */
    }
  }
}

await main();
