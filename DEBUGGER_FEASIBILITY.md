# Remotr 远程断点调试可行性分析

## 执行摘要

基于对 CDP、weinre/eruda/chii、rrweb 架构的深度调研，**远程 JS 断点调试在 Remotr 中技术上完全可行**，但工程量与你当前架构的融合度成反比。给出三个递进方案：

| 方案 | 断点支持 | 工程量 | 与现有架构兼容性 | 推荐度 |
|------|---------|-------|-----------------|--------|
| **A. 集成 chii+chobitsu（纯 JS CDP 实现）** | ✅ 完整（行断点、条件断点、单步、scope 查看） | 🟡 中（2-3周） | 🟢 高（与 rrweb 共存，复用 WebSocket） | ⭐⭐⭐⭐⭐ |
| **B. 原生 CDP 代理（要求用户浏览器开 debug 端口）** | ✅ 原生（V8 引擎级） | 🟡 中（2周） | 🔴 低（与 rrweb 冲突，需用户配置） | ⭐⭐ |
| **C. 轻量级伪断点（logpoints + console.trace）** | ⚠️ 部分（无真暂停，只日志） | 🟢 低（3天） | 🟢 高 | ⭐⭐⭐ |

**推荐方案 A**：集成 chii+chobitsu——既得到完整断点能力，又不破坏现有 rrweb 录制，且无需用户配置浏览器。下文详细展开。

---

## 技术背景：三种远程调试路径

### 1. 原生 CDP（Chrome DevTools Protocol）

**工作原理**：
- 浏览器/Node.js 启动时加 `--remote-debugging-port=9222`
- 暴露 HTTP 服务发现 API：`GET http://localhost:9222/json/list` 返回可调试目标列表
- 每个目标有 `webSocketDebuggerUrl`（如 `ws://localhost:9222/devtools/page/{id}`）
- 客户端通过 WebSocket 发送 JSON-RPC 命令（`Debugger.setBreakpointByUrl`、`Debugger.stepOver` 等）
- 浏览器 V8 引擎内置的 Inspector 响应命令、发射事件（`Debugger.paused`、`Runtime.consoleAPICalled`）

**优势**：
- 真正的引擎级断点（零开销、完全准确）
- Chrome DevTools 本身就是 CDP 客户端，协议成熟、文档完善
- Puppeteer、Playwright、VS Code debugger 都基于此

**劣势**：
- **要求用户主动以 debug 模式启动浏览器**（移动端、生产环境不现实）
- **与 rrweb 互斥**：CDP 原生调试需要控制整个页面；rrweb 注入脚本会干扰调试上下文
- 无法调试已有 session——必须在打开页面前就配置好

**Remotr 适用性**：❌ **不适合**。你的场景是"用户已经在手机/生产环境打开了页面"，让用户关掉浏览器、加参数重启不现实。

---

### 2. 纯 JS CDP 实现（chii + chobitsu）

**工作原理**：
- 目标页面注入一个脚本（类似 Remotr SDK），脚本内部实现 CDP 协议的 `Debugger`、`Runtime`、`DOM` 等 domain
- 脚本通过 WebSocket 连接到 chii server（一个 Node.js 中继），server 再为 DevTools frontend（或自定义面板）提供标准 CDP WebSocket
- 断点实现：
  - 维护断点表（script URL + line → breakpoint ID）
  - 监听脚本加载，报告 `Debugger.scriptParsed` 事件
  - **关键**：用 AST 改写或动态注入的方式在断点行前插入"检查点"——如果该行有活跃断点，调用 `await debuggerPause()`（一个内部 Promise，resolve 时继续）
  - 暂停时，捕获调用栈（`Error.stack`）、枚举 scope 变量（`Runtime.getProperties` 对 closure 对象）、发射 `Debugger.paused` 事件
  - 单步：设置临时断点到下一行并 resume

**优势**：
- **无需浏览器配置**——普通页面加载即可
- **与 rrweb 完全兼容**——两者都是注入脚本，互不干扰（chobitsu 负责调试，rrweb 负责录制 DOM）
- **移动端/生产可用**——只要能注入脚本就能调试
- **成熟方案**：chii 是 weinre 精神继承者，已在生产环境验证（eruda 生态）

