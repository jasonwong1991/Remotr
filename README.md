# Remotr

English | [简体中文](./README.zh-CN.md)

> **Remote debugging made effortless** — Inject a script into any webpage and get a **live page mirror** with **Chrome DevTools-like panels** in your browser. No USB, no browser extensions, works across devices.

Perfect for debugging scenarios where DevTools isn't accessible: mobile H5 pages, WeChat webviews, smart TV/car browsers, client-site troubleshooting, and more.

## Features

- 🖥️ **Page Mirror** — Built on [rrweb](https://github.com/rrweb-io/rrweb) for real-time recording and replay, faithfully reconstructing the remote page (styles, DOM incremental updates)
- 🎮 **Console** — Intercepts `console.*` + global errors/Promise rejections; supports **executing arbitrary JS** remotely (eval)
- 🌐 **Network** — Intercepts `fetch` / `XHR` / `sendBeacon`, displaying URL/status/timing/headers/body
- 🧬 **Elements** — Rebuilds DOM tree from rrweb snapshots
- 💾 **Storage** — View, edit, and delete localStorage / sessionStorage / Cookies (bidirectional)
- 🔌 **Zero-config Injection** — One `<script>` tag, auto-connects with exponential backoff reconnection
- 📦 **Single-file SDK** — Built as a single IIFE with esbuild (~60KB gzipped, includes rrweb), no dependencies needed on target page

## Architecture

```
 Target Page (injected remotr.js)      Debug Panel (browser)
        │  Collects: console/network           │  Renders: mirror + panels
        │           /storage/DOM(rrweb)        │
     └──────────► WebSocket Relay ◄─────────┘
                     (Node, room routing + backlog replay)
```

Three packages sharing a typed protocol via `@remotr/shared`:

| Package | Description |
|---------|-------------|
| `packages/shared` | Protocol definitions, message envelopes, SpyAtom serialization types (single source of truth) |
| `packages/sdk` | Injection SDK (TypeScript → esbuild IIFE single file) |
| `packages/server` | Relay server (Node + ws), hosts panel and injection script |
| `packages/debugger` | Debug panel (React + Vite + Zustand + rrweb Replayer) |

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build        # Builds shared → sdk → debugger → server
```

### 2. Start Server

```bash
npm start        # Defaults to 0.0.0.0:9777
# Or customize port/host
node packages/server/dist/cli.js --port 9777 --host 0.0.0.0
```

Output after starting:

```
  Remotr server running
  ├─ Debug panel:    http://0.0.0.0:9777/
  ├─ Inject script:  http://0.0.0.0:9777/remotr.js
  └─ WebSocket:      ws://0.0.0.0:9777/ws
```

### 3. Inject Target Page

Add before `</body>` on the page you want to debug (replace host with your server IP for cross-device access):

```html
<script src="http://<your-IP>:9777/remotr.js" data-room="default"></script>
```

`data-*` configuration options:

| Attribute | Description | Default |
|-----------|-------------|---------|
| `data-room` | Room ID (SDK and panel in same room communicate) | `default` |
| `data-server` | Server address (auto-inferred from script src by default) | Script origin |
| `data-mirror` | Enable page mirroring (`false` to disable and save bandwidth) | `true` |

Or start manually in code:

```js
REMOTR.start({ server: 'http://192.168.1.10:9777', room: 'my-app', mirror: true });
```

### 4. Open Debug Panel

Visit `http://<your-IP>:9777/?room=default` in your browser to see the live mirror and debug data from the target page.

## Development

```bash
npm run dev:debugger   # Panel hot reload (Vite dev server, /ws and /api proxy to :9777)
npm run build:sdk      # Rebuild SDK only
npm test -w @remotr/server   # WS relay smoke test
```

`examples/demo.html` is a built-in test page covering various collection scenarios.

## How It Works

1. **Collection**: SDK plugins intercept browser APIs (console/fetch/XHR/storage) following single-responsibility principle; rrweb records full + incremental DOM snapshots
2. **Transport**: All messages use unified `Envelope` format via WebSocket; commands (like eval) carry `id`, replies match with `replyTo`
3. **Relay**: Server routes SDK ↔ panel by `room`; maintains backlog (trimmed at rrweb Meta events) so late-joining panels can rebuild current state
4. **Reconstruction**: Panel uses rrweb `Replayer` in live mode to replay event stream; other panels render from corresponding events

## Security Notice

Remotr collects page data and supports remote JS execution. **Use only in development/debugging environments.** Do not permanently inject in production pages to avoid sensitive data leakage and XSS risks.

## License

MIT
