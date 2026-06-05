## 当前问题分析

### 问题描述
1. **ElementTree 的 hover 高亮显示在远程页面而不是 PageMirror** - 这是因为 ElementTree 调用 `elements.highlight` 命令发送到远程 SDK，SDK 在真实页面显示 overlay
2. **PageMirror 中 Pick 点击无效** - 需要调试为什么 click 事件不生效
### 解决方案

#### 1. 移除 ElementTree 的 highlight 功能
- 删除 `onMouseEnter` 和 `onMouseLeave` 中调用 `sendCommand('elements.highlight')`
- 这样 hover Elements 树节点时不会在远程页面显示蓝色边框

#### 2. 修复 PageMirror Picker 点击
需要调试:
- 检查 iframe 是否正确初始化
- 检查 `doc.elementFromPoint()` 是否返回正确元素
- 检查 `replayer.getMirror()` API 是否存在
- 添加更多调试日志

#### 3. 改进 PageMirror Hover
- overlay 应该在 PageMirror 内部显示
- 相对于 iframe/容器定位，不是绝对定位

### 需要修改的文件
1. `packages/debugger/src/components/elements/ElementTree.tsx` - 移除 highlight 命令
2. `packages/debugger/src/panels/PageMirror.tsx` - 添加调试日志，修复 picker 点击
