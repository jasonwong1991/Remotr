# Remotr

[English](./README.md) | 简体中文

> **远程调试变简单** — 注入一段脚本到任意网页，即可在浏览器中获得**实时页面镜像**和**类 Chrome DevTools 面板**。无需 USB、无需浏览器插件，跨设备工作。

非常适合 DevTools 无法访问的调试场景：移动端 H5 页面、微信 webview、智能电视/车载浏览器、客户现场排查等。

## 特性

- 🖥️ **页面镜像** — 基于 [rrweb](https://github.com/rrweb-io/rrweb) 实现实时录制和回放，忠实重建远程页面（样式、DOM 增量更新）
- 🎮 **控制台** — 拦截 `console.*` + 全局错误/Promise 拒绝；支持**远程执行任意 JS**（eval）
- 🌐 **网络** — 拦截 `fetch` / `XHR` / `sendBeacon`，显示 URL/状态/时序/请求头/响应体
- 🧬 **元素** — 从 rrweb 镜像实时重建 DOM 树（隐藏/删除/编辑即时反映）；DevTools 风格右键菜单：复制 selector/XPath/JS-path/outerHTML，强制伪类（`:hover`/`:focus`/…），隐藏/编辑 HTML/删除，滚动到视图；查看并编辑匹配规则、计算样式、盒模型；元素拾取器
- 💾 **存储** — 查看、编辑和删除 localStorage / sessionStorage / Cookies（双向）
- 🗺️ **源码与 Source Map** — 浏览页面加载的脚本；由同源的 SDK 代取脚本与 `.map` 文件（绕开面板跨域），把压缩堆栈还原为原始 `src/Foo.tsx:42` 并附带源码片段。控制台报错带「还原源码」按钮，一键跳转到原始代码行。
- 🤖 **AI 辅助修复（MCP）** — 内置 MCP 服务器把实时报错、Source Map 还原后的堆栈、console/network 上下文暴露给 **Claude Code**。会话视图里一个「复制给 AI 修复」按钮，把 Claude 定位并修复所需的一切交给它，直接改你真实仓库的源码。优雅降级：没有 Source Map 也能用（还原为压缩位置 + 完整上下文）。
- 🔌 **零配置注入** — 一个 `<script>` 标签，自动连接，支持指数退避重连
- 📦 **单文件 SDK** — 使用 esbuild 构建为单个 IIFE（gzip 后约 60KB，包含 rrweb），目标页面无需依赖
- 🔀 **多设备/多页面** — 每个设备和浏览器标签页都单独跟踪，使用持久化的设备 ID（localStorage）和临时的页面 ID（sessionStorage）。非常适合调试多用户或跨设备测试。
- 👥 **身份分组** — 使用 `data-identity-cookie` 按用户分组会话（如 alice、bob）。仪表盘自动按身份或设备分组，便于导航。
- 📊 **仪表盘界面** — 在 `/#/dashboard` 查看所有连接会话的可视化概览。查看实时状态，点击任何会话进行调试。
- 🌍 **国际化** — 内置中英文切换（默认英文）
- 🎨 **主题** — 深色/浅色模式切换

## 架构

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Remotr 多设备会话架构                                                          │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐
│        浏览器实例                   │
│  (多个设备 / 页面)                  │
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 设备 A / 页面 1               │  │
│  │ <script src="remotr.js"       │  │
│  │   data-room="default">        │  │
│  │ ┌─────────────────────────┐   │  │
│  │ │ SDK                     │   │  │
│  │ │ • deviceId: dev_abc123  │   │  │
│  │ │ • pageId: page_xyz789   │   │  │
│  │ │ • identity: (cookie)    │   │  │
│  │ │ • 插件:                 │   │  │
│  │ │   - Console             │   │  │
│  │ │   - Network             │   │  │
│  │ │   - Storage             │   │  │
│  │ │   - Sources             │   │  │
│  │ │   - DOM (rrweb)         │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
│  ┌───────────────┴───────────────┐  │
│  │ 设备 B / 页面 2               │  │
│  │ ┌─────────────────────────┐   │  │
│  │ │ SDK                     │   │  │
│  │ │ • deviceId: dev_def456  │   │  │
│  │ │ • pageId: page_uvw456   │   │  │
│  │ └─────────────────────────┘   │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
└──────────────────┼──────────────────┘
                   │
                   │ 带会话元数据的事件
                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  WebSocket 服务器（房间）                                                       │
│  ws://host:port/ws?room=X                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  SDK:       ?role=sdk&deviceId=X&pageId=Y&identity=Z                            │
│  调试器:    ?role=debugger&deviceId=X&pageId=Y  (会话模式)                      │
│  仪表盘:    ?role=debugger  (仪表盘模式)                                        │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  每会话历史存储                                                          │   │
│  │  dev_abc123:page_xyz789 → [rrweb + 事件]                                 │   │
│  │  dev_def456:page_uvw456 → [rrweb + 事件]                                 │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  路由: SDK → 订阅的调试器 | 调试器 → 目标 SDK                                   │
└────────────────────────────────────┬────────────────────────────────────────────┘
                   ┌─────────────────┴─────────────────┐
                   │                                   │
                   ▼                                   ▼
    ┌───────────────────────────┐       ┌───────────────────────────┐
    │  仪表盘调试器             │       │  会话调试器               │
    │  /#/dashboard             │       │  /#/session?deviceId=X&   │
    │  (浏览器)                 │       │         pageId=Y          │
    ├───────────────────────────┤       ├───────────────────────────┤
    │  显示所有会话:            │       │  调试特定会话:            │
    │  • 按身份分组             │       │  • 页面镜像 (rrweb)       │
    │  • 按设备分组             │       │  • 控制台面板             │
    │  • 点击进入调试           │       │  • 网络面板               │
    └───────────────────────────┘       │  • 源码面板               │
                                        │  • 元素面板               │
                                        │  • 存储面板               │
                                        └───────────────────────────┘
```

六个包通过 `@remotr/shared` 共享类型化协议：

| 包                  | 描述 |
|---------------------|------|
| `packages/shared`   | 协议定义、消息信封、SpyAtom 序列化类型（单一数据源） |
| `packages/sdk`      | 注入 SDK（TypeScript → esbuild IIFE 单文件） |
| `packages/server`   | 中继服务器（Node + ws），托管面板和注入脚本 |
| `packages/debugger` | 调试面板（React + Vite + Zustand + rrweb Replayer） |
| `packages/sourcemap`| 纯 Source Map 还原器（source-map-js）；把压缩的 `bundle:line:col` 还原为原始源码 + 片段。面板与 MCP 共用。 |
| `packages/mcp`      | MCP 服务器（stdio），把实时报错 + 还原堆栈 + 上下文暴露给 Claude Code |

### AI 辅助报错修复

Remotr 可以把运行时报错——还原回你的原始源码——通过 MCP 交给 **Claude Code**，让 AI 直接修复你仓库里的真实文件。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  AI 辅助报错修复（Source Map + MCP）                                            │
└─────────────────────────────────────────────────────────────────────────────────┘

   页面抛错  ──►  page.error { message, stack }              （SDK，同源捕获）
                              │
                              ▼
        sources.fetch ◄── 调试端 / MCP 解析堆栈（url:line:col）
              │
              ▼  SDK 同源 fetch 脚本 + .map（绕开面板跨域）
        @remotr/sourcemap  ──►  还原 src/Foo.tsx:42:10  +  源码片段
              │
   ┌──────────┴───────────────────────────────┐
   ▼                                           ▼
 Sources 面板 + Console「还原源码」       @remotr/mcp（stdio MCP 服务）
 点击 → 跳转到原始源码                     工具: list_sessions / get_errors /
                                                resolve_error / get_context
                                               │
                                               ▼
                                        Claude Code 修复真实仓库源码
```

详见下方 **[AI 辅助报错修复（MCP）](#ai-辅助报错修复mcp)** 的配置说明。

## 快速开始

### 1. 安装与构建

```bash
npm install
npm run build        # 构建 shared → sourcemap → sdk → debugger → server → mcp
```

### 2. 启动服务器

```bash
npm start   # 默认监听 0.0.0.0:9777
# 或自定义端口/主机
node packages/server/dist/cli.js --port 9777 --host 0.0.0.0
```

启动后输出：

```
  Remotr server running
  ├─ Debug panel:    http://0.0.0.0:9777/
  ├─ Inject script:  http://0.0.0.0:9777/remotr.js
  └─ WebSocket:      ws://0.0.0.0:9777/ws
```

### 3. 注入目标页面

在需要调试的页面 `</body>` 之前添加（跨设备访问时请将 host 替换为你的服务器 IP）：

```html
<script src="http://<your-IP>:9777/remotr.js" data-room="default"></script>
```

`data-*` 配置选项：

| 属性 | 描述 | 默认值 |
|------|------|--------|
| `data-room` | 房间 ID（SDK 和面板在同一房间内通信） | `default` |
| `data-server` | 服务器地址（默认从 script src 自动推断） | 脚本来源 |
| `data-mirror` | 启用页面镜像（设为 `false` 可禁用以节省带宽） | `true` |
| `data-device-id` | 手动设置设备 ID（覆盖自动生成） | 自动（localStorage 持久化） |
| `data-identity-cookie` | 读取身份信息的 Cookie 名称（用于仪表盘分组） | - |

**身份分组示例：**
```html
<!-- 页面设置: document.cookie = "username=alice" -->
<script 
  src="http://<your-IP>:9777/remotr.js" 
  data-room="default"
  data-identity-cookie="username"
></script>
```

或在代码中手动启动：

```js
REMOTR.start({ server: 'http://192.168.1.10:9777', room: 'my-app', mirror: true });
```

### 4. 打开调试面板

**仪表盘**（查看所有会话）：
```
http://<your-IP>:9777/
或
http://<your-IP>:9777/#/dashboard?room=default
```

功能：
- 实时查看所有连接的设备/页面
- 在"按身份分组"和"按设备分组"之间切换
- 点击任何会话卡片进入调试模式
- 显示浏览器、视口、URL、框架、在线状态、最后活动时间

**会话调试**（调试特定页面）：
```
http://<your-IP>:9777/#/session?room=default&deviceId=xxx&pageId=yyy
```

在会话视图中点击"← 仪表盘"按钮返回。

## Docker 部署

偏好容器化？项目内置多阶段 `Dockerfile` 和 `docker-compose.yml`，无需本地 Node 工具链。

```bash
docker compose up -d        # 构建镜像并启动（端口 9777）
docker compose logs -f      # 查看日志
docker compose down         # 停止并移除
```

启动后，面板和注入脚本的访问方式与[快速开始](#快速开始)一致：

- 调试面板:   `http://localhost:9777/`
- 注入脚本: `http://localhost:9777/remotr.js`

跨设备访问时将 `localhost` 替换为服务器 IP。生产部署（反向代理、HTTPS、资源限制、故障排查）详见 **[DOCKER.md](./DOCKER.md)**。

## 多会话工作流

1. **注入多个页面**：在不同设备/浏览器/标签页中添加 SDK 脚本
2. **设置身份**（可选）：使用 `data-identity-cookie="username"` 按用户分组
3. **打开仪表盘**：访问 `http://<your-IP>:9777/` 查看所有会话
4. **调试会话**：点击任何会话卡片进入该页面的完整调试模式
5. **切换会话**：使用"← 仪表盘"按钮返回并选择其他会话

**示例：使用多个测试账号进行 QA 测试**

```html
<!-- alice 的会话 -->
<script 
  src="http://localhost:9777/remotr.js" 
  data-room="qa"
  data-identity-cookie="username"
></script>
```

仪表盘将显示：
```
👤 alice
  💻 MacBook Pro (dev_abc123)
    📄 首页 (在线，2 秒前)
    📄 个人资料页 (在线，5 秒前)

👤 bob  
  💻 iPhone 14 (dev_def456)
    📄 首页 (在线，1 秒前)
```

## 开发

```bash
npm run dev:debugger   # 面板热重载（Vite dev server，/ws 和 /api 代理到 :9777）
npm run build:sdk      # 仅重新构建 SDK
npm test -w @remotr/server      # WebSocket 中继冒烟测试
npm test -w @remotr/sourcemap   # Source Map 还原器单元测试
node packages/mcp/test/integration.mjs   # MCP 端到端测试（server + 假 SDK + 还原）
```

`examples/demo.html` 是内置测试页面，涵盖各种数据采集场景。

## 工作原理

1. **采集**：SDK 插件遵循单一职责原则拦截浏览器 API（console/fetch/XHR/storage）；rrweb 记录全量 + 增量 DOM 快照
2. **传输**：所有消息通过 WebSocket 使用统一 `Envelope` 格式；命令（如 eval）携带 `id`，回复通过 `replyTo` 匹配
3. **中继**：服务器按 `room` 路由 SDK ↔ 面板；维护历史记录（在 rrweb Meta 事件处修剪），使后加入的面板可以重建当前状态
4. **重建**：面板使用 rrweb `Replayer` 的实时模式回放事件流；其他面板从相应事件渲染
5. **多会话路由**：SDK 在连接参数中发送 `deviceId`、`pageId`、`identity`。服务器维护每会话历史记录，并根据会话 ID 路由消息。仪表盘接收所有会话的更新；会话调试器仅接收来自目标会话的消息。
6. **Source Map 与 AI 修复**：按需地，面板/MCP 发出 `sources.fetch` 命令；SDK 同源 fetch 脚本及其 `.map`（绕开面板的跨域限制）并返回。`@remotr/sourcemap` 把压缩堆栈帧还原为原始 `file:line:col` + 源码片段。MCP 服务器再把这些与 console/network 上下文打包，交给 Claude Code 修复真实源码。

## AI 辅助报错修复（MCP）

Remotr 内置一个 MCP 服务器（`@remotr/mcp`），让 **Claude Code** 读取某个会话的实时运行时报错、通过 Source Map 把堆栈还原回原始源码，并汇集 console/network 上下文——然后在你的真实仓库里修复该报错。

### 配置

在项目的 `.mcp.json`（或 Claude Code 的 MCP 配置）中加入：

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

`--server` 是 Remotr 服务器地址，`--room` 是要检查的房间（也可用环境变量 `REMOTR_SERVER` / `REMOTR_ROOM`）。

### 暴露的工具

| 工具 | 用途 |
|------|------|
| `remotr_list_sessions` | 列出在线会话（deviceId、pageId、url、框架、identity）。先调用它找到目标。 |
| `remotr_get_errors` | 某会话的近期报错（未捕获错误、未处理 Promise 拒绝、console.error），带原始堆栈。 |
| `remotr_resolve_error` | 通过 Source Map 把某条报错的堆栈逐帧还原为原始 `file:line` + 源码片段。 |
| `remotr_get_context` | 完整诊断包：系统信息、报错、还原后的栈帧 + 片段、近期 console 时间线、失败的网络请求。 |

一个会话由 **(deviceId, pageId) 组合**唯一标识——`pageId` 由 URL 确定性派生，`deviceId` 区分不同浏览器/设备。

### 最快路径：「复制给 AI 修复」

在会话视图工具栏点击 **🤖 复制给 AI 修复**，它会把一段可直接粘贴的提示词——server/room/deviceId/pageId/url 加上操作说明——复制到剪贴板。粘贴给 Claude Code，它就会激活 MCP、拉取还原后的报错与上下文，并针对你的仓库给出修复。剪贴板内容还附带 `.mcp.json` 片段，以备尚未配置 MCP 时使用。

### 没有 Source Map 时

如果某脚本没有 Source Map（或是 `hidden-source-map` / 跨域 / 被 CORS 拦截），还原会**优雅降级**：工具仍返回错误消息、压缩位置、console 时间线、失败请求和页面上下文。Claude 通常仍能凭消息 + 符号 + 上下文定位修复——只是不如有 map 时精确。要获得精确映射，请将 `.map` 文件同源部署且保留 `//# sourceMappingURL=` 注释（dev/staging 构建一般已满足）。

## 安全提示

Remotr 会采集页面数据并支持远程执行 JS。**仅在开发/调试环境中使用。** 请勿在生产页面永久注入，以避免敏感数据泄漏和 XSS 风险。

## 参与贡献

欢迎贡献！提交 issue 或 PR 前请阅读我们的[贡献指南](./CONTRIBUTING.md)。

- 🐛 [报告 bug](https://github.com/jasonwong1991/Remotr/issues/new?template=bug_report_zh.md)
- 💡 [请求功能](https://github.com/jasonwong1991/Remotr/issues/new?template=feature_request_zh.md)
- 🔧 [提交 pull request](https://github.com/jasonwong1991/Remotr/compare)

## 许可证

MIT
