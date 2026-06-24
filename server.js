const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { mouse, keyboard, Point, Key, Button, screen } = require("@nut-tree-fork/nut-js");
const { execSync } = require("child_process");
const path = require("path");
const os = require("os");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  port: 3000,
  mouseSpeed: 1500,
};

// ─── Key name map (client string → nut-js Key enum value) ────────────────────
// nut-js Key enum names are case-sensitive. Print above to verify on your build.
// Key map: client string -> nut-js Key enum
// Confirmed names from Key enum log output
const KEY_MAP = {
  // Standard
  BackSpace: Key.Backspace,
  Return: Key.Return,
  Escape: Key.Escape,
  Tab: Key.Tab,
  Up: Key.Up,
  Down: Key.Down,
  Left: Key.Left,
  Right: Key.Right,
  Delete: Key.Delete,
  Space: Key.Space,
  // Letters (hotkeys send uppercase e.g. 'C', 'V', 'Z')
  A: Key.A,
  B: Key.B,
  C: Key.C,
  D: Key.D,
  E: Key.E,
  F: Key.F,
  G: Key.G,
  H: Key.H,
  I: Key.I,
  J: Key.J,
  K: Key.K,
  L: Key.L,
  M: Key.M,
  N: Key.N,
  O: Key.O,
  P: Key.P,
  Q: Key.Q,
  R: Key.R,
  S: Key.S,
  T: Key.T,
  U: Key.U,
  V: Key.V,
  W: Key.W,
  X: Key.X,
  Y: Key.Y,
  Z: Key.Z,
  // Function keys
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
  // Modifiers (confirmed from Key enum log)
  LeftControl: Key.LeftControl,
  LeftShift: Key.LeftShift,
  LeftAlt: Key.LeftAlt,
  LeftSuper: Key.LeftSuper, // also available: Key.LeftWin, Key.LeftCmd
  // Media keys (confirmed names from log)
  AudioMute: Key.AudioMute,
  AudioVolUp: Key.AudioVolUp,
  AudioVolDown: Key.AudioVolDown,
  AudioPlay: Key.AudioPlay,
  AudioStop: Key.AudioStop,
  AudioPause: Key.AudioPause,
  AudioPrev: Key.AudioPrev,
  AudioNext: Key.AudioNext,
};

function resolveKey(name) {
  const k = KEY_MAP[name] ?? Key[name];
  if (k === undefined) console.warn(`Unknown key: "${name}"`);
  return k ?? name;
}

// ─── Faster typing via PowerShell clipboard paste ────────────────────────────
async function typeText(text) {
  try {
    const escaped = text.replace(/'/g, "''");
    execSync(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, { timeout: 3000 });
    await keyboard.pressKey(Key.LeftControl, Key.V);
    await keyboard.releaseKey(Key.LeftControl, Key.V);
  } catch {
    await keyboard.type(text);
  }
}

async function doScroll(dy) {
  const steps = Math.min(Math.abs(Math.round(dy)), 30);
  if (steps === 0) return;
  if (dy > 0) await mouse.scrollDown(steps);
  else await mouse.scrollUp(steps);
}

// ─── Server setup ─────────────────────────────────────────────────────────────
mouse.config.mouseSpeed = CONFIG.mouseSpeed;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { index: "index.html" }));

app.get("/favicon.ico", (_req, res) => {
  res.type("image/x-icon");
  res.sendFile(path.join(publicDir, "favicon.ico"));
});

app.get("/manifest.json", (_req, res) => {
  res.type("application/manifest+json");
  res.sendFile(path.join(publicDir, "manifest.json"));
});

app.get("/screen", async (_req, res) => {
  const width = await screen.width();
  const height = await screen.height();
  res.json({ width, height });
});

// ─── WebSocket handler ────────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  console.log("Phone connected");

  let scrollSum = 0;
  let scrollBusy = false;

  async function drainScroll() {
    if (scrollBusy) return;
    scrollBusy = true;
    try {
      while (scrollSum !== 0) {
        const dy = scrollSum;
        scrollSum = 0;
        await doScroll(dy);
      }
    } catch (err) {
      console.error("Scroll error:", err);
    } finally {
      scrollBusy = false;
      if (scrollSum !== 0) drainScroll();
    }
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "mousemove": {
        const pos = await mouse.getPosition();
        await mouse.setPosition(new Point(pos.x + msg.dx, pos.y + msg.dy));
        break;
      }

      case "mouseabs":
        await mouse.setPosition(new Point(msg.x, msg.y));
        break;

      case "mousedown":
        await mouse.pressButton(msg.button === "right" ? Button.RIGHT : Button.LEFT);
        break;

      case "mouseup":
        await mouse.releaseButton(msg.button === "right" ? Button.RIGHT : Button.LEFT);
        break;

      case "click":
        await mouse.click(msg.button === "right" ? Button.RIGHT : Button.LEFT);
        break;

      case "doubleclick":
        await mouse.doubleClick(Button.LEFT);
        break;

      case "scroll":
        scrollSum += msg.dy;
        drainScroll();
        return;

      case "keypress": {
        const k = resolveKey(msg.key);
        await keyboard.pressKey(k);
        await keyboard.releaseKey(k);
        break;
      }

      case "type":
        await typeText(msg.text);
        break;

      case "hotkey": {
        const keys = msg.keys.map(resolveKey);
        await keyboard.pressKey(...keys);
        await keyboard.releaseKey(...keys.slice().reverse());
        break;
      }
    }
  });

  ws.on("close", () => console.log("Phone disconnected"));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const ip =
  Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i?.family === "IPv4" && !i.internal)?.address ?? "localhost";

server.listen(CONFIG.port, "0.0.0.0", () => {
  console.log(`\nServer running — open on phone: http://${ip}:${CONFIG.port}\n`);
});
