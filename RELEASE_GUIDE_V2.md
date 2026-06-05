# 🚀 Remotr v1.0.0 - 多设备会话管理版本

## 📦 项目简介

**Remotr** 是一个轻量级的远程调试工具，支持多设备、多页面、多身份的会话隔离。

### 核心特性

- ✅ **多设备支持**：自动识别不同设备，localStorage 持久化
- ✅ **多页面隔离**：同设备多标签页独立追踪，sessionStorage 隔离
- ✅ **身份识别**：支持按 Cookie 读取用户身份（如 username），分组展示
- ✅ **实时镜像**：基于 rrweb 的页面录制与回放
- ✅ **全面采集**：Console、Network、Storage、DOM、Error 全覆盖
- ✅ **命令执行**：远程 eval、页面重载、样式修改

---

## 🙏 致敬 rrweb

Remotr 的页面镜像功能基于 **[rrweb](https://github.com/rrweb-io/rrweb)** 实现。

> **rrweb** (record and replay the web) 是一个开创性的前端录制回放引擎，通过增量快照技术高效记录 DOM 变更、用户交互、网络请求等，使得"时光倒流"式的调试成为可能。

**核心创新：**
- 增量快照算法（虚拟 DOM diff）
- 完整的鼠标轨迹与滚动录制
- 样式变更精准捕获
- Canvas/WebGL 特殊处理

**相关资源：**
- GitHub: https://github.com/rrweb-io/rrweb
- 官网: https://www.rrweb.io/

**Remotr 的贡献：**
在 rrweb 的基础上，Remotr 添加了：
1. 多设备、多页面的会话隔离机制
2. WebSocket 实时传输与断线重连
3. Per-session backlog 管理
4. 身份标识与分组展示

---

## 📝 使用示例

### 基础用法（自动按设备和页面区分）

\`\`\`html
<script src="http://localhost:9777/remotr.js" data-room="default"></script>
\`\`\`

### 按用户身份分组

\`\`\`html
<script 
  src="http://localhost:9777/remotr.js" 
  data-room="default"
  data-identity-cookie="username"
></script>
\`\`\`

### 手动指定设备 ID

\`\`\`html
<script 
  src="http://localhost:9777/remotr.js" 
  data-room="default"
  data-device-id="test-device-1"
></script>
\`\`\`

---

## 🏗️ 多设备架构

\`\`\`
Room: default
├─ Identity: alice (从 cookie 读取)
│   ├─ Device: dev_abc123 (localStorage)
│   │   ├─ Page: page_xyz789 (标签页1, sessionStorage)
│   │   └─ Page: page_def456 (标签页2, sessionStorage)
│   └─ Device: dev_mobile1
│       └─ Page: page_mno345
└─ Identity: anonymous
    └─ Device: dev_guest1
        └─ Page: page_pqr678
\`\`\`

**Session 隔离：**
- 每个 session = deviceId + pageId
- Server 维护 per-session backlog
- Debugger 只接收目标 session 的消息
- 命令精确定向到特定 session

---

## 🚦 Phase 1-3 完成状态

### ✅ Phase 1: 协议扩展

- [x] `SessionId`（deviceId + pageId）
- [x] `SessionMetadata`（session + identity + device + page）
- [x] `Envelope.metadata` 和 `Envelope.target`

### ✅ Phase 2: SDK Session 支持

- [x] deviceId 持久化（localStorage）
- [x] pageId 持久化（sessionStorage）
- [x] 从 cookie 读取 identity
- [x] WebSocket URL 携带 session 参数
- [x] 所有消息自动附加 metadata

### ✅ Phase 3: Server 路由

- [x] Per-session backlog
- [x] 精确路由（SDK → 对应 Debugger）
- [x] 命令定向（Debugger → 目标 SDK）

### ⏳ Phase 4: Dashboard UI（待实施）

- [ ] 显示所有设备/页面/身份
- [ ] 按 Identity → Device → Page 分组
- [ ] 点击进入具体页面调试

---

## 📤 发布步骤

### 1. 提交代码

\`\`\`bash
git add .
git commit -m "feat: multi-device session management - Phase 1-3 complete

- Support device ID (localStorage) and page ID (sessionStorage)
- Support identity from cookie
- Per-session backlog and routing
- Based on rrweb for page mirroring

Special thanks to rrweb project!"
\`\`\`

### 2. 推送到 GitHub

\`\`\`bash
git push origin main
\`\`\`

### 3. 创建测试页面

已创建 \`test-multi-device.html\`，可以：
- 打开多个标签页测试 pageId 隔离
- 设置 cookie 测试身份分组
- 查看 Console/Network/Storage 采集

---

## 🔮 后续计划

1. **Dashboard UI**：可视化展示所有 session
2. **Session 持久化**：离线 session 保留时长
3. **权限管理**：Room 访问控制
4. **性能优化**：Backlog 内存限制

---

**Built with ❤️ and inspired by rrweb**
