# Supabase 联机接入

用户已选择 Supabase 免费托管，网页继续使用现有 GitHub Pages，玩法和文案不改。两台设备各自通过 HTTPS 访问 Supabase，房间最多两人，不要求玩家注册。

复用现有承诺值锁词、同时揭晓、消息去重与断线重试协议。使用 Supabase 自带的 PostgREST RPC 和 PostgreSQL 保存房间与消息，每次操作在数据库事务中锁定房间行。短轮询适合回合制文字游戏，也不要求网络支持 WebSocket。

房间数据放在未公开的独立 schema，启用 RLS 并撤销浏览器角色直接读写权限；唯一公开函数按随机席位令牌鉴权。浏览器只配置项目 URL 和 publishable key，禁止使用 secret/service_role key。初始化脚本可重复执行且保留已有房间。

用户自行完成 Supabase 注册、服务条款确认和项目创建。优先通过已连接的 Supabase 插件完成数据库初始化和读取公开配置；否则提供一次性 SQL Editor 步骤。配置完成并验证公开接口前不切换 GitHub Pages。

取代：PeerJS 直连、ChatGPT Sites 房间服务、Render 部署计划。Supabase 免费项目可能因低活动暂停，需在文档说明恢复办法。
