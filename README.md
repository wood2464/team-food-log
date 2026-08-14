# 队友食录 - 团队餐厅记录 & 决策 App

一个全队共享的餐厅库 + 每日决策工具。记录吃过的餐厅、打分、拍照、搜新店发现。

## 功能

- **餐厅库**：记录餐厅名、评分、人均价格、菜系、菜品评价、照片、链接
- **今天吃啥**：
  - 从吃过的里随机抽一个（支持按菜系/价格/评分筛选）
  - 搜新店发现：联网搜一批真实餐厅候选、一键加入库
- **全队共享**：一个链接、全队同时看到、实时同步数据

## 快速部署到 Railway

### 前置条件

1. GitHub 账号（你已有）
2. Railway 账号（免费注册：https://railway.app）
3. Claude API 密钥（来自 https://console.anthropic.com）

### 部署步骤

#### 1. 推代码到 GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/team-food-log.git
git push -u origin main
```

#### 2. 部署到 Railway

1. 登录 Railway.app（用 GitHub 账号）
2. **New Project** → **Deploy from GitHub**
3. 选 `team-food-log` 仓库
4. 等待自动部署（2-3 分钟）
5. 在 **Variables** 里添加：`ANTHROPIC_API_KEY`（另可选加 `TURSO_URL` / `TURSO_AUTH_TOKEN` 接 Turso 数据库，否则用本地 SQLite 文件，重新部署会丢数据）

#### 3. 获取 URL

部署成功后，Railway 生成公开链接，分享给团队。

### 手机 / iPad / 电脑访问

不需要装任何 app —— Railway 生成的就是一个普通网址，把链接发到群里，队友在 iPhone / iPad（Safari）、安卓（Chrome）、电脑（任意浏览器）上打开即可，数据都存在同一个 Turso 数据库里，全队看到的是同一份。

界面本身是响应式的：手机上是全宽卡片 + 底部弹出表单，桌面上是多列网格 + 居中弹窗。iPhone 上打开后可以点分享 → **添加到主屏幕**，会生成一个图标，点开后没有 Safari 的地址栏，体验接近原生 app（已加了对应的 meta 标签）。

## 本地开发

### 安装依赖

```bash
npm install
```

### 运行

```bash
npm start
```

打开 http://localhost:3000

## 国内访问

- 基本操作（加餐厅、打分）：流畅
- 搜新店：第一次等 3-5 秒（调 Claude）
- 整体：比 Claude artifact 快很多

## Made with React + Express + Turso