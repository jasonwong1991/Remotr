# Remotr

[English](./README.md) | 简体中文

> **远程调试变简单** — 注入一段脚本到任意网页，即可在浏览器中获得**实时页面镜像**和**类 Chrome DevTools 面板**。无需 USB、无需浏览器插件，跨设备工作。

非常适合 DevTools 无法访问的调试场景：移动端 H5 页面、微信 webview、智能电视/车载浏览器、客户现场排查等。

## 特性

- 🖥️ **页面镜像** — 基于 [rrweb](https://github.com/rrweb-io/rrweb) 实现实时录制和回放，忠实重建远程页面（样式、DOM 增量更新）
- 🎮 **控制台** — 拦截 `console.*` + 全局错误/Promise 拒绝；支持**远程执行任意 JS**（eval）
- 🌐 **网络** — 拦截 `fetch` / `XHR` / `sendBeacon`，显示 URL/状态/时序/请求头/响应体
- 🧬 **元素** — 从 rrweb 快照重建 DOM 树
- 💾 **存储** — 查看、编辑和删除 localStorage / sessionStorage / Cookies（双向）
- 🔌 **零配置注入** — 一个 `<script>` 标签，自动连接，支持指数退避重连
- 📦 **单文件 SDK** — 使用 esbuild 构建为单个 IIFE（gzip 后约 60KB，包含 rrweb），目标页面无需依赖

## 架构

```
 目标页面（注入 remotr.js）        调试面板（浏览器）
        │  收集：console/network         │  渲染：镜像 + 面板
        │           /storage/DOM(rrweb)    │
     └────────► WebSocket 中继 ◄─────────┘
                     (Node，房间路由 + 历史回放)
```

三个包通过 `@remotr/shared` 共享类型化协议：

| 包 | 描述 |
|----|------|
| `packages/shared` | 协议定义、消息信封、SpyAtom 序列化类型（单一数据源） |
| `packages/sdk` | 注入 SDK（TypeScript → esbuild IIFE 单文件） |
| `packages/server` | 中继服务器（Node + ws），托管面板和注入脚本 |
| `packages/debugger` | 调试面板（React + Vite + Zustand + rrweb Replayer） |

## 快速开始

### 1. 安装与构建

```bash
npm install
npm run build        # 构建 shared → sdk → debugger → server
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

或在代码中手动启动：

```js
REMOTR.start({ server: 'http://192.168.1.10:9777', room: 'my-app', mirror: true });
```

### 4. 打开调试面板

在浏览器中访问 `http://<your-IP>:9777/?room=default`，即可看到目标页面的实时镜像和调试数据。

## 开发

```bash
npm run dev:debugger   # 面板热重载（Vite dev server，/ws 和 /api 代理到 :9777）
npm run build:sdk      # 仅重新构建 SDK
npm test -w @remotr/server   # WebSocket 中继冒烟测试
```

`examples/demo.html` 是内置测试页面，涵盖各种数据采集场景。

## 工作原理

1. **采集**：SDK 插件遵循单一职责原则拦截浏览器 API（console/fetch/XHR/storage）；rrweb 记录全量 + 增量 DOM 快照
2. **传输**：所有消息通过 WebSocket 使用统一 `Envelope` 格式；命令（如 eval）携带 `id`，回复通过 `replyTo` 匹配
3. **中继**：服务器按 `room` 路由 SDK ↔ 面板；维护历史记录（在 rrweb Meta 事件处修剪），使后加入的面板可以重建当前状态
4. **重建**：面板使用 rrweb `Replayer` 的实时模式回放事件流；其他面板从相应事件渲染

## 安全提示

Remotr 会采集页面数据并支持远程执行 JS。**仅在开发/调试环境中使用。** 请勿在生产页面永久注入，以避免敏感数据泄漏和 XSS 风险。

## 许可证

MIT
