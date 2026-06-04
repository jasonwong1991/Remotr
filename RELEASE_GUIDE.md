# 🚀 Remotr v1.0.0 发布指南

由于 GitHub CLI 的 token 已过期，需要手动完成 GitHub 发布。以下是完整步骤：

---

## ✅ 已完成

1. **Git 仓库初始化** ✅
2. **所有文件已提交** ✅
3. **版本标签创建**: `v1.0.0` ✅
4. **Docker 配置完成**:
   - ✅ Dockerfile (多阶段构建)
   - ✅ docker-compose.yml
   - ✅ .dockerignore
   - ✅ DOCKER.md (完整文档)

---

## 📋 手动发布到 GitHub

### 步骤 1: 创建 GitHub 仓库

1. 打开浏览器访问: https://github.com/new
2. 填写信息:
   - **Repository name**: `remotr`
   - **Description**: `Remote debugging made effortless — Chrome DevTools for any webpage`
   - **Public** (选择公开)
   - ⚠️ **不要** 勾选 "Add a README file"
   - ⚠️ **不要** 勾选 ".gitignore" 或 "license"

3. 点击 **Create repository**

---

### 步骤 2: 推送代码到 GitHub

在你的终端执行:

```bash
cd /Users/JasonWong/Documents/github/ez2dbg

# 添加远程仓库 (替换 YOUR_USERNAME 为你的 GitHub 用户名)
git remote add origin https://github.com/YOUR_USERNAME/remotr.git

# 推送代码和标签
git push -u origin main
git push origin v1.0.0
```

---

### 步骤 3: 创建 GitHub Release

1. 打开仓库页面: `https://github.com/YOUR_USERNAME/remotr`
2. 点击右侧 **Releases** → **Draft a new release**
3. 填写信息:

**Choose a tag**: `v1.0.0` (已存在)

**Release title**: `🎉 Remotr v1.0.0 - First Stable Release`

**Description** (复制下面内容):

```markdown
## 🎉 Remotr v1.0.0 - First Stable Release

**Remote debugging made effortless** — Inject a script into any webpage and get a live page mirror with Chrome DevTools-like panels.

### ✨ Features

#### 🖥️ Core Capabilities
- **Live Page Mirror** — Real-time DOM recording and replay with rrweb
- **Zero-config Injection** — Single `<script>` tag, works anywhere
- **WebSocket Sync** — Real-time bidirectional communication
- **Cross-device** — Debug mobile H5, WeChat webviews, smart TVs, and more

#### 🛠️ DevTools Panels
- **Elements** (NEW!) — Full Chrome DevTools-like inspector
  - Computed styles with search/filter
  - Box model visualization
  - Matched CSS rules with cascade
  - Element picker mode
  - Live style editing
- **Console** — Remote console with eval support
- **Network** — HTTP request/response inspection
- **Storage** — localStorage/sessionStorage/Cookie management

#### 🐳 Deployment
- **Docker support** — Production-ready with docker-compose
- **PM2 integration** — Process management
- **Nginx reverse proxy** — HTTPS and domain support

### 📦 Installation

#### Option 1: Docker (Recommended)
```bash
git clone https://github.com/YOUR_USERNAME/remotr.git
cd remotr
docker-compose up -d
```

#### Option 2: npm
```bash
npm install
npm run build
npm start
```

### 🚀 Quick Start

1. **Start server**: `http://localhost:9777`
2. **Inject script** into target page:
   ```html
   <script src="http://localhost:9777/remotr.js" data-room="default"></script>
   ```
3. **Open debugger**: Visit `http://localhost:9777/?room=default`

### 📚 Documentation

- [README.md](./README.md) — Complete guide
- [DOCKER.md](./DOCKER.md) — Docker deployment
- [examples/demo.html](./examples/demo.html) — Live demo

### 🙏 Credits

Built with:
- [rrweb](https://github.com/rrweb-io/rrweb) — Page recording/replay
- React + Vite + Zustand — Debugger UI
- WebSocket (ws) — Real-time communication
- TypeScript — Type safety

---

**Full Changelog**: Initial release
For issues and feature requests: [GitHub Issues](https://github.com/YOUR_USERNAME/remotr/issues)
```

4. 点击 **Publish release**

---

### 步骤 4: 配置 GitHub Topics (可选)
1. 回到仓库首页
2. 点击右侧齿轮图标 ⚙️ (About 部分)
3. 添加 Topics:
   - `remote-debugging`
   - `devtools`
   - `chrome-devtools`
   - `debugging-tool`
   - `rrweb`
   - `websocket`
   - `developer-tools`
   - `mobile-debugging`
   - `docker`
   - `typescript`

---

## 🐳 Docker 使用指南

### 本地测试

```bash
cd /Users/JasonWong/Documents/github/ez2dbg

# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 测试
curl http://localhost:9777/remotr.js

# 停止
docker-compose down
```

### 远程部署

1. **将代码上传到服务器**:
```bash
# 方式 1: Git
ssh user@your-server
cd /opt
git clone https://github.com/YOUR_USERNAME/remotr.git
cd remotr

# 方式 2: scp
scp -r /Users/JasonWong/Documents/github/ez2dbg user@your-server:/opt/remotr
```

2. **启动服务**:
```bash
cd /opt/remotr
docker-compose up -d
```

3. **配置防火墙**:
```bash
# 开放 9777 端口
ufw allow 9777/tcp
```

4. **使用**:
```html
<script src="http://your-server-ip:9777/remotr.js" data-room="production"></script>
```

---

## 📝 下一步

1. ⬆️ **推送到 GitHub** (上面步骤 2)
2. 🏷️ **创建 Release** (上面步骤 3)
3. 🐳 **测试 Docker** (本地验证)
4. 📢 **分享项目**:
   - 发到 Hacker News
   - 提交到 Product Hunt
   - 分享到 v2ex/掘金/知乎

---

## 🎯 营销建议

### GitHub README Badges (添加到 README.md 顶部)

```markdown
[![Docker Image](https://img.shields.io/docker/v/YOUR_DOCKERHUB/remotr?label=docker)](https://hub.docker.com/r/YOUR_DOCKERHUB/remotr)
[![GitHub release](https://img.shields.io/github/v/release/YOUR_USERNAME/remotr)](https://github.com/YOUR_USERNAME/remotr/releases)
[![License](https://img.shields.io/github/license/YOUR_USERNAME/remotr)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/YOUR_USERNAME/remotr?style=social)](https://github.com/YOUR_USERNAME/remotr)
```

### 文案建议 (社交媒体)

**Twitter/X**:
```
🚀 Just released Remotr v1.0.0!

Remote debugging made effortless — inject 1 script tag, get Chrome DevTools anywhere.

Perfect for:
- Mobile H5 pages
- WeChat webviews  
- Smart TVs/car browsers
- Client troubleshooting

⭐ https://github.com/YOUR_USERNAME/remotr

#devtools #debugging #webdev
```

**中文社区 (v2ex/掘金)**:
```
开源了一个远程调试工具 Remotr v1.0.0

只需一行 <script> 标签，就能在浏览器里看到任意网页的实时镜像 + Chrome DevTools 面板。

特别适合调试：
- 移动端 H5 页面
- 微信内嵌网页
- 智能电视/车机浏览器
- 客户现场的疑难页面

支持 Docker 一键部署，MIT 协议。

GitHub: https://github.com/YOUR_USERNAME/remotr
```

---

所有文件已准备就绪！执行上面的步骤即可完成发布。🎉
