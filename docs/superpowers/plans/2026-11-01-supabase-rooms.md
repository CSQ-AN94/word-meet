# Supabase Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有双人游戏接入 Supabase 免费托管并准备可直接执行的注册与部署步骤。

**Architecture:** PostgreSQL RPC 负责房间事务和随机令牌鉴权；前端以 HTTPS 短轮询复用现有 GameSession 协议。玩家无需账号，浏览器只持有公开项目 key。

**Tech Stack:** 原生 JavaScript、PostgreSQL / PostgREST、Node test、仅测试使用 PGlite。

**Spec:** `docs/superpowers/specs/2026-11-01-supabase-rooms.md`

## Global Constraints

- 保留现有玩法、页面文案及 GitHub Pages 子路径支持。
- 浏览器操作只使用 iab；不再访问被拦截的 Sites 地址。
- 数据库表不向匿名用户开放，唯一 RPC 用独立席位令牌鉴权。
- 不把 secret/service_role key 写入浏览器或仓库。
- 注册与项目创建由用户完成；其余已授权的配置与发布自主完成。

## Review Focus

- 同时加入时只有一人获得剩余席位。
- 迟到的旧连接退出请求不能移除新连接。
- 公开 key 无法读取其他房间或绕过令牌鉴权。
- Supabase 未初始化、暂停或 key 错误时显示可理解的失败信息。
- 注册未完成时明确报告部署待配置，不宣称线上修复成功。

### Task 1: PostgreSQL 房间操作

**Files:** `supabase/setup.sql`, `test/supabase-db.test.js`, `test/support/postgres.js`, `package.json`

**Interfaces:** `public.word_meet(p_request jsonb) → jsonb`，动作 create/join/poll/messages/leave；错误使用 PostgREST PT4xx 状态。

- [x] 写真实 PostgreSQL 用例，验证建房返回令牌；运行并确认缺少 RPC 时失败（404 ≠ 200）。
- [x] 实现私有表、RLS、事务锁与单一 RPC；覆盖鉴权、并发加入、恢复、去重、旧会话、过期与 Unicode。
- [x] 数据库 9 项测试通过。

### Task 2: 前端 Supabase 连接

**Files:** `src/config.js`, `src/room.js`, `test/https-room.test.js`, `test/support/http-server.js`, `test/supabase-config.test.js`

**Interfaces:** 保持 RoomConnection 事件和 GameSession 协议；构造参数 endpoint/apiKey 对应 Supabase 项目 URL/公开 key。

- [x] 将真实 HTTP 测试适配为 PostgREST wire format，确认旧客户端无法建房。
- [x] 改为 HTTPS RPC 请求并处理 PostgREST 错误；测试拒绝管理员 key、网络重试与旧连接退出。
- [x] 移除已弃用的 D1 服务实现与测试；完整 31 项测试与前端构建通过。

### Task 3: 初始化、审查与发布

**Files:** `README.md`, `docs/supabase-setup.md`, `docs/implementation.md`

**Interfaces:** 用户注册后提供已连接插件或公开项目 URL/key，初始化脚本与源码在 GitHub 可获取。

- [x] 写明注册、创建 Free 项目、初始化与公开配置步骤，说明免费暂停限制。
- [x] 独立代码审查未发现阻塞问题；iab 本地完成两轮对局并保存截图。已记录首次加入响应丢失的原有限制。
- [x] 已创建免费项目并初始化，完成权限、匿名跨源 API 与公网并发加入检查；GitHub Pages 已发布，iab 正式线上双人对局通过。实际用户设备留待用户刷新确认。
