// Ad-hoc PWA acceptance check. Drives the installed Edge runtime (headless) over
// CDP so the mobile install offer and the offline fallback can be observed
// without adding a browser-test dependency.
//
//   node dev/tools/check-pwa.mjs [https://deployed-origin]
//
// Offline is tested against the local build: the tiny static server is killed
// mid-run, which produces a real network failure instead of DevTools' synthetic
// offline mode (that mode fails browser-initiated navigations before the
// service worker can answer them).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dist = path.join(root, "dist");
const liveOrigin = process.argv[2] ?? "https://lootpat-bazar-mn5ghdtcxnu.qoder.website";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9335;
const localPort = 9557;
const shots = path.join(root, "dev/tmp");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function serveLocal() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://x").pathname);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(dist, "index.html");
    }
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(localPort, "127.0.0.1", () => resolve(server)));
}

async function main() {
  fs.mkdirSync(shots, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-pwa-"));
  let server = await serveLocal();
  const localOrigin = `http://127.0.0.1:${localPort}`;
  const browser = spawn(edge, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-extensions",
    "--window-size=390,844",
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
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate failed");
      return result.result.value;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const viewport = () => evaluate(`({
      innerWidth,
      innerHeight,
      visual: window.visualViewport ? { height: visualViewport.height, offsetTop: visualViewport.offsetTop } : null,
      clientHeight: document.documentElement.clientHeight,
    })`);

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

    // ---- Offline: real connection failure against the local build ----------
    await send("Page.navigate", { url: localOrigin + "/" });
    await wait(6000);
    const localState = await evaluate(`(async () => ({
      controlled: Boolean(navigator.serviceWorker.controller),
      caches: await caches.keys(),
      viewport: { innerWidth, innerHeight },
    }))()`);
    console.log("local-online", localState);

    server.close();
    await new Promise((resolve) => server.once("close", resolve));

    await send("Page.navigate", { url: localOrigin + "/shop" });
    await wait(3000);
    const cachedShell = await evaluate(`({
      url: location.href,
      heading: document.querySelector("h1")?.innerText?.trim() ?? null,
      hasOfflineCopy: document.body.innerText.includes("ইন্টারনেট সংযোগ নেই"),
    })`);
    console.log("offline-with-shell-cache", cachedShell);

    await evaluate(`(async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      return keys;
    })()`);
    await send("Page.navigate", { url: localOrigin + "/shop" });
    await wait(3000);
    const offlinePage = await evaluate(`({
      url: location.href,
      heading: document.querySelector("h1")?.innerText?.trim() ?? null,
      hasOfflineCopy: document.body.innerText.includes("ইন্টারনেট সংযোগ নেই"),
      retryButton: document.querySelector("button")?.innerText?.trim() ?? null,
    })`);
    console.log("offline-cold", offlinePage);

    // ---- Install offer on a phone-sized live viewport ----------------------
    await send("Page.navigate", { url: liveOrigin + "/" });
    await wait(7000);
    const before = await viewport().then((v) => ({ ...v, ...null }));
    const beforeRect = await evaluate(`({
      controlled: Boolean(navigator.serviceWorker.controller),
      promptVisible: Boolean(document.querySelector('[role="region"][aria-label]')),
    })`);
    console.log("live-mobile-before", { ...before, ...beforeRect });

    await evaluate(`(() => {
      const event = new Event("beforeinstallprompt");
      event.prompt = async () => {};
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
      return true;
    })()`);
    await wait(700);
    const card = await evaluate(`(() => {
      const element = document.querySelector('[role="region"][aria-label]');
      if (!element) return { visible: false };
      const rect = element.getBoundingClientRect();
      return {
        visible: true,
        label: element.getAttribute("aria-label"),
        text: element.innerText.replace(/\\s+/g, " ").trim(),
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height },
        viewport: { innerWidth, innerHeight },
        fits: rect.bottom <= innerHeight && rect.top >= 0,
      };
    })()`);
    console.log("live-mobile-card", card);

    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shots, "pwa-mobile.png"), Buffer.from(shot.data, "base64"));

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
