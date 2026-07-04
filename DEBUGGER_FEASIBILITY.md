# Remotr 远程断点调试可行性分析

> **v2.0 重要更正**:v1.0 推荐的"方案 A:chii+chobitsu 完整断点"结论**有误**。
> 经核实 chobitsu 源码(2026-07-03),其 `Debugger` domain 仅实现 `enable`(上报
> `Debugger.scriptParsed`)、`getScriptSource`、`setProxy` 三个方法——**不存在**
> `setBreakpointByUrl` / `pause` / `resume` / 单步等任何断点能力。chii + chobitsu
> 接 DevTools frontend 后,Sources 面板只能查看源码,无法打断点。
> v1.0 的方案 A 不可执行,本版全面重写。

## 执行摘要

**在"零配置注入"的产品约束下,真断点(暂停/单步/查看局部变量)不可实现**——这是
JS 单线程模型与浏览器安全模型的物理性限制,不是工程量问题。可行路线只有两条,
外加一套推荐的替代方案:

| 路线 | 断点能力 | 工程量 | 与产品定位 | 推荐度 |
|------|---------|-------|-----------|--------|
| **A. 构建期插桩(vdebugger 路线)** | ✅ 真暂停/单步/scope | 3-4 周 | ⚠️ 要求业务方改构建,冲突零配置定位 | ⭐⭐⭐(opt-in) |
| **B. 浏览器扩展(chrome.debugger)** | ✅ V8 引擎级 | 4+ 周 | ❌ 仅桌面 Chrome,丢失移动 H5/微信核心场景 | ⭐ |
| **C. 无暂停调试套件(替代方案)** | ⚠️ 不暂停,覆盖断点 ~90% 使用动机 | ~2 周 | ✅ 零侵入,完全契合 | ⭐⭐⭐⭐⭐ |

**推荐决策**:Phase 1 做方案 C(函数级 Tracepoint + Watch 表达式);Phase 2 视需求
将方案 A 作为 opt-in 高级功能(先 PoC 验证)。

---

## 一、根本约束:注入式 SDK 为什么做不了真暂停

1. **JS 单线程**:SDK 与业务代码运行在同一线程。SDK 无法从线程内部暂停线程本身——
   暂停自己即暂停一切,包括接收 `resume` 命令的 WebSocket 消息回调。不存在
   "挂起业务代码、同时保持 SDK 响应"的执行模型。
2. **`debugger;` 语句**仅在本地 DevTools 已附加时触发暂停,远程场景下是 no-op,
   无法作为远程断点的实现载体。
3. **V8 Inspector 级断点**需要浏览器特权入口:
   - `--remote-debugging-port`(桌面浏览器启动参数)——移动端/微信 webview 无法配置;
   - `chrome.debugger` 扩展 API——需要用户安装扩展,且仅桌面 Chrome。
   两者都不覆盖 Remotr 的核心场景(移动 H5、微信 webview、智能电视/车机浏览器)。