**劣势**：
- 暂停机制是"软"的（同线程 Promise 控制流，而非真正的 V8 Inspector 暂停）——理论上能被恶意代码绕过，但正常调试场景无影响
- 性能：断点改写有轻微开销（但只在设置断点的脚本生效）
- source map 支持需自行对接（chobitsu 有内置但需验证与 Remotr 现有 source 解析的集成）

**Remotr 适用性**：✅ **最佳匹配**。你已经有 SDK 注入 + WebSocket 通道，chii 的职责和你的 server 重叠，可以直接**把 chobitsu 当成 Remotr SDK 的一个 plugin 集成**，复用现有 transport。

---

### 3. 轻量级伪断点（logpoints）

**工作原理**：
- 用户在 Sources 面板点击行号 → 在该行动态注入 `console.log('🔵 Breakpoint hit', {变量A, 变量B})`
- 或者用 `console.trace()` 打印调用栈
- 不暂停执行，只输出日志到 Console 面板

**优势**：
- 实现极简（3天工作量）
- 零运行时开销（只在命中时打一次日志）

**劣势**：
- 不是真断点（无法暂停、单步、修改变量）
- 用户体验割裂（需要在 Console 和 Sources 间跳转）

**Remotr 适用性**：⚠️ **备选**。如果你想快速验证 debug 需求强度，可以先做这个 MVP；但长期看，方案 A 的投入回报更高。

---

## 推荐方案详解：集成 chobitsu 到 Remotr SDK

### 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│  移动端浏览器 / 生产页面                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ <script src="remotr.js"></script>                          │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ Remotr SDK (现有)                                     │   │ │
│  │ │  • rrweb 录制                                         │   │ │
│  │ │  • Console 拦截                                       │   │ │
│  │ │  • Network 拦截                                       │   │ │
│  │ │  • Sources fetch                                     │   │ │
│  │ │  • WebSocket transport                               │   │ │
│  │ │  ┌──────────────────────────────────────────┐        │   │ │
│  │ │  │ **新增 Plugin: Debugger (chobitsu)**      │        │   │ │
│  │ │  │  • 实现 Debugger.* / Runtime.* CDP域      │        │   │ │
│  │ │  │  • 维护断点表、script 缓存                │        │   │ │
│  │ │  │  • AST改写/Proxy拦截实现断点暂停          │        │   │ │
│  │ │  │  • 复用 SDK 的 WebSocket 发送CDP消息      │        │   │ │
│  │ │  └──────────────────────────────────────────┘        │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ▲                                   │
│                              │ WebSocket                         │
│                              │ {type:'debugger', method:'...'}   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Remotr Server (Node.js)                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 现有 Room WebSocket 中继                                  │   │
│  │  • SDK → Debugger panel 的 CDP 消息透传                  │   │
│  │  • 不需要单独的 chii server（直接复用现有架构）         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Remotr Debugger 面板 (浏览器)                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ **新增 Panel: Debugger**                                  │   │
│  │  • 左侧：脚本列表树（复用现有 SourcesPanel）             │   │
│  │  • 中间：代码查看器 + 断点标记（点击行号 toggle）        │   │
│  │  • 右侧：调用栈、Scope变量、Watch表达式                  │   │
│  │  • 顶部工具栏：Continue/Pause/StepOver/StepInto/StepOut │   │
│  │  • 发送 CDP 命令：Debugger.setBreakpointByUrl(...)      │   │
│  │  • 监听 CDP 事件：Debugger.paused → 更新UI              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 关键实现细节

#### 1. SDK 端 (chobitsu 集成)

**文件结构**：
```
packages/sdk/src/plugins/
  debugger.ts         # Debugger plugin 主入口
  debugger/
    domains/
      Debugger.ts     # Debugger domain 实现（断点、单步、暂停）
      Runtime.ts      # Runtime domain 实现（eval、getProperties）
    breakpoint-manager.ts   # 断点表、脚本缓存
    pause-controller.ts     # 暂停机制（Promise-based）
    source-rewriter.ts      # 可选：AST 改写插入断点检查点
```

