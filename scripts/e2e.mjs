#!/usr/bin/env node
/**
 * Browser end-to-end checks for the interactive parts of the editor.
 *
 * The unit tests only cover pure functions, so pointer behaviour (hiding
 * handles, drag arithmetic, hit testing) had no automated coverage at all. This
 * script drives the real app in a headless Chromium-family browser over the
 * DevTools protocol: Vite serves the UI, the browser renders it, and every
 * assertion runs inside the page.
 *
 * Not part of `npm test`: it needs a browser and a free port. Run it with
 * `npm run e2e`.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_PORT = Number(process.env.MOSHARP_E2E_PORT ?? 5199);
const DEBUG_PORT = Number(process.env.MOSHARP_E2E_DEBUG_PORT ?? 9333);
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, what, timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Not ready yet.
    }
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(120);
  }
}

function findBrowser() {
  if (process.env.MOSHARP_E2E_BROWSER) return process.env.MOSHARP_E2E_BROWSER;
  return BROWSERS.find((path) => existsSync(path)) ?? null;
}

/** Minimal DevTools client: request/response only, no events needed here. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression, extra = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...extra,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const failures = [];
let checked = 0;

function check(name, condition, detail = "") {
  checked += 1;
  if (condition) {
    console.log(`  ok  ${name}`);
    return true;
  }
  const message = detail ? `${name} — ${detail}` : name;
  console.log(`  FAIL ${message}`);
  failures.push(message);
  return false;
}

/** Type text into the focused editor through the browser's input pipeline. */
async function type(cdp, text) {
  await cdp.send("Input.insertText", { text });
}

async function mouse(cdp, type, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
}

/** Select the whole document so the test types into an empty buffer. */
async function selectAll(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error("No Chromium-family browser found. Set MOSHARP_E2E_BROWSER to its path.");
    process.exit(2);
  }

  const profile = await mkdtemp(join(tmpdir(), "mosharp-e2e-"));
  const vite = spawn(
    process.execPath,
    [
      join("node_modules", "vite", "bin", "vite.js"),
      "--port",
      String(APP_PORT),
      "--strictPort",
      // Bind IPv4 explicitly: Vite's default `localhost` can resolve to ::1,
      // which the fetch below would then miss.
      "--host",
      "127.0.0.1",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const chrome = spawn(
    browser,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1300,900",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  const cleanup = async () => {
    chrome.kill();
    vite.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  let cdp;
  try {
    await waitFor(async () => (await fetch(APP_URL)).ok, "the dev server", 40000);
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await response.json();
      return list.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? null;
    }, "a browser page target");

    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: APP_URL });
    await waitFor(
      () => cdp.evaluate("!!document.querySelector('.cm-content')"),
      "the editor to mount",
    );

    // A small settle: CodeMirror measures on the first frame.
    await sleep(400);

    console.log("table rendering");
    await cdp.evaluate("document.querySelector('.cm-content').focus()");
    // The app starts with a welcome document that also holds a table; clear it
    // so the counts below describe only the table typed here.
    await selectAll(cdp);
    await type(cdp, "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n");
    await sleep(600);

    const rendered = await cdp.evaluate(`(() => ({
      tables: document.querySelectorAll('.cm-md-table-widget').length,
      resizeGrips: document.querySelectorAll('.cm-md-col-grip').length,
      moveGrips: document.querySelectorAll('.cm-md-col-move-grip').length,
      rowGrips: document.querySelectorAll('.cm-md-row-grip').length,
      cells: document.querySelectorAll('.cm-md-cell').length,
    }))()`);
    check("the table renders as a widget", rendered.tables === 1, JSON.stringify(rendered));
    check("every column has a resize grip", rendered.resizeGrips === 2, `got ${rendered.resizeGrips}`);
    check("every column has a move grip", rendered.moveGrips === 2, `got ${rendered.moveGrips}`);
    check("every body row has a move grip", rendered.rowGrips === 1, `got ${rendered.rowGrips}`);
    check("cells are editable", rendered.cells === 4, `got ${rendered.cells}`);

    console.log("column resize");
    const before = await cdp.evaluate(
      "document.querySelector('.cm-md-table-widget').getBoundingClientRect().width",
    );
    const grip = await cdp.evaluate(`(() => {
      const box = document.querySelector('.cm-md-col-grip').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    await mouse(cdp, "mousePressed", grip.x, grip.y);
    await mouse(cdp, "mouseMoved", grip.x - 40, grip.y);
    await sleep(80);
    await mouse(cdp, "mouseReleased", grip.x - 40, grip.y);
    await sleep(300);
    const after = await cdp.evaluate(
      "document.querySelector('.cm-md-table-widget').getBoundingClientRect().width",
    );
    check("dragging the grip narrows the column", after < before - 10, `${before} → ${after}`);

    console.log("cell range selection");
    const cells = await cdp.evaluate(`(() => {
      const list = Array.from(document.querySelectorAll('.cm-md-cell'));
      return list.slice(0, 2).map((cell) => {
        const box = cell.getBoundingClientRect();
        // Well right of the row drag handle, which owns the first 9px.
        return { x: box.left + 24, y: box.top + box.height / 2 };
      });
    })()`);
    await sleep(150);
    await mouse(cdp, "mousePressed", cells[0].x, cells[0].y);
    await mouse(cdp, "mouseMoved", cells[1].x, cells[1].y);
    await sleep(150);
    const selected = await cdp.evaluate(
      "document.querySelectorAll('.cm-md-cell-selected').length",
    );
    await mouse(cdp, "mouseReleased", cells[1].x, cells[1].y);
    check("dragging across cells selects them", selected >= 2, `got ${selected}`);
  } finally {
    cdp?.close();
    await cleanup();
  }

  console.log(`\n${checked - failures.length}/${checked} E2E checks passed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
