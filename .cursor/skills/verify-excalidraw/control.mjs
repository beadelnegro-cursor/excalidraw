#!/usr/bin/env node
// Control CLI for driving the Excalidraw dev app the way a user does.
// Every command prints one JSON object on stdout and exits non-zero on failure.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SKILL_DIR, "../../..");
const ARTIFACTS_DIR =
  process.env.VERIFY_ARTIFACTS_DIR || path.join(SKILL_DIR, "artifacts");

const COMMANDS = {
  launch: {
    usage: "launch [--port 3001] [--dry-run]",
    help: "Start the Excalidraw dev server (yarn start) in the background and wait until it serves the app.",
  },
  open: {
    usage: "open [--fresh]",
    help: "Start a headless Chromium (if needed) and load the app. --fresh clears the saved scene first.",
  },
  doctor: {
    usage: "doctor",
    help: "Read-only health check: server, port ownership, browser, page, dev hooks, git revision.",
  },
  draw: {
    usage:
      'draw <rectangle|diamond|ellipse|arrow|line|text> [--x 400 --y 300 --w 220 --h 140] [--text "hola"]',
    help: "Pick the tool from the toolbar and drag (or click and type, for text) on the canvas.",
  },
  click: {
    usage:
      "click (--testid <id> | --role <role> --name <name> | --title <title> | --text <text>) [--download [path]]",
    help: "Click one element, found by a stable handle. --download waits for the file the click saves and keeps it.",
  },
  press: {
    usage: "press <key>",
    help: "Press a key or chord, e.g. Escape, ControlOrMeta+Z, r.",
  },
  type: { usage: "type <text>", help: "Type text into whatever has focus." },
  elements: {
    usage: "elements",
    help: "List the live (non-deleted) scene elements with their colors and bounds.",
  },
  state: {
    usage: "state [key ...]",
    help: "Read app state keys (default: activeTool, currentItemStrokeColor, currentItemBackgroundColor, openPopup, selectedElementIds).",
  },
  snapshot: {
    usage: "snapshot [--path file.txt]",
    help: "ARIA snapshot of the page (what a screen reader sees).",
  },
  screenshot: {
    usage: "screenshot [path.png] [--selector <css>]",
    help: "Save a PNG of the page, or of one element. Default path is under the skill's artifacts/ folder.",
  },
  console: {
    usage: "console [--clear]",
    help: "Console messages and page errors captured since the last open.",
  },
  stop: {
    usage: "stop [--dry-run]",
    help: "Stop the server and browser this CLI started. Artifacts are kept.",
  },
};

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  process.exit(code);
}