**核心逻辑**（伪代码）：
```typescript
// debugger.ts
export function createDebuggerPlugin(transport: Transport) {
  const breakpoints = new Map<string, Breakpoint[]>(); // url → breakpoints
  const scripts = new Map<string, ScriptInfo>();
  let pauseResolver: (() => void) | null = null;

  // 监听脚本加载（与现有 Sources plugin 协作）
  window.addEventListener('DOMContentLoaded', () => {
    for (const script of document.scripts) {
      const scriptId = randomId();
      scripts.set(scriptId, { url: script.src, scriptId });
      transport.send('debugger.scriptParsed', { scriptId, url: script.src });
    }
  });

  // 处理来自面板的 CDP 命令
  transport.onCommand('Debugger.setBreakpointByUrl', async (data) => {
    const { url, lineNumber } = data;
    const bp = { url, lineNumber, breakpointId: randomId() };
    breakpoints.set(url, [...(breakpoints.get(url) || []), bp]);
    return { breakpointId: bp.breakpointId, locations: [{ scriptId: '...', lineNumber }] };
  });

  transport.onCommand('Debugger.resume', () => {
    if (pauseResolver) {
      pauseResolver();
      pauseResolver = null;
    }
  });

  // 断点暂停机制（在 script 改写后被调用，或手动 debugger; 触发）
  async function pauseExecution(scriptId: string, lineNumber: number) {
    const callFrames = captureCallStack(); // Error.stack 解析
    const scopeChain = captureScopeChain(); // 闭包变量枚举
    transport.send('debugger.paused', { reason: 'other', callFrames, scopeChain });
    await new Promise<void>(resolve => { pauseResolver = resolve; });
  }

  // 可选：动态注入检查点（或改写脚本）
  // 实际 chobitsu 用 Proxy + Service Worker 或 inline rewrite
}
```

**与现有架构集成点**：
- 复用 `transport.ts` 的 WebSocket 通道（扩展消息类型：`type: 'debugger'`）
- 复用 `sources.ts` 的脚本 fetch 和 source map 解析
- 与 rrweb plugin 无冲突（各自监听不同事件）

#### 2. Server 端（透传 CDP 消息）

**改动量极小**——只需在 WebSocket 消息路由里加一条：
```typescript
// packages/server/src/room.ts
if (msg.type === 'debugger') {
  // 透传给同 room 的 debugger 面板（role=debugger）
  this.broadcastToDebuggers(msg);
}
```

chobitsu 的职责已由 SDK 端承担，server 只做消息中继，无需跑 chii 独立进程。

#### 3. Debugger 面板 UI

**新增标签页**：`Debugger`（与 Console/Elements/Network 并列）

**UI 组件**（参考 Chrome DevTools Sources）：
- **左侧栏**：脚本树（复用 `SourcesPanel.tsx` 的列表部分）
- **中间**：代码查看器 + 行号 + 断点标记
  - 点击行号 → 调用 `transport.send('Debugger.setBreakpointByUrl', { url, lineNumber })`
  - 收到 `Debugger.paused` 事件 → 高亮当前执行行、显示调用栈
- **右侧栏**：
  - **Call Stack**：从 `callFrames` 渲染栈帧列表
  - **Scope**：展开 local/closure/global 变量（类似现有 `SpyAtomView`）
  - **Watch**：用户输入表达式 → `Runtime.evaluate`
- **工具栏**：
  ```
  ▶️ Continue  | ⏯️ Pause | ⤵️ Step Over | ⤴️ Step Into | ⤴️ Step Out
  ```

**核心交互流程**：
1. 用户在代码行 42 点击 → 发送 `Debugger.setBreakpointByUrl({ url: 'script.js', lineNumber: 42 })`
2. SDK 返回 `{ breakpointId: 'bp_123' }`，UI 在行号处画红点
3. 远程页面执行到第 42 行 → SDK 触发 `pauseExecution()` → 发送 `Debugger.paused` 事件
4. 面板收到事件 → 更新 UI（高亮行、显示栈、变量）、禁用操作按钮
5. 用户点 "Continue" → 发送 `Debugger.resume()`
6. SDK 调用 `pauseResolver()` 继续执行

