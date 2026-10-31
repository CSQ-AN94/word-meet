# 同词相遇 · Word Meet

双人在线联想游戏。两人分别输入词语，提交后同时揭晓，再结合上轮两个词继续联想，直到词语相同。

[GitHub Pages 入口](https://csq-an94.github.io/word-meet/) · [服务器同源入口](https://word-meet-csq-an94.chirpy-lemur-3231.chatgpt.site/)

## 开始游戏

1. 一人输入昵称并创建房间，复制邀请链接或房间码给另一人。
2. 另一人打开链接，或在“加入房间”中输入房间码。
3. 每轮分别输入 1–20 字的词语，点击“锁定词语”。双方提交后同时揭晓。
4. 词语不同则继续联想；双方准备后开始下一轮。相同即成功，可以再来一局。

去掉首尾空格并做 Unicode NFC 规范化后严格比较；大小写、标点和词内空格仍算不同。昵称最多 12 字。

## 联机方式

新版通过 HTTPS 房间服务和 Cloudflare D1 同步消息，不再使用 PeerJS、WebRTC、STUN 或 TURN。两位玩家各自访问服务器，不要求相同设备或 Wi‑Fi，也不依赖浏览器之间的 UDP 直连。不需要注册账号或允许第三方 Cookie。

网页资源和源码保存在 GitHub，网页通过 GitHub Pages 发布。服务器同源入口托管同一套网页，API 路径为 `/api`。`src/config.js` 指定房间服务地址。

- 房间最多两人；同时加入也只能占用一个客人席位。
- 临时断网自动重连，待发送消息按顺序重试并去重，本轮已提交的词语会保留。
- 游戏时保持页面打开。刷新或手动重新加入会开始新局。关闭页面时会发送退出请求；若浏览器被直接终止，客人席位在约 90 秒无活动后可重新加入。
- 房间两小时无访问即失效，过期房间会在后续建房时清理。房主主动离开会关闭房间并删除消息。
- 词语通过带随机盐的 SHA-256 承诺值锁定，绑定对局、局号、轮号和席位；双方锁定后才交换原文并校验。
- 服务器临时保存房间昵称和转发消息，房间令牌仅保存在当前页面内存中。不要把房间码用于敏感内容。

旧版依赖浏览器直连，但默认 TURN 地址不代表可用的中继服务：[PeerJS 官方停用公告](https://github.com/orgs/peers/discussions/1172)。这次改为普通 HTTPS，以去除跨网络连接对 NAT 穿透的依赖。升级后两人都应刷新网页并重新建房，旧版房间码不能迁移。

## 本地开发与检查

需要 Node.js 22.13 或以上版本。前端没有第三方运行依赖。

```sh
npm ci --ignore-scripts
npm test
npm run dev
```

`npm run dev` 仅监听本机。前端默认连接线上房间服务；接口测试使用真实本地 HTTP 服务和 SQLite，无需线上账户。

```sh
npm run build
npm run preview
```

构建产物位于 `dist/`，使用相对路径，支持 GitHub Pages 子路径。构建时为整个 JavaScript 模块图和 CSS 生成统一的内容版本，避免旧版联机脚本被缓存。

## 部署与文件

- `src/game.js`：提交、揭晓、胜利与准备协议。
- `src/room.js`：HTTPS 房间客户端、顺序发送、轮询及自动恢复。
- `server/api.js`：房间服务，使用标准 Request/Response 和 D1 接口。
- `server/schema.sql`：与服务端迁移一致的数据库结构。
- `test/`：协议、HTTP 联机、并发加入、鉴权、断网恢复和缓存测试。

GitHub 仓库的 `main` 保存源代码，`gh-pages` 保存 `dist/` 构建产物。Pages Source 为 **Deploy from a branch → gh-pages → / (root)**。`docs/pages-workflow.example.yml` 保留可选 Actions 部署示例；当前发布不需要增加 GitHub workflow 授权。

服务器部署工程位于同级 `word-meet-server`，通过 Sites 托管并声明 D1 的 `DB` 绑定。生成数据库迁移后构建并发布；`scripts/sync-game.mjs` 将本项目的构建产物和 `server/api.js` 同步到服务器工程。服务端的房间令牌鉴权独立于托管平台账户，不要求玩家登录 ChatGPT。
