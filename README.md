# 同词相遇 · Word Meet

双人在线联想游戏。两人分别输入词语，提交后同时揭晓，再结合上轮两个词继续联想，直到词语相同。

[游戏入口](https://csq-an94.github.io/word-meet/) · [Supabase 注册与接入步骤](docs/supabase-setup.md)

当前版本已在原 GitHub Pages 入口上线，使用 Supabase 免费项目联机。公开 HTTPS 接口、跨来源访问、并发加入、消息去重和浏览器双人完整对局已验证。详见 [部署检查记录](docs/implementation.md)。

## 开始游戏

1. 一人输入昵称并创建房间，复制邀请链接或房间码给另一人。
2. 另一人打开链接，或在“加入房间”中输入房间码。
3. 每轮分别输入 1–20 字的词语，点击“锁定词语”。双方提交后同时揭晓。
4. 词语不同则继续联想；双方准备后开始下一轮。相同即成功，显示「本局总览」：按轮次连接两人的词语，最后汇合到相同的词。双方确认后可以再来一局。

「对局记录」和结束后的「本局总览」只保留当前这一局。刷新、离开或开始新局会清空，暂不提供历史对局存档。

去掉首尾空格并做 Unicode NFC 规范化后严格比较；大小写、标点和词内空格仍算不同。昵称最多 12 字。

## 联机方式

GitHub Pages 托管网页，Supabase 托管 PostgreSQL 和 HTTPS 接口。两个浏览器分别访问同一个 Supabase 项目，不要求相同设备或 Wi-Fi。回合制消息使用短轮询，不依赖 WebRTC、NAT 穿透、第三方 Cookie 或 WebSocket。

- 房间最多两人；数据库事务锁保证同时加入也只能占用一个客人席位。
- 临时断网自动重试，待发送消息按顺序去重，本轮已提交的词语保留。
- 游戏时保持页面打开。刷新或手动重新加入会开始新局；原客人可凭本页令牌立即重入。浏览器被直接终止时，客人席位在约 90 秒无活动后可重新加入。
- 房间两小时无访问即失效，过期房间在后续建房时清理。房主主动离开会关闭房间并删除消息。
- 使用带随机盐的 SHA-256 承诺值锁词；双方锁定后才交换词语原文并校验。
- 房间表与消息表在私有 schema 中，启用 RLS 并撤销浏览器角色直接读写权限。公开 RPC 校验独立随机席位令牌，只返回本人所在房间的信息。
- 浏览器只配置项目 URL 和公开 publishable key；不能使用 secret 或 service_role key。玩游戏的人不需要注册 Supabase。

Supabase 免费项目低活动一周后可能暂停，项目所有者可在控制台恢复：[官方说明](https://supabase.com/docs/guides/platform/free-project-pausing)。免费额度与限制以 [Supabase 定价](https://supabase.com/pricing) 为准。

## 本地检查

需要 Node.js 22.13 或以上版本。前端没有第三方运行依赖，PGlite 仅用于测试实际 PostgreSQL 初始化脚本。

```sh
npm ci --ignore-scripts
npm test
npm run dev
```

开发预览仅监听本机。配置 Supabase 后可以直接联机；自动化测试使用本地 PostgreSQL 和真实 HTTP，不需要线上账户。

```sh
npm run build
npm run preview
```

`dist/` 使用相对路径，支持 GitHub Pages 子路径。构建时为完整 JavaScript 模块图和 CSS 生成统一内容版本，防止旧版联机脚本缓存。

## 文件与发布

- `src/game.js`：提交、揭晓、胜利与准备协议。
- `src/room.js`：Supabase HTTPS RPC、顺序发送、轮询及自动恢复。
- `src/config.js`：项目 URL 与公开 publishable key。
- `supabase/setup.sql`：私有表、权限与房间 RPC，可重复执行。
- `test/`：实际 PostgreSQL、HTTP 双人对局、网络恢复、权限、公开配置与缓存检查。

GitHub 仓库的 `main` 保存源码，`gh-pages` 保存 `dist/`。Pages Source 为 **Deploy from a branch → gh-pages → / (root)**。`docs/pages-workflow.example.yml` 保留可选 Actions 示例；当前发布不需要增加 GitHub workflow 授权。

完成 [接入步骤](docs/supabase-setup.md)、确认公开接口与跨设备对局正常后再发布。旧版房间码不迁移，两人应刷新网页并重新建房。