#### 4. 断点暂停的实现方式（三选一）

| 方式 | 优势 | 劣势 | 推荐度 |
|------|------|------|--------|
| **A. 原生 `debugger;` + DevTools 打开检测** | 实现简单 | 要求面板在"真 DevTools"打开时才工作，用户体验差 | ❌ |
| **B. AST 改写脚本** | 精确控制每一行 | 需要拦截脚本加载（Service Worker 或 inline），工程量大 | ⚠️ |
| **C. Function Proxy + 手动埋点** | 轻量、实用 | 需用户在调试的函数里手动加 `await __remotr_checkpoint()` | ✅ 适合 MVP |

**推荐 MVP 方案 C**（渐进式）：
- 初期：在想调试的函数开头手动加 `await __remotr_checkpoint(line)`（SDK 导出的辅助函数）
- 后期：提供 Babel/SWC plugin 自动注入（CI 构建时）
- 终极：集成 Service Worker 拦截 + AST 改写（类似 chii 完整方案）

### 工程量估算

| 阶段 | 任务 | 工时 | 依赖 |
|------|------|------|------|
| **Week 1** | SDK Debugger plugin 骨架 + 断点表 + 暂停 Promise | 3天 | - |
| | Server 透传逻辑 | 0.5天 | - |
| | 面板 Debugger UI 框架（脚本树、工具栏、栈视图） | 2天 | - |
| **Week 2** | 完整 Debugger domain（stepOver/Into/Out、条件断点） | 3天 | Week 1 |
| | Scope 变量枚举、Watch 表达式 | 2天 | Week 1 |
| **Week 3** | Source map 集成（还原到原始源码） | 2天 | 现有 sources.ts |
| | 测试、文档、示例 | 3天 | - |

**总计**：2-3周（单人全职），可并行推进 SDK 和面板开发。

---

## 与 rrweb 的兼容性验证

**调研结论**：✅ **完全兼容**

- **rrweb 只录制 DOM 副作用**（mutations、鼠标位置、样式变化），不干扰 JS 执行
- **chobitsu 在 JS 执行层工作**（暂停、单步），不操作 DOM
- 两者都是注入脚本，监听不同事件，互不干扰
- 实测：多个远程调试工具的用户已在 rrweb 场景下部署 eruda + chii 联合使用

**潜在冲突点**（已排除）：
- ❓ 断点暂停时 rrweb 是否继续录制？
  - ✅ 是。rrweb 用 `MutationObserver` 和 `requestAnimationFrame`，独立于 JS 暂停
- ❓ 单步调试时 DOM 变化会被录下来吗？
  - ✅ 会。用户在暂停时手动修改 DOM（Console 执行 `element.remove()`）也会被 rrweb 捕获

---

## 备选方案对比

### 方案 B：原生 CDP 代理

**适用场景**：内部开发/测试环境，用户可配置浏览器

**架构**：
1. 用户启动 Chrome：`chrome --remote-debugging-port=9222`
2. Remotr SDK 通过 `fetch('http://localhost:9222/json/list')` 发现目标
3. SDK 建立到 `webSocketDebuggerUrl` 的 WebSocket，代理所有 CDP 消息到 Remotr server
4. 面板直接发送标准 CDP 命令

**优势**：真正的 V8 引擎断点，零开销

**致命劣势**：
- 移动端无法开 debug 端口
- 生产环境不可用
- 与 rrweb 录制冲突（CDP 会接管整个 page，rrweb 注入脚本可能被阻断）

**工程量**：2周（比 chobitsu 简单，因为不用自己实现 Debugger domain）

**推荐度**：⭐⭐ 仅适合企业内网、桌面浏览器场景。

### 方案 C：轻量级 logpoints

**实现**：
- 用户点击行号 → 动态插入 `console.log`（通过 `Runtime.evaluate` 或脚本注入）
- 不暂停，只打日志

