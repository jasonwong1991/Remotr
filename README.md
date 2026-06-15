# Remotr

English | [简体中文](./README.zh-CN.md)

> **Remote debugging made effortless** — Inject a script into any webpage and get a **live page mirror** with **Chrome DevTools-like panels** in your browser. No USB, no browser extensions, works across devices.

Perfect for debugging scenarios where DevTools isn't accessible: mobile H5 pages, WeChat webviews, smart TV/car browsers, client-site troubleshooting, and more.

## Features

- 🖥️ **Page Mirror** — Built on [rrweb](https://github.com/rrweb-io/rrweb) for real-time recording and replay, faithfully reconstructing the remote page (styles, DOM incremental updates)
- 🎮 **Console** — Intercepts `console.*` + global errors/Promise rejections; supports **executing arbitrary JS** remotely (eval)
- 🌐 **Network** — Intercepts `fetch` / `XHR` / `sendBeacon`, displaying URL/status/timing/headers/body
- 🧬 **Elements** — Live DOM tree rebuilt from the rrweb mirror (hide/delete/edit reflect instantly); DevTools-style right-click menu: copy selector/XPath/JS-path/outerHTML, force pseudo-states (`:hover`/`:focus`/…), hide/edit-HTML/delete, scroll into view; inspect & edit matched rules, computed styles, and box model; element picker
- 💾 **Storage** — View, edit, and delete localStorage / sessionStorage / Cookies (bidirectional)
- 🗺️ **Sources & Source Maps** — Browse the page's scripts; the SDK fetches scripts and `.map` files same-origin (bypassing panel CORS) and resolves minified stacks back to original `src/Foo.tsx:42` with a code snippet. Console errors get a "resolve source" button that jumps straight to the original line.
- 🤖 **AI-Assisted Fixing (MCP)** — A built-in MCP server exposes live errors, source-map-resolved stacks, and console/network context to **Claude Code**. One "Copy for AI fix" button in the session view hands Claude everything it needs to locate and fix the error in your real repo. Graceful degradation: works without source maps too (resolves to minified position + full context).
- 🔌 **Zero-config Injection** — One `<script>` tag, auto-connects with exponential backoff reconnection
- 📦 **Single-file SDK** — Built as a single IIFE with esbuild (~60KB gzipped, includes rrweb), no dependencies needed on target page
- 🔀 **Multi-Device/Multi-Page** — Each device and browser tab is tracked separately with persistent device IDs (localStorage) and ephemeral page IDs (sessionStorage). Perfect for debugging multiple users or testing across devices.
- 👥 **Identity Grouping** — Use `data-identity-cookie` to group sessions by user (e.g., alice, bob). Dashboard automatically groups by identity or device for easy navigation.
- 📊 **Dashboard UI** — Visual overview of all connected sessions at `/#/dashboard`. See real-time status, click any session to debug it.
- 🌍 **i18n** — Built-in English / 简体中文 toggle (defaults to English)
- 🎨 **Theme** — Dark / light mode toggle

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
│  │ │   - Sources             │   │  │
│  │ │   - DOM (rrweb)         │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
│  ┌───────────────┴───────────────┐  │
│  │ Device B / Page 2             │  │
│  │ ┌─────────────────────────┐   │  │
│  │ │ SDK                     │   │  │
│  │ │ • deviceId: dev_def456  │   │  │
│  │ │ • pageId: page_uvw456   │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
└──────────────────┼──────────────────┘
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
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  Per-Session Backlog Storage                                             │   │
│  │  dev_abc123:page_xyz789 → [rrweb + events]                               │   │
│  │  dev_def456:page_uvw456 → [rrweb + events]                               │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  Routing: SDK → Subscribed Debuggers | Debugger → Target SDK                    │
└────────────────────────────────────┬────────────────────────────────────────────┘
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

Six packages sharing a typed protocol via `@remotr/shared`:

| Package             | Description |
|---------------------|-------------|
| `packages/shared`   | Protocol definitions, message envelopes, SpyAtom serialization types (single source of truth) |
| `packages/sdk`      | Injection SDK (TypeScript → esbuild IIFE single file) |
| `packages/server`   | Relay server (Node + ws), hosts panel and injection script |
| `packages/debugger` | Debug panel (React + Vite + Zustand + rrweb Replayer) |
| `packages/sourcemap`| Pure source-map resolver (source-map-js); turns minified `bundle:line:col` into original source + snippet. Shared by panel and MCP. |
| `packages/mcp`      | MCP server (stdio) exposing live errors + resolved stacks + context to Claude Code |

### AI-Assisted Error Fixing

Remotr can hand a runtime error — resolved back to your original source — to **Claude Code** via MCP, so the AI fixes the real file in your repo.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                  AI-Assisted Error Fixing (Source Maps + MCP)                   │
└─────────────────────────────────────────────────────────────────────────────────┘

   Page throws error  ──►  page.error { message, stack }          (SDK, same-origin)
                                      │
                                      ▼
        sources.fetch ◄── debugger / MCP parses stack (url:line:col)
              │
              ▼  SDK fetches script + .map same-origin (bypasses panel CORS)
        @remotr/sourcemap  ──►  original src/Foo.tsx:42:10  +  code snippet
              │
   ┌──────────┴───────────────────────────────┐
   ▼                                           ▼
 Sources panel + Console "resolve"      @remotr/mcp (stdio MCP server)
 click → jump to original source        tools: list_sessions / get_errors /
                                                resolve_error / get_context
                                               │
                                               ▼
                                        Claude Code fixes the real repo source
```

See **[AI-Assisted Error Fixing](#ai-assisted-error-fixing-mcp)** below for setup.

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build        # Builds shared → sourcemap → sdk → debugger → server → mcp
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

## Docker Deployment

Prefer containers? A multi-stage `Dockerfile` and `docker-compose.yml` are included — no local Node toolchain needed.

```bash
docker compose up -d        # Build image and start (port 9777)
docker compose logs -f      # Follow logs
docker compose down         # Stop and remove
```

The panel and inject script are then served just like in [Quick Start](#quick-start):

- Debug panel:   `http://localhost:9777/`
- Inject script: `http://localhost:9777/remotr.js`

For cross-device access, replace `localhost` with the host IP. See **[DOCKER.md](./DOCKER.md)** for production deployment — reverse proxy, HTTPS, resource limits, and troubleshooting.

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
npm test -w @remotr/server      # WS relay smoke test
npm test -w @remotr/sourcemap   # Source-map resolver unit tests
node packages/mcp/test/integration.mjs   # MCP end-to-end (server + fake SDK + resolution)
```

`examples/demo.html` is a built-in test page covering various collection scenarios.

## How It Works

1. **Collection**: SDK plugins intercept browser APIs (console/fetch/XHR/storage) following single-responsibility principle; rrweb records full + incremental DOM snapshots
2. **Transport**: All messages use unified `Envelope` format via WebSocket; commands (like eval) carry `id`, replies match with `replyTo`
3. **Relay**: Server routes SDK ↔ panel by `room`; maintains backlog (trimmed at rrweb Meta events) so late-joining panels can rebuild current state
4. **Reconstruction**: Panel uses rrweb `Replayer` in live mode to replay event stream; other panels render from corresponding events
5. **Multi-Session Routing**: SDK sends `deviceId`, `pageId`, `identity` in connection params. Server maintains per-session backlog and routes messages based on session ID. Dashboard receives updates for all sessions; session debugger only receives messages from its target session.
6. **Source Maps & AI Fixing**: On demand, the panel/MCP sends a `sources.fetch` command; the SDK fetches the script and its `.map` same-origin (bypassing the panel's cross-origin restriction) and returns them. `@remotr/sourcemap` resolves minified stack frames to original `file:line:col` + code snippets. The MCP server packages this with console/network context for Claude Code to fix the real source.

## AI-Assisted Error Fixing (MCP)

Remotr ships an MCP server (`@remotr/mcp`) that lets **Claude Code** read live runtime errors from a session, resolve their stacks back to your original source via source maps, and gather console/network context — then fix the error in your real repo.

### Setup

Add the MCP server to your project's `.mcp.json` (or Claude Code MCP config):

```json
{
  "mcpServers": {
    "remotr": {
      "command": "node",
      "args": ["<remotr-repo>/packages/mcp/dist/cli.js", "--server", "http://localhost:9777", "--room", "default"]
    }
  }
}
```

`--server` is the Remotr server URL, `--room` the room to inspect (env `REMOTR_SERVER` / `REMOTR_ROOM` also work).

### Tools exposed

| Tool | Purpose |
|------|---------|
| `remotr_list_sessions` | List live sessions (deviceId, pageId, url, framework, identity). Call first to find a target. |
| `remotr_get_errors` | Recent errors for a session (uncaught errors, unhandled rejections, console.error) with raw stacks. |
| `remotr_resolve_error` | Resolve one error's stack to original `file:line` + code snippet per frame via source maps. |
| `remotr_get_context` | Full diagnostic bundle: system info, the error, resolved frames + snippets, recent console timeline, failed network requests. |

A session is identified by the **(deviceId, pageId) pair** — `pageId` is derived deterministically from the URL, `deviceId` distinguishes browsers/devices.

### The fast path: "Copy for AI fix"

In the session view toolbar, click **🤖 Copy for AI fix**. It copies a ready-to-paste prompt — the server/room/deviceId/pageId/url plus instructions — into your clipboard. Paste it into Claude Code and it will activate the MCP, pull the resolved error and context, and propose a fix against your repo. The clipboard text also includes the `.mcp.json` snippet in case the MCP isn't configured yet.

### Without source maps

If a script ships no source map (or it's `hidden-source-map` / cross-origin / behind CORS), resolution **degrades gracefully**: tools still return the error message, minified location, console timeline, failed requests, and page context. Claude can often still locate the fix from the message + symbols + context — just less precisely than with a map. To get precise mapping, serve `.map` files same-origin with the `//# sourceMappingURL=` comment intact (dev/staging builds usually already do).

## Security Notice

Remotr collects page data and supports remote JS execution. **Use only in development/debugging environments.** Do not permanently inject in production pages to avoid sensitive data leakage and XSS risks.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) before submitting issues or pull requests.

- 🐛 [Report a bug](https://github.com/jasonwong1991/Remotr/issues/new?template=bug_report.md)
- 💡 [Request a feature](https://github.com/jasonwong1991/Remotr/issues/new?template=feature_request.md)
- 🔧 [Submit a pull request](https://github.com/jasonwong1991/Remotr/compare)

## License

MIT
