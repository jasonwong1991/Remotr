# Contributing to Remotr / 为 Remotr 贡献

[English](#english) | [简体中文](#简体中文)

---

## English

Thank you for your interest in contributing to Remotr! This document provides guidelines for contributing.

### 🐛 Reporting Bugs

Before creating a bug report, please:
1. **Search existing issues** to avoid duplicates
2. **Check the latest version** — the bug may already be fixed
3. **Use the bug report template** when creating a new issue

**What to include:**
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)
- Relevant logs or screenshots

### 💡 Suggesting Features

We welcome feature suggestions! When proposing a new feature:
1. **Search existing issues** to see if it's already proposed
2. **Use the feature request template**
3. **Explain the use case** — how would this improve your workflow?
4. **Consider alternatives** — have you thought of other solutions?

### 🔧 Submitting Pull Requests

**Before you start coding:**
1. **Open an issue first** to discuss major changes
2. **Check existing PRs** to avoid duplicate work
3. **Fork the repository** and create a feature branch

**PR Guidelines:**
- Follow the existing code style
- Add tests for new features
- Update documentation (README, inline comments)
- Keep commits focused and write clear commit messages
- Use the PR template — fill out all sections

**Development workflow:**
```bash
npm install
npm run build
npm test
npm start  # Test locally
```

**Before submitting:**
- [ ] All tests pass (`npm test`)
- [ ] Code builds without errors (`npm run build`)
- [ ] Documentation is updated
- [ ] Self-reviewed the changes

### 📝 Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

**Examples:**
- `feat(mcp): add source-map resolution to MCP tools`
- `fix(sdk): handle missing sourceMappingURL gracefully`
- `docs(readme): update AI-fix setup instructions`

### 🌍 Internationalization

Remotr supports English and Chinese. When adding UI text:
1. Add keys to `packages/debugger/src/i18n.ts`
2. Provide both English and Chinese translations
3. Update both `README.md` and `README.zh-CN.md`

### 🚀 Release Process

(For maintainers)
1. Update version in all `package.json` files
2. Update CHANGELOG.md
3. Create a GitHub release with tag `vX.Y.Z`
4. Docker images are built automatically

---

## 简体中文

感谢你对 Remotr 的关注！本文档提供贡献指南。

### 🐛 报告 Bug

在创建 bug 报告前，请：
1. **搜索现有 issue** 避免重复
2. **检查最新版本** — bug 可能已被修复
3. **使用 bug 报告模板** 创建新 issue

**需要包含的信息：**
- 清晰的 bug 描述
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（操作系统、Node 版本、浏览器）
- 相关日志或截图

### 💡 提出功能建议

我们欢迎功能建议！提出新功能时：
1. **搜索现有 issue** 查看是否已有提议
2. **使用功能请求模板**
3. **说明使用场景** — 这将如何改进你的工作流？
4. **考虑替代方案** — 你考虑过其他解决方式吗？

### 🔧 提交 Pull Request

**开始编码前：**
1. **先开一个 issue** 讨论重大变更
2. **检查现有 PR** 避免重复工作
3. **Fork 仓库** 并创建功能分支

**PR 指南：**
- 遵循现有代码风格
- 为新功能添加测试
- 更新文档（README、内联注释）
- 保持 commit 专注，编写清晰的 commit 信息
- 使用 PR 模板 — 填写所有部分

**开发流程：**
```bash
npm install
npm run build
npm test
npm start  # 本地测试
```

**提交前：**
- [ ] 所有测试通过（`npm test`）
- [ ] 代码构建无错误（`npm run build`）
- [ ] 文档已更新
- [ ] 自审了代码变更

### 📝 Commit 信息格式

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[可选的正文]
```

**类型：** `feat`（新功能）, `fix`（修复）, `docs`（文档）, `refactor`（重构）, `test`（测试）, `chore`（杂项）, `perf`（性能）

**示例：**
- `feat(mcp): add source-map resolution to MCP tools`
- `fix(sdk): handle missing sourceMappingURL gracefully`
- `docs(readme): update AI-fix setup instructions`

### 🌍 国际化

Remotr 支持中英文。添加 UI 文本时：
1. 在 `packages/debugger/src/i18n.ts` 添加键
2. 提供中英文翻译
3. 同时更新 `README.md` 和 `README.zh-CN.md`

### 🚀 发布流程

（维护者使用）
1. 更新所有 `package.json` 的版本号
2. 更新 CHANGELOG.md
3. 创建 GitHub release，标签 `vX.Y.Z`
4. Docker 镜像自动构建

---

## Code of Conduct / 行为准则

- Be respectful and inclusive / 尊重他人，包容差异
- Provide constructive feedback / 提供建设性反馈
- Focus on what is best for the community / 关注社区利益
- Show empathy towards others / 对他人表示同理心

## Questions? / 有疑问？

- Open a [Discussion](https://github.com/jasonwong1991/Remotr/discussions) / 开启一个讨论
- Check the [README](https://github.com/jasonwong1991/Remotr#readme) / 查看 README

Thank you for contributing! / 感谢你的贡献！
