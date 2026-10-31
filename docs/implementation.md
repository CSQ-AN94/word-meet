# 同词相遇：Supabase 联机

用户已确认使用 Supabase 免费托管。保留 GitHub Pages 和双人玩法，前端直接通过 HTTPS 调用 `public.word_meet(p_request jsonb)`，不再依赖受网络限制的浏览器直连或被拦截的 Sites 入口。

## 已实现

- 独立私有 schema 保存房间与消息，启用 RLS，撤销匿名与已登录角色的直接表权限。
- 单一 RPC 使用随机席位令牌鉴权，数据库只保存其 SHA-256；每次操作锁定房间行，避免多玩家抢同一个席位。
- 复用现有游戏协议、消息顺序与去重、短暂断网重试和客人快速重入。
- 客户端使用 `apikey` 传公开项目 key，房间令牌放在 RPC JSON 中。拒绝 secret/service_role key。
- 原 D1 实现已移除；SQL 初始化脚本与注册步骤在仓库中可直接获取。

## 验证边界

本地用 PGlite 的真实 PostgreSQL 引擎执行同一份 SQL，并通过真实 HTTP 验证客户端多轮对局。PGlite 为单连接测试环境，不能代替线上 PostgreSQL 多连接并发验证。

2026-11-01：完整 31 项测试通过，前端构建通过。内置浏览器从邀请链接加入本地测试房间，完成“月亮 / 兔子 → 玉兔 / 玉兔”两轮，确认单方提交时隐藏对方词语、双方准备后进入下一轮和同词结束。独立审查未发现阻塞问题。

保留的限制：首次创建或加入成功但响应丢失时，客户端无法恢复尚未收到的席位令牌；客人席位最多需要约 90 秒释放。自动重试覆盖已建立的连接与待发送消息。

2026-11-01：用户已连接 Supabase 并选择组织 `CSQ-AN94's Org`。免费项目 `word-meet` 已创建于新加坡，项目 ID 为 `dmprudhtcvhbfavzxirz`；已应用 `word_meet_rooms` 初始化迁移并配置公开 publishable key。

真实公网检查通过：health 返回 200/protocol 3；来自 GitHub Pages 的 CORS 与预检正常；两个并发加入返回 200/409；错误席位令牌返回 401；重复消息只收到一次；通过 Data API 直接访问私有 schema 返回 406。测试房间已用本次生成的房主令牌关闭。

数据库权限检查确认：两张表均启用 RLS，anon/authenticated 均无直接表权限，anon 无私有 schema 的 USAGE 权限，只能调用公开房间函数。当前 Advisors 的“RLS 无策略”提示对应故意封闭的私有表；公开 SECURITY DEFINER 提示对应使用席位令牌鉴权的房间接口，并非 Supabase Auth 用户接口。函数固定空 search_path，轮询、发消息与退出前均校验令牌。参考 [私有表无策略提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[匿名可执行函数提示](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) 和 [已登录用户可执行函数提示](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。新建表的索引尚未有使用统计，保留用于消息轮询与过期清理。

GitHub Pages 已完成发布，分支提交 `6ef0efef95c5a1b108d6d39f90f5c6d94aed8c18` 的构建状态为 `built`，公开网页已加载模块版本 `6208c17a40e2`。通过内置浏览器从原网址创建房间并用邀请链接加入，正式 Supabase 项目上完成“月亮 / 兔子 → 玉兔 / 玉兔”两轮，双方均显示成功。单方锁词保密、双方准备和历史记录显示正常；已退出并关闭本次测试房间。截图保存在本地 `artifacts/supabase-live-game.jpg`。

实际 Safari 和同学设备的跨网络可达性仍需由他们刷新并重新建房确认；未把同一台电脑的双标签测试写成不同设备实测。

先前 Sites 部署虽返回成功，但公开访问在自动验证与用户 Safari 均返回 Cloudflare 403；已停止访问该入口，也没有把 GitHub Pages 指向它。