function fail(error, fix, extra = {}) {
  out({ ok: false, error, fix, ...extra }, 1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const port = () => Number(process.env.VERIFY_PORT || 3001);
const stateDir = (p = port()) =>
  process.env.VERIFY_STATE_DIR ||
  path.join(os.tmpdir(), `verify-excalidraw-${p}`);
const statePath = (p) => path.join(stateDir(p), "state.json");
const appUrl = (p = port()) => `http://localhost:${p}`;

function readState(p = port()) {
  try {
    return JSON.parse(fs.readFileSync(statePath(p), "utf8"));
  } catch {
    return {};
  }
}

function writeState(next, p = port()) {
  fs.mkdirSync(stateDir(p), { recursive: true });
  fs.writeFileSync(statePath(p), JSON.stringify(next, null, 2));
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portInUse(p) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port: p, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

async function fetchApp(p = port()) {
  try {
    const res = await fetch(appUrl(p), { signal: AbortSignal.timeout(3000) });
    const html = await res.text();
    return {
      status: res.status,
      isExcalidraw: /<title>[^<]*Excalidraw/i.test(html),
    };
  } catch {
    return { status: 0, isExcalidraw: false };
  }
}

async function loadPlaywright() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    fail(
      "Playwright is not installed for this skill.",
      `Run: npm install --prefix ${
        path.relative(process.cwd(), SKILL_DIR) || "."
      } && npx --prefix ${
        path.relative(process.cwd(), SKILL_DIR) || "."
      } playwright install chromium`,
    );
  }
}

async function connect() {
  const st = readState();
  if (!st.browser || !alive(st.browser.pid))
    fail("No browser is running for this instance.", "Run: control.mjs open");
  const chromium = await loadPlaywright();
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${st.browser.cdpPort}`,
  );
  const context = browser.contexts()[0];
  const page =
    context.pages().find((pg) => pg.url().startsWith(appUrl())) ||
    context.pages()[0];
  if (!page || !page.url().startsWith(appUrl()))
    fail("The browser is not on the app.", "Run: control.mjs open");
  return { browser, page };
}

const CONSOLE_HOOK = () => {
  if (window.__verifyConsole) return;
  window.__verifyConsole = [];
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      window.__verifyConsole.push({
        level,
        text: args.map(String).join(" "),
        at: new Date().toISOString(),
      });
      original(...args);
    };
  }
  window.addEventListener("error", (e) =>
    window.__verifyConsole.push({
      level: "pageerror",
      text: e.message,
      at: new Date().toISOString(),
    }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    window.__verifyConsole.push({
      level: "pageerror",
      text: String(e.reason),
      at: new Date().toISOString(),
    }),
  );
};

const liveElements = (page) =>
  page.evaluate(() =>
    (window.h?.elements || [])
      .filter((el) => !el.isDeleted)
      .map((el) => ({
        id: el.id,
        type: el.type,
        strokeColor: el.strokeColor,
        backgroundColor: el.backgroundColor,
        x: Math.round(el.x),
        y: Math.round(el.y),
        width: Math.round(el.width),
        height: Math.round(el.height),
        ...(el.text !== undefined ? { text: el.text } : {}),
      })),
  );

async function waitForApp(page) {
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  await page.waitForFunction(() => !!window.h?.app, null, { timeout: 30000 });
}

const handlers = {
  async launch({ flags }) {
    const p = Number(flags.port || port());
    const st = readState(p);
    if (st.server && alive(st.server.pid)) {
      const app = await fetchApp(p);
      out({
        ok: true,
        alreadyRunning: true,
        url: appUrl(p),
        pid: st.server.pid,
        log: st.server.log,
        serving: app.isExcalidraw,
      });
    }
    if (await portInUse(p)) {
      fail(
        `Port ${p} is already in use by a process this CLI did not start.`,
        `Stop that process, or pass --port <free port> and set VERIFY_PORT=<port> for later commands.`,
      );
    }
    const log = path.join(stateDir(p), "server.log");
    if (flags["dry-run"]) {
      out({
        ok: true,
        dryRun: true,
        wouldRun: "yarn start",
        cwd: REPO_ROOT,
        env: { VITE_APP_PORT: String(p), BROWSER: "none" },
        log,
      });
    }
    fs.mkdirSync(stateDir(p), { recursive: true });
    const fd = fs.openSync(log, "w");
    const child = spawn("yarn", ["start"], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: {
        ...process.env,
        VITE_APP_PORT: String(p),
        BROWSER: "none",
        VITE_APP_DISABLE_PREVENT_UNLOAD: "true",
      },
    });
    child.unref();
    writeState(
      {
        ...st,
        server: {
          pid: child.pid,
          port: p,
          log,
          startedAt: new Date().toISOString(),
        },
      },
      p,
    );
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const app = await fetchApp(p);
      if (app.status === 200 && app.isExcalidraw)
        out({
          ok: true,
          url: appUrl(p),
          pid: child.pid,
          log,
          readyInMs: 240000 - (deadline - Date.now()),
        });
      if (!alive(child.pid))
        fail(
          "The dev server exited during startup.",
          `Read the log: ${log}. A missing yarn install is the usual cause.`,
        );
      await new Promise((r) => setTimeout(r, 1000));
    }
    fail(
      "The dev server did not serve the app within 4 minutes.",
      `Read the log: ${log}`,
    );
  },

  async open({ flags }) {
    const app = await fetchApp();
    if (!app.isExcalidraw)
      fail(
        `Nothing is serving Excalidraw at ${appUrl()}.`,
        "Run: control.mjs launch",
      );
    const chromium = await loadPlaywright();
    let st = readState();
    if (!st.browser || !alive(st.browser.pid)) {
      const cdpPort = port() + 6000;
      const profile = path.join(stateDir(), "profile");
      const child = spawn(
        chromium.executablePath(),
        [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profile}`,
          "--headless=new",
          "--disable-blink-features=FileSystemAccess,FileSystemAccessLocal",
          "--no-first-run",
          "--no-default-browser-check",
          "--window-size=1440,900",
          "about:blank",
        ],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      st = { ...st, browser: { pid: child.pid, cdpPort, profile } };
      writeState(st);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !(await portInUse(cdpPort)))
        await new Promise((r) => setTimeout(r, 200));
    }
    const browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${st.browser.cdpPort}`,
    );
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(appUrl(), { waitUntil: "domcontentloaded" });
    if (flags.fresh) {
      await page.evaluate(async () => {
        localStorage.clear();
        for (const db of (await indexedDB.databases?.()) || [])
          if (db.name) indexedDB.deleteDatabase(db.name);
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await waitForApp(page);
    await page.evaluate(CONSOLE_HOOK);
    const elements = await liveElements(page);
    out({
      ok: true,
      url: page.url(),
      title: await page.title(),
      fresh: !!flags.fresh,
      elements: elements.length,
    });
  },

  async doctor() {
    const st = readState();
    const problems = [];
    const app = await fetchApp();
    const serverOurs = !!st.server && alive(st.server.pid);
    if (!app.isExcalidraw)
      problems.push({
        problem: `Nothing serves Excalidraw at ${appUrl()}.`,
        fix: "Run: control.mjs launch",
      });
    else if (!serverOurs)
      problems.push({
        problem: `Port ${port()} serves Excalidraw, but this CLI did not start it.`,
        fix: "Do not drive someone else's instance. Use VERIFY_PORT=<free port> control.mjs launch.",
      });
    const browserUp = !!st.browser && alive(st.browser.pid);
    let page = null;
    if (!browserUp)
      problems.push({
        problem: "No browser is running.",
        fix: "Run: control.mjs open",
      });
    else {
      try {
        const chromium = await loadPlaywright();
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${st.browser.cdpPort}`,
          { timeout: 5000 },
        );
        const pg = browser.contexts()[0]?.pages()[0];
        page = {
          url: pg?.url(),
          devHooks: pg
            ? await pg.evaluate(() => !!window.h?.app).catch(() => false)
            : false,
        };
        if (!page.url?.startsWith(appUrl()))
          problems.push({
            problem: "The browser is not on the app.",
            fix: "Run: control.mjs open",
          });
        else if (!page.devHooks)
          problems.push({
            problem:
              "The app has no dev hooks (window.h). It may be a production build.",
            fix: "Run the dev server with control.mjs launch, not a production build.",
          });
      } catch (e) {
        problems.push({
          problem: `Cannot connect to the browser: ${e.message}`,
          fix: "Run: control.mjs stop, then control.mjs open",
        });
      }
    }
    let revision = null;
    try {
      revision = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT })
        .toString()
        .trim();
    } catch {}
    out(
      {
        ok: problems.length === 0,
        url: appUrl(),
        serving: app.isExcalidraw,
        serverOurs,
        serverPid: st.server?.pid ?? null,
        browserUp,
        page,
        revision,
        problems,
      },
      problems.length ? 1 : 0,
    );
  },

  async draw({ positional, flags }) {
    const tool = positional[0];
    const tools = ["rectangle", "diamond", "ellipse", "arrow", "line", "text"];
    if (!tools.includes(tool))
      fail(
        `Unknown tool "${tool ?? ""}".`,
        `Use one of: ${tools.join(", ")}. Example: control.mjs draw rectangle`,
      );
    const { page } = await connect();
    const before = (await liveElements(page)).length;
    await page.locator(`[data-testid="toolbar-${tool}"]`).first().click();
    const x = Number(flags.x ?? 400);
    const y = Number(flags.y ?? 300);
    if (tool === "text") {
      await page.mouse.click(x, y);
      await page.keyboard.type(String(flags.text ?? "hola"));
      await page.keyboard.press("Escape");
    } else {
      const w = Number(flags.w ?? 220);
      const h = Number(flags.h ?? 140);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + w / 2, y + h / 2, { steps: 5 });
      await page.mouse.move(x + w, y + h, { steps: 5 });
      await page.mouse.up();
    }
    const elements = await liveElements(page);
    if (elements.length <= before)
      fail(
        `Drawing a ${tool} did not add an element.`,
        "Run control.mjs screenshot to see the canvas, and control.mjs console for errors.",
      );
    out({
      ok: true,
      created: elements[elements.length - 1],
      elements: elements.length,
    });
  },

  async click({ flags }) {
    const { page } = await connect();
    let locator;
    if (flags.testid) locator = page.locator(`[data-testid="${flags.testid}"]`);
    else if (flags.role)
      locator = page.getByRole(
        flags.role,
        flags.name ? { name: flags.name } : {},
      );
    else if (flags.title) locator = page.locator(`[title="${flags.title}"]`);
    else if (flags.text) locator = page.getByText(flags.text, { exact: true });
    else
      fail(
        "No handle given.",
        "Pass --testid, --role with --name, --title, or --text.",
      );
    const count = await locator.count();
    if (count === 0)
      fail(
        "Nothing matched that handle.",
        "Run control.mjs snapshot to see the available roles and names.",
      );
    if (flags.download) {
      const download = page
        .waitForEvent("download", { timeout: 10000 })
        .catch(() => null);
      await locator.first().click();
      const file = await download;
      if (!file)
        fail(
          "The click did not start a download within 10 seconds.",
          "Run control.mjs console for errors and control.mjs screenshot to see the page.",
        );
      const target = path.resolve(
        flags.download === true
          ? path.join(ARTIFACTS_DIR, file.suggestedFilename())
          : flags.download,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await file.saveAs(target);
      out({
        ok: true,
        matched: count,
        download: {
          path: target,
          suggestedFilename: file.suggestedFilename(),
          bytes: fs.statSync(target).size,
        },
      });
    }
    await locator.first().click();
    out({ ok: true, matched: count });
  },

  async press({ positional }) {
    if (!positional[0])
      fail("No key given.", "Example: control.mjs press Escape");
    const { page } = await connect();
    await page.keyboard.press(positional[0]);
    out({ ok: true, key: positional[0] });
  },

  async type({ positional }) {
    if (!positional.length)
      fail("No text given.", 'Example: control.mjs type "hola"');
    const { page } = await connect();
    await page.keyboard.type(positional.join(" "));
    out({ ok: true });
  },

  async elements() {
    const { page } = await connect();
    const elements = await liveElements(page);
    out({ ok: true, count: elements.length, elements });
  },

  async state({ positional }) {
    const keys = positional.length
      ? positional
      : [
          "activeTool",
          "currentItemStrokeColor",
          "currentItemBackgroundColor",
          "openPopup",
          "selectedElementIds",
        ];
    const { page } = await connect();
    const state = await page.evaluate(
      (ks) => Object.fromEntries(ks.map((k) => [k, window.h?.state?.[k]])),
      keys,
    );
    out({ ok: true, state });
  },

  async snapshot({ flags }) {
    const { page } = await connect();
    const aria = await page.locator("body").ariaSnapshot();
    if (flags.path) {
      fs.mkdirSync(path.dirname(path.resolve(flags.path)), { recursive: true });
      fs.writeFileSync(flags.path, aria);
      out({
        ok: true,
        path: path.resolve(flags.path),
        lines: aria.split("\n").length,
      });
    }
    out({ ok: true, snapshot: aria });
  },

  async screenshot({ positional, flags }) {
    const { page } = await connect();
    const file = path.resolve(
      positional[0] || path.join(ARTIFACTS_DIR, `screenshot-${Date.now()}.png`),
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (flags.selector) {
      const target = page.locator(flags.selector).first();
      if ((await target.count()) === 0)
        fail(
          `No element matches ${flags.selector}.`,
          "Open the panel first, or run control.mjs snapshot to find a handle.",
        );
      await target.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file });
    }
    out({ ok: true, path: file });
  },

  async console({ flags }) {
    const { page } = await connect();
    const entries = await page.evaluate((clear) => {
      const list = window.__verifyConsole || null;
      if (clear && list) window.__verifyConsole = [];
      return list;
    }, !!flags.clear);
    if (entries === null)
      fail(
        "Console capture is not installed on this page.",
        "Run control.mjs open, which installs it.",
      );
    out({
      ok: true,
      count: entries.length,
      errors: entries.filter(
        (e) => e.level === "error" || e.level === "pageerror",
      ).length,
      entries,
    });
  },

  async stop({ flags }) {
    const st = readState();
    const targets = [
      st.server && alive(st.server.pid)
        ? { what: "dev server", pid: st.server.pid }
        : null,
      st.browser && alive(st.browser.pid)
        ? { what: "browser", pid: st.browser.pid }
        : null,
    ].filter(Boolean);
    if (flags["dry-run"])
      out({
        ok: true,
        dryRun: true,
        wouldStop: targets,
        wouldRemove: st.browser?.profile ?? null,
        keeps: ARTIFACTS_DIR,
      });
    const signal = (pid, sig) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          process.kill(pid, sig);
        } catch {}
      }
    };
    for (const t of targets) signal(t.pid, "SIGTERM");
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && targets.some((t) => alive(t.pid)))
      await new Promise((r) => setTimeout(r, 200));
    for (const t of targets) if (alive(t.pid)) signal(t.pid, "SIGKILL");
    if (st.browser?.profile)
      fs.rmSync(st.browser.profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      });
    writeState({});
    out({ ok: true, stopped: targets, artifactsKept: ARTIFACTS_DIR });
  },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!cmd || cmd === "help" || cmd === "--help") {
    out({
      ok: true,
      usage:
        "node .cursor/skills/verify-excalidraw/control.mjs <command> [options]",
      commands: Object.fromEntries(
        Object.entries(COMMANDS).map(([k, v]) => [k, `${v.usage} — ${v.help}`]),
      ),
    });
  }
  if (!handlers[cmd])
    fail(
      `Unknown command "${cmd}".`,
      `Run: control.mjs --help. Commands: ${Object.keys(COMMANDS).join(", ")}`,
    );
  if (args.flags.help)
    out({
      ok: true,
      command: cmd,
      usage: COMMANDS[cmd].usage,
      help: COMMANDS[cmd].help,
    });
  await handlers[cmd](args);
}

main().catch((e) =>
  fail(
    e.message.split("\n")[0],
    "Run control.mjs doctor to see what is wrong.",
  ),
);