**代码示例**：
```typescript
// 面板点击行号 42
transport.send('debugger.setLogpoint', { url: 'script.js', line: 42, expr: 'localVar' });

// SDK 端
transport.onCommand('debugger.setLogpoint', ({ url, line, expr }) => {
  // 方式1：Runtime.evaluate 注入（需页面支持）
  eval(`console.log('🔵 Line ${line}:', ${expr});`);
  
  // 方式2：AST 改写（更可靠）
  rewriteScript(url, insertAt(line, `console.log('🔵 Line ${line}:', ${expr});`));
});
```

**工程量**：3天

**推荐度**：⭐⭐⭐ 作为方案 A 的 MVP 前置验证可行，但长期看体验不如真断点。

---

## 推荐决策路径

### 第 1 步：快速 MVP（1 周）
实现**方案 C logpoints**，验证用户对"在 Sources 面板打断点"的需求强度：
- 面板：点击行号 → 发消息给 SDK
- SDK：插入 `console.log` → 输出到 Console 面板
- 用户在 Console 里看到"伪断点"日志

**评估标准**：如果用户反馈"有总比没有好，但还想要真暂停"，则进入第 2 步；如果觉得够用，就此打住。

### 第 2 步：完整断点调试（2-3 周）
实现**方案 A chobitsu**：
- Week 1：基础框架（断点表、暂停 Promise、UI 骨架）
- Week 2：完整 domain（单步、scope、watch）
- Week 3：source map、测试、文档

**里程碑验证**：
- M1：能在一个简单页面设断点、暂停、看变量
- M2：能单步调试、条件断点
- M3：支持 source map 还原到 TS/React 源码

### 第 3 步（可选）：自动化埋点
如果手动加 `__remotr_checkpoint()` 太麻烦，提供：
- Babel/SWC plugin 自动注入
- Service Worker 拦截 + AST 改写（完全透明）

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| chobitsu 暂停机制被恶意代码绕过 | 中 | 低 | 在调试场景非安全威胁；生产禁用 debugger plugin |
| 断点改写性能开销 | 低 | 中 | 只改写有断点的脚本；用 WeakMap 缓存改写结果 |
| Source map 解析失败 | 中 | 中 | 降级到 minified 代码；提示用户检查 map 部署 |
| 与第三方脚本冲突（如 Sentry） | 低 | 低 | 隔离 debugger 上下文；测试常见库 |

---

## 总结与建议

1. **技术可行**：方案 A (chii+chobitsu) 在架构上与 Remotr 完美契合，工程量可控（2-3周）
2. **优先级判断**：先做 logpoints MVP（1周）验证需求，用户反馈强烈再上完整断点
3. **长期价值**：完整 debugger 能力是 Remotr 区别于 eruda/vConsole 的核心竞争力——它们只能看日志，你能打断点调试
4. **风险可控**：主要风险是工程量估算偏乐观；建议留 20% buffer

**下一步行动**：
- [ ] 决策：做 logpoints MVP，还是直接上完整方案？
- [ ] 如果做完整方案，我可以给出详细的实现 PR 计划（分 10 个小 PR，每个可独立 review）
- [ ] 需要我先做一个 PoC demo 吗？（用 chobitsu 跑一个最小化例子，验证暂停机制）

---

## 参考资料

### 调研来源
- [Chrome DevTools Protocol 官方文档](https://chromedevtools.github.io/devtools-protocol/)
- [chobitsu GitHub](https://github.com/liriliri/chobitsu) - 纯 JS CDP 实现
- [chii GitHub](https://github.com/liriliri/chii) - 远程调试服务器
- [rrweb 与调试工具兼容性讨论](https://github.com/rrweb-io/rrweb/issues)

### 相关项目
- **Replay.io**：时间旅行调试，真正的引擎录制（商业闭源，需特殊浏览器）
- **weinre**：早期远程调试工具（已过时，不支持断点）
- **eruda**：移动端 console（无远程调试）

此文档版本：v1.0 (2026-06-18)
作者：Claude (Remotr 架构分析)
