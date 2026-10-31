# 同词相遇 · Word Meet

两个人，各想一个词。一起揭晓，再从两个词继续联想，直到想到一样的词。

原生网页，手机、电脑都能玩。不用注册游戏账号，通过房间码或邀请链接加入。网页部署在 GitHub Pages；联机使用 PeerJS / WebRTC。

**[在线游玩：同词相遇](https://csq-an94.github.io/word-meet/)**

## 开始游戏

1. 输入昵称，点击“创建房间”。
2. 把邀请链接或八位房间码发给朋友。
3. 两人各自写词，锁定后无法更改；双方都提交后，词语才会揭晓。
4. 若不同，分别从上轮两个词继续联想。双方点击“继续联想”后开始下一轮。
5. 词语完全相同即成功。双方都选择再来一次，可以重新开始。

会去掉首尾空格并做 Unicode NFC 规范化；大小写、标点和词内空格仍严格区分。词语最多 20 字，昵称最多 12 字。

## 本地运行

需要 Node.js 22 或以上版本。

```sh
npm ci --ignore-scripts
npm run dev
```

打开终端打印的 `http://127.0.0.1:4173/`。开两个标签页可以验证双人流程；使用公共 PeerServer 的本地测试同样需要联网。仅监听本机，不对局域网开放开发文件。

```sh
npm test
npm run build
npm run preview
```

构建文件在 `dist/`，所有资源使用相对路径，支持 GitHub Pages 的仓库子路径。PeerJS 库随网页一起打包，运行时不依赖 CDN 脚本。

## GitHub 部署

当前上线使用 `gh-pages` 分支中的构建产物，**Settings → Pages → Source** 为 **Deploy from a branch → gh-pages → / (root)**。此方式不需要额外的 GitHub `workflow` 授权。`main` 保存源代码，更新网页时需要先运行 `npm test` 和 `npm run build`，再将 `dist/` 中的内容发布到 `gh-pages` 分支。

`docs/pages-workflow.example.yml` 是可选的自动测试、构建与部署示例。若之后启用 Actions，需将它放到 `.github/workflows/pages.yml`，把 Pages Source 改为 GitHub Actions，并使用有 `workflow` 权限的 GitHub 登录。

GitHub Pages 是静态网页托管，不负责运行游戏服务器。PeerServer Cloud 只负责建立连接；对局消息通过 WebRTC 数据通道发送。PeerJS 1.5.5 的默认 ICE 配置包含 STUN 和公共 TURN 服务，保留了这些默认配置。

## 连接与对局约定

- 房间最多两人；第三人会得到房间已满的提示。
- 双方打开页面期间才保持房间与对局。刷新、关闭页面或重新连接后开始新局；没有服务器上的历史存档。
- 公共信令与 TURN 服务属于外部依赖，不能保证所有地区、运营商或公司网络都可连通。连接失败会明确提示，可以换网络后重试。需要长期稳定服务时，应使用自有 PeerServer 和 TURN。
- 词语先通过带随机盐的 SHA-256 承诺值锁定，绑定对局、局号、轮号与席位。双方锁定后才交换原文，并验证承诺值。
- 游戏没有账户、统计追踪或词语数据库。浏览器仅保存最近使用的昵称；分享房间码即可加入，不适合存放敏感内容。
- 已通过同机双浏览器标签页实际对局验证；这不代表已验证跨运营商或不同国家网络。

## 文件

- `src/game.js`：可独立测试的提交、揭晓、准备及胜利协议。
- `src/room.js`：PeerJS 连接、两人容量、握手与断线处理。
- `src/main.js`：页面交互与对局呈现。
- `src/style.css`：桌面与手机布局、减少动态效果支持。
- `test/`：使用 Node 内置测试工具验证游戏协议和房间边界。
- `scripts/`：无需框架的开发服务和静态构建。

第三方 PeerJS 使用 MIT 许可证，构建时将原许可证一并放在 `dist/vendor/PEERJS-LICENSE.txt`。

参考：[PeerJS 文档](https://peerjs.com/)、[PeerServer Cloud](https://peerjs.com/server/cloud)、[GitHub Pages 部署说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。
