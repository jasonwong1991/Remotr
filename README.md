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
- 🔀 **Multi-Device/Multi-Page** — Each device and browser tab is tracked separately with persistent device IDs (localStorage) and ephemeral page IDs (sessionStorage). Perfect for debugging multiple users or testing across devices.
- 👥 **Identity Grouping** — Use `data-identity-cookie` to group sessions by user (e.g., alice, bob). Dashboard automatically groups by identity or device for easy navigation.
- 📊 **Dashboard UI** — Visual overview of all connected sessions at `/#/dashboard`. See real-time status, click any session to debug it.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Remotr Multi-Device Session Architecture                     │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│        Browser Instances            │
│  (Multiple Devices / Pages)         │
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Device A / Page 1             │  │
│  │ <script src="remotr.js"       │  │
│  │   data-room="default">        │  │
│  │ ┌─────────────────────────┐   │  │
│  │ │ SDK                     │   │  │
│  │ │ • deviceId: dev_abc123  │   │  │
│  │ │ • pageId: page_xyz789   │   │  │
│  │ │ • identity: (cookie)    │   │  │
│  │ │ • Plugins:              │   │  │
│  │ │   - Console             │   │  │
│  │ │   - Network             │   │  │
│  │ │   - Storage             │   │  │
│  │ │   - DOM (rrweb)         │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
│  ┌───────────────┴───────────────┐  │
│  │ Device B / Page 2             │  │
│  │ ┌─────────────────────────┐   │  │
│  │ │ SDK                     │   │  │
│  │ │ • deviceId: dev_def456  │   │  │
│  │ │ • pageId: page_uvw456   │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
└──────────────────┼───────────────────┘
                   │
                   │ Events with SessionMetadata
                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WebSocket Server (Room)                               │
│                          ws://host:port/ws?room=X                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  SDK:       ?role=sdk&deviceId=X&pageId=Y&identity=Z                            │
│  Debugger:  ?role=debugger&deviceId=X&pageId=Y  (Session mode)                  │
│  Dashboard: ?role=debugger  (Dashboard mode)                                    │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │  Per-Session Backlog Storage                                           │   │
│  │  dev_abc123:page_xyz789 → [rrweb + events]                             │   │
│  │  dev_def456:page_uvw456 → [rrweb + events]                             │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  Routing: SDK → Subscribed Debuggers | Debugger → Target SDK                   │
└────────────────────────────────────┬───────────────────────────────────────────┘
                   ┌─────────────────┴─────────────────┐
                   │                                   │
                   ▼                                   ▼
    ┌───────────────────────────┐       ┌───────────────────────────────┐
    │   Dashboard Debugger      │       │   Session Debugger            │
    │   /#/dashboard            │       │   /#/session?deviceId=X&      │
    │   (Browser)               │       │          pageId=Y             │
    ├───────────────────────────┤       ├───────────────────────────────┤
    │ Shows all sessions:       │       │ Debugs specific session:      │
    │ • Group by identity       │       │ • Page Mirror (rrweb)         │
    │ • Group by device         │       │ • Console Panel               │
    │ • Click to debug          │       │ • Network Panel               │
    └───────────────────────────┘       │ • Elements Panel              │
                                        │ • Storage Panel               │
                                        └───────────────────────────────┘
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
| `data-device-id` | Manual device ID (overrides auto-generated) | Auto (persistent in localStorage) |
| `data-identity-cookie` | Cookie name to read identity from (for grouping in Dashboard) | - |

**Identity grouping example:**
```html
<!-- Page sets: document.cookie = "username=alice" -->
<script 
  src="http://<your-IP>:9777/remotr.js" 
  data-room="default"
  data-identity-cookie="username"
></script>
```

Or start manually in code:

```js
REMOTR.start({ server: 'http://192.168.1.10:9777', room: 'my-app', mirror: true });
```

### 4. Open Debug Panel

**Dashboard** (view all sessions):
```
http://<your-IP>:9777/
or
http://<your-IP>:9777/#/dashboard?room=default
```

Features:
- See all connected devices/pages in real-time
- Toggle between "Group by Identity" and "Group by Device"
- Click any session card to enter debug mode
- Shows browser, viewport, URL, framework, online status, last activity

**Session Debug** (debug specific page):
```
http://<your-IP>:9777/#/session?room=default&deviceId=xxx&pageId=yyy
```

Click "← Dashboard" button in session view to return.

## Multi-Session Workflow

1. **Inject multiple pages**: Add the SDK script to different devices/browsers/tabs
2. **Set identity** (optional): Use `data-identity-cookie="username"` to group by user
3. **Open Dashboard**: Visit `http://<your-IP>:9777/` to see all sessions
4. **Debug session**: Click any session card to enter full debug mode for that page
5. **Switch sessions**: Use "← Dashboard" button to return and select another session

**Example: QA Testing with Multiple Test Accounts**

```html
<!-- alice's session -->
<script 
  src="http://localhost:9777/remotr.js" 
  data-room="qa"
  data-identity-cookie="username"
></script>
```

Dashboard will show:
```
👤 alice
  💻 MacBook Pro (dev_abc123)
    📄 Home page (online, 2 seconds ago)
    📄 Profile page (online, 5 seconds ago)

👤 bob  
  💻 iPhone 14 (dev_def456)
    📄 Home page (online, 1 second ago)
```

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
5. **Multi-Session Routing**: SDK sends `deviceId`, `pageId`, `identity` in connection params. Server maintains per-session backlog and routes messages based on session ID. Dashboard receives updates for all sessions; session debugger only receives messages from its target session.

## Security Notice

Remotr collects page data and supports remote JS execution. **Use only in development/debugging environments.** Do not permanently inject in production pages to avoid sensitive data leakage and XSS risks.

## License

MIT