**唯一例外**:在**构建期**把业务代码改写为 generator 函数,用 `yield` 在断点位置
让出控制权——执行"暂停"在 generator 内部,事件循环仍在运转,SDK 可继续收发命令。
这就是微信团队 [vdebugger](https://github.com/wechatjs/vdebugger) 的路线(方案 A)。

## 二、chobitsu 核实证据(v1.0 错误的来源)

chobitsu `src/domains/Debugger.ts` 的完整对外实现(2026-07-03 核实):

```typescript
export function setProxy(params)              // 设置脚本代理
export function enable()                      // 遍历脚本,trigger 'Debugger.scriptParsed'
export async function getScriptSource(params) // 返回脚本源码
```

没有断点表、没有暂停机制、没有单步。chobitsu 对 CDP `Debugger` domain 的实现
只够支撑 DevTools Sources 面板的**源码浏览**。v1.0 描述的"AST 改写插入检查点、
Promise 暂停机制"在 chobitsu 中不存在,属于对该库能力的误判。

## 三、方案 A:构建期插桩(vdebugger 路线)—— opt-in 真断点

### 原理

vdebugger 通过 AST 转换将业务代码改写为 generator 函数,在每个可断点位置插入
`yield`。命中断点时 generator 挂起,栈帧与 scope 状态序列化后可查询;`resume` /
单步通过控制 generator 的 `.next()` 实现。支持构建期预转换(`transform` API),
避免运行期转换的性能损失。

### 架构集成

```
业务构建(Vite/Webpack)
  └─ @remotr/instrument 插件(新包,封装 vdebugger.transform)
       ├─ 产出:插桩后代码 + 转换层 source map
       └─ 运行期:vDebugger.debug(code) 接管执行

Remotr SDK
  └─ plugins/breakpoint.ts(新插件)
       ├─ 桥接 vdebugger 运行时 API ↔ Remotr Envelope 协议
       ├─ 命令:bp.set / bp.remove / bp.resume / bp.stepOver / bp.stepInto / bp.stepOut
       └─ 事件:bp.paused(callFrames + scope 变量,SpyAtom 序列化)

Server:零改动(room.ts 的 envelope 路由是方法无关透传)

Debugger 面板
  └─ Sources 面板扩展:断点槽(点击行号)、暂停态高亮、
     Call Stack / Scope 树(复用 SpyAtom 渲染)、单步工具栏
```

### 代价与风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| 业务方必须改构建 | 与"一个 script 标签零配置"定位冲突 | 定位为 opt-in 高级功能,仅 dev/staging |
| vdebugger 停止维护 | 最后提交 2024-11,issue 无人处理 | fork 进 Remotr 组织,自担维护 |
| 性能开销 | generator 包装 + 状态序列化,包体积增大 | 仅插桩业务代码,排除 node_modules;生产构建剔除 |
| 双层 source map | vdebugger 转换 map ∘ 应用构建 map 需要组合 | `@remotr/sourcemap` 已有解析基础,做链式解析 |
| 转换正确性 | async/await、类字段等新语法边界 | **先 2-3 天 PoC**:真实 React 应用验证后再立项 |

### 工程量:3-4 周(PoC 通过后)

- Week 1:`@remotr/instrument` 包 + fork vdebugger + 构建插件
- Week 2:SDK `breakpoint.ts` 插件 + 协议桥接
- Week 3:面板断点 UI(断点槽/暂停态/Scope 树/单步工具栏)
- Week 4:双层 source map 组合、测试、文档

## 四、方案 B:浏览器扩展(不推荐)

`chrome.debugger` API 可获得真 V8 断点,但:仅桌面 Chrome、需安装扩展、
与注入式 SDK 是两种产品形态。等于放弃移动 H5/微信 webview 这一核心差异化场景,
去和本地 DevTools 竞争。不建议投入。

## 五、方案 C(推荐):无暂停调试套件

打断点的真实动机绝大多数是:**"代码执行到这里了吗?此刻变量是什么值?"**
这不需要暂停执行也能回答。结合 Remotr 已有的 rrweb 时间旅行、source map 还原、
MCP AI 修复,以下两个能力可覆盖断点的绝大部分使用场景:

### 5.1 函数级 Tracepoint(5-7 天)

- **面板**:按对象路径设置追踪点(如 `app.store.dispatch`、
  `MyService.prototype.fetchUser`),可附加条件表达式
- **SDK**:新插件 `plugins/trace.ts`,按路径解析目标函数并用
  `Object.defineProperty` 包装(storage 插件已验证的劫持技术),捕获:
  - 入参 / 返回值 / 抛出的异常(SpyAtom 序列化,复用现有深度/截断策略)
  - 调用栈(`Error.stack`,面板侧经 `@remotr/sourcemap` 还原到原始源码)
  - 耗时(同步执行时间;返回 Promise 时追踪 settle 时间)
  - 条件表达式仅命中时上报,等效 DevTools 条件 logpoint
- **协议**:新增命令 `trace.set` / `trace.remove` / `trace.list`(Debugger → SDK,
  带 id/replyTo),新增事件 `trace.hit`(SDK → Debugger)
- **服务端:零改动**——`room.ts` 按 envelope 透传,方法无关
- **面板展示**:`trace.hit` 流入 Console 面板(带专属图标/过滤器),
  点击栈帧跳转 Sources 原始源码

### 5.2 Watch 表达式面板(2-3 天)

- 复用现有远程 eval 命令通道
- 面板侧维护表达式列表,定时(如 1s)或手动刷新求值
- 结果以 SpyAtom 树渲染,变化高亮

### 5.3 与既有能力的组合工作流

```
rrweb 时间旅行     →  "当时页面长什么样"
Tracepoint         →  "执行流走到哪、参数/返回值是什么"
Watch 表达式       →  "这个状态现在是什么值"
sourcemap 还原     →  "对应我源码的哪一行"
MCP + Claude Code  →  "直接在真实仓库里修掉"
```

这条链路与项目既定方向(AI 辅助修复不依赖断点)完全一致。

### 工程量:~2 周

| 任务 | 工时 |
|------|------|
| SDK `trace.ts` 插件 + 协议 | 4 天 |
| 面板 Tracepoint 管理 UI + Console 集成 | 3 天 |
| Watch 表达式面板 | 2-3 天 |
| 测试(SDK 单测 + 面板交互)+ 文档 | 2 天 |

---

## 六、决策路径

1. **立即可做**:方案 C(~2 周)。零侵入、全场景可用、强化现有 AI 修复闭环。
2. **需求验证后**:若用户明确反馈"需要真暂停/单步",先做 vdebugger PoC(2-3 天),
   验证转换正确性与开销,通过后立项方案 A(3-4 周,opt-in)。
3. **不做**:方案 B(扩展路线)、以及任何基于 chobitsu 的断点方案(能力不存在)。

---

## 参考资料

- [chobitsu Debugger domain 源码](https://github.com/liriliri/chobitsu/blob/master/src/domains/Debugger.ts) — 核实无断点实现
- [chii 文档](https://chii.liriliri.io/) — DevTools frontend 远程接入(仅源码查看)
- [vdebugger (wechatjs)](https://github.com/wechatjs/vdebugger) — generator 转换真暂停;最后维护 2024-11
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) — 原生 CDP 参考

此文档版本:v2.0 (2026-07-03) — 更正 v1.0 关于 chobitsu 断点能力的错误结论
作者:Claude (Remotr 架构分析)
