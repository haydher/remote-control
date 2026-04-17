const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { mouse, keyboard, Point, Key, Button, screen } = require('@nut-tree-fork/nut-js');
const path = require('path');
const os = require('os');

// Speed up mouse
mouse.config.mouseSpeed = 1500;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve the mobile UI
app.use(express.static(path.join(__dirname, 'public')));

// Screen size endpoint for the client
app.get('/screen', async (req, res) => {
  const { width, height } = await screen.width().then(w =>
    screen.height().then(h => ({ width: w, height: h }))
  );
  res.json({ width, height });
});

wss.on('connection', ws => {
  console.log('Phone connected');

  ws.on('message', async raw => {
    const msg = JSON.parse(raw);

    switch (msg.type) {
      case 'mousemove': {
        const pos = await mouse.getPosition();
        await mouse.setPosition(new Point(
          pos.x + msg.dx,
          pos.y + msg.dy
        ));
        break;
      }
      case 'mouseabs': {
        await mouse.setPosition(new Point(msg.x, msg.y));
        break;
      }
      case 'click': {
        const btn = msg.button === 'right' ? Button.RIGHT : Button.LEFT;
        await mouse.click(btn);
        break;
      }
      case 'doubleclick': {
        await mouse.doubleClick(Button.LEFT);
        break;
      }
      case 'scroll': {
        if (msg.dy > 0) await mouse.scrollDown(msg.dy);
        else await mouse.scrollUp(-msg.dy);
        break;
      }
      case 'keypress': {
        // msg.key = e.g. "Return", "BackSpace", "space", or a character
        const k = Key[msg.key] ?? msg.key;
        await keyboard.pressKey(k);
        await keyboard.releaseKey(k);
        break;
      }
      case 'type': {
        await keyboard.type(msg.text);
        break;
      }
      case 'hotkey': {
        // msg.keys = array of Key names e.g. ["LeftControl","c"]
        const keys = msg.keys.map(k => Key[k] ?? k);
        await keyboard.pressKey(...keys);
        await keyboard.releaseKey(...keys);
        break;
      }
    }
  });

  ws.on('close', () => console.log('Phone disconnected'));
});

// Print local IP for easy phone connection
const ip = Object.values(os.networkInterfaces())
  .flat()
  .find(i => i.family === 'IPv4' && !i.internal)?.address;

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Server running`);
  console.log(`   Open on phone: http://${ip}:${PORT}\n`);
});