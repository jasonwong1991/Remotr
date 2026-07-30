# Remotr

English | [简体中文](./README.zh-CN.md)

> **Remote debugging made effortless** — Inject a script into any webpage and get a **live page mirror** with **Chrome DevTools-like panels** in your browser. No USB, no browser extensions, works across devices.

Perfect for debugging scenarios where DevTools isn't accessible: mobile H5 pages, WeChat webviews, smart TV/car browsers, client-site troubleshooting, and more.

## Features

- 🖥️ **Page Mirror** — Built on [rrweb](https://github.com/rrweb-io/rrweb) for real-time recording and replay, faithfully reconstructing the remote page (styles, DOM incremental updates); **manual zoom** (25%–200%) with auto-centering
- 🎮 **Console** — Intercepts `console.*` + global errors/Promise rejections; supports **executing arbitrary JS** remotely (eval)
- 🌐 **Network** — Intercepts `fetch` / `XHR` / `sendBeacon`, displaying URL/status/timing/headers/body. **WebSocket & SSE (EventSource) inspection** — every connection with its frame log (direction, size, payload preview). **Copy-as-cURL**, **HAR 1.2 export**, and resource-type filtering.
- 📈 **Performance** — Core Web Vitals (FCP / LCP / CLS / TTFB with good/needs-improvement/poor rating), long-task list, and live JS-heap + FPS sparklines. Built on `PerformanceObserver`, fully feature-detected for old WebViews.
- 🧬 **Elements** — Live DOM tree rebuilt from the rrweb mirror (hide/delete/edit reflect instantly); DevTools-style right-click menu: copy selector/XPath/JS-path/outerHTML, force pseudo-states (`:hover`/`:focus`/…), hide/edit-HTML/delete, scroll into view; inspect & edit matched rules, computed styles, and box model; element picker
- ⚛️ **Component Inspection (React / Vue)** — Select any element in the mirror and the Elements panel's **Component** sub-tab shows the owning framework component: name, framework badge, ancestor chain, **props** and **state** (React hooks / class state, Vue 3 setup/data, Vue 2 `$data`). Reads the same DOM-attached fibers/instances React & Vue DevTools use — no app-side setup, per-element detection so mixed-framework pages work.
- 🎯 **Function Tracepoints** — Trace any globally-reachable function by dotted path (e.g. `app.store.dispatch`) without pausing execution. Each call reports **arguments / return value / thrown error / call stack / duration**, serialized just like console objects. Optional condition expression (referencing `args` / `ret`) filters noisy call sites — a no-pause alternative to breakpoints for injected debugging.
- 💾 **Storage** — View, edit, and delete localStorage / sessionStorage / Cookies (bidirectional)
- 🗺️ **Sources & Source Maps** — Browse the page's scripts; the SDK fetches scripts and `.map` files same-origin (bypassing panel CORS) and resolves minified stacks back to original `src/Foo.tsx:42` with a code snippet. Console errors get a "resolve source" button that jumps straight to the original line.
- 🤖 **AI-Assisted Debugging (MCP)** — A built-in MCP server lets **Claude Code** both **read and drive** a live session. Read-side: live errors, source-map-resolved stacks, console/network context. **Act-side: `remotr_run_eval`** (execute JS in the page), **`remotr_set_tracepoint` / `remotr_get_tracepoint_hits`** (place no-pause breakpoints and read hits), and **`remotr_diagnose`** (one call → error + resolved stack + snippet + console/network timeline + suggested cause). One "Copy for AI fix" button hands Claude everything it needs. Graceful degradation: works without source maps too.
- 🧯 **Pre-connect Error Buffer** — A capped ring buffer captures `window.onerror` / unhandled rejections / `console.error` from SDK init onward and flushes them on first connect, so boot-time crashes that happen *before* the socket opens aren't lost.
- 🔌 **Zero-config Injection** — One `<script>` tag, auto-connects with exponential backoff reconnection
- 📦 **Single-file SDK** — Built as a single IIFE with esbuild (~60KB gzipped, includes rrweb), no dependencies needed on target page
- 🔀 **Multi-Device/Multi-Page** — Each device and browser tab is tracked separately with persistent device IDs (localStorage) and deterministic page IDs (URL fingerprint + concurrent-tab slots, so reopening the same page resumes the same session). Perfect for debugging multiple users or testing across devices.
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
| `packages/mcp`      | MCP server (Streamable HTTP at `/mcp` on the relay + stdio CLI) exposing live errors + resolved stacks + context to Claude Code |

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
 Sources panel + Console "resolve"      @remotr/mcp (HTTP /mcp + stdio)
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
npm run build        # Builds shared → sourcemap → sdk → debugger → mcp → server
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
  ├─ MCP (HTTP):     http://0.0.0.0:9777/mcp
  └─ WebSocket:      ws://0.0.0.0:9777/ws
```

### 3. Inject Target Page

Add before `</body>` on the page you want to debug (replace host with your server IP for cross-device access):

```html
<script src="http://<your-IP>:9777/remotr.js" data-room="default"></script>
```

`data-*` configuration options (auto-start mode):

| Attribute | Maps to | Description | Default |
|-----------|---------|-------------|---------|
| `data-room` | `room` | Room ID (SDK and panel in the same room communicate) | `default` |
| `data-server` | `server` | Server address (auto-inferred from script `src` by default) | Script origin |
| `data-mirror` | `mirror` | Enable page mirroring (`"false"` disables rrweb to save bandwidth) | `true` |
| `data-device-id` | `deviceId` | Manual device ID (overrides auto-generated) | Auto (persisted in localStorage) |
| `data-page-id` | `pageId` | Manual page ID (overrides URL-fingerprint default) | Auto (URL fingerprint) |
| `data-identity` | `identity` | Static identity string (e.g. a username), takes precedence over the cookie | - |
| `data-identity-cookie` | `identityCookie` | Cookie name to read the identity from (for grouping in Dashboard) | - |
| `data-auto` | - | Force auto-start even when none of `data-room` / `data-server` is present | - |

> Auto-start triggers when the inject script carries **any** of `data-room`, `data-server`, or `data-auto`. Otherwise call `REMOTR.start()` yourself.

**Identity grouping example:**
```html
<!-- Page sets: document.cookie = "username=alice" -->
<script 
  src="http://<your-IP>:9777/remotr.js" 
  data-room="default"
  data-identity-cookie="username"
></script>
```

### `REMOTR.start(config?)` — manual API

When you need to start the SDK from code (e.g. after async bootstrap, or to avoid auto-start), call `REMOTR.start()`. Every field is optional and mirrors a `data-*` attribute one-to-one:

```js
REMOTR.start({
  server: 'http://192.168.1.10:9777', // Server address; default: inferred from inject-script src, else current page origin
  room: 'my-app',                     // Room ID; default: 'default'
  mirror: true,                       // Enable rrweb page mirror; default: true
  deviceId: 'dev_custom',             // Override device ID; default: persistent localStorage id (fingerprint fallback)
  pageId: 'page_checkout',            // Override page ID; default: deterministic URL fingerprint + tab slot
  identity: 'alice',                  // Static identity; default: undefined
  identityCookie: 'username',         // Read identity from this cookie; default: undefined (ignored if `identity` set)
});
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `server` | `string` | inject-script origin → page origin | WebSocket/HTTP server base, e.g. `http://host:9777` |
| `room` | `string` | `'default'` | SDK and debug panel must share a room |
| `mirror` | `boolean` | `true` | `false` skips rrweb recording (no page mirror, lower bandwidth) |
| `deviceId` | `string` | auto (localStorage, fingerprint fallback) | Stable per browser; identifies one device |
| `pageId` | `string` | auto (URL fingerprint + tab slot) | Same URL reopened reuses the same session; concurrent tabs get `-2`, `-3`… |
| `identity` | `string` | `undefined` | Human label for grouping; wins over `identityCookie` |
| `identityCookie` | `string` | `undefined` | Cookie name to resolve identity from at start |

`REMOTR.start()` is idempotent — calling it twice is a no-op after the first start. The SDK also exports `REMOTR.SDK_VERSION`.

> **Note on `deviceId` across origins:** `deviceId` lives in `localStorage`, which is **per-origin**. The same physical machine visiting `https://a.example.com` and `https://b.example.com` will get **two different** `deviceId`s (and thus two Dashboard groups) — browsers isolate storage by origin, so the SDK cannot share it. To force one identity across origins, pass an explicit `deviceId` (or set `identity` / `data-identity-cookie`) so sessions group by person instead.

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

### Trying the example pages

The Remotr server does **not** serve the `examples/` directory (unknown paths fall back to the debug panel), so run the zero-dependency static server alongside it:

```bash
npm start           # Terminal 1 — Remotr server (panel + SDK + WS) on :9777
npm run examples    # Terminal 2 — static server for examples/ on :8899
# custom port: npm run examples -- --port 3000
```

Then open (note: no `/examples/` prefix — the static root **is** `examples/`):

- `http://localhost:8899/` — index listing all demos
- `http://localhost:8899/demo.html` — console/network/storage/DOM scenarios
- `http://localhost:8899/demo-react.html` — React app for Component inspection
- `http://localhost:8899/demo-vue.html` — Vue 3 app for Component inspection

Each demo injects the SDK from `localhost:9777`, so the server must run on port 9777.

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

The relay server exposes MCP over **Streamable HTTP** at `/mcp` — no local Node, repo clone, or build needed on the client. Add to your project's `.mcp.json` (or Claude Code MCP config):

```json
{
  "mcpServers": {
    "remotr": {
      "type": "http",
      "url": "http://localhost:9777/mcp"
    }
  }
}
```

Pick a room via query parameter: `http://localhost:9777/mcp?room=teamA` (defaults to `default`).

<details>
<summary>Alternative: stdio transport (local process)</summary>

If you prefer a local stdio process (e.g. offline against a local build), the CLI is still available:

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

</details>

### Tools exposed

| Tool | Purpose |
|------|---------|
| `remotr_list_sessions` | List live sessions (deviceId, pageId, url, framework, identity). Call first to find a target. |
| `remotr_get_errors` | Recent errors for a session (uncaught errors, unhandled rejections, console.error) with raw stacks. |
| `remotr_resolve_error` | Resolve one error's stack to original `file:line` + code snippet per frame via source maps. |
| `remotr_get_context` | Full diagnostic bundle: system info, the error, resolved frames + snippets, recent console timeline, failed network requests. |
| `remotr_diagnose` | One-shot triage: latest (or Nth) error + source-map-resolved top frame + snippet + recent console/network timeline + a heuristic suggested cause. |
| `remotr_run_eval` | Execute an arbitrary JS expression in the target page and return the serialized result (the AI's "act" primitive). |
| `remotr_set_tracepoint` | Place a no-pause tracepoint on a dotted function path (optional condition) — AI-driven breakpoint placement. |
| `remotr_get_tracepoint_hits` | Read recent tracepoint hits (args / return / thrown / stack / duration), capped and filterable by tracepoint id. |

All tool outputs are size-capped (~50KB, snippets trimmed, compact JSON) with a `truncated` marker so they never blow an agent's context. `run_eval` / `set_tracepoint` are intentional "act" primitives — Remotr is the only webpage debugger an AI agent can both **read and drive**.

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
