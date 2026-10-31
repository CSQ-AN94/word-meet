# Supabase 注册与接入

项目所有者注册一次即可，玩游戏的人无需注册。游戏网页继续使用原来的 GitHub Pages 地址。

## 1. 注册并创建免费项目

1. 打开 [Supabase 注册页](https://supabase.com/dashboard/sign-up)，选择 **Continue with GitHub**，用现有 GitHub 账号登录并完成授权。
2. 如果提示创建组织，选择 **Free** 套餐。
3. 点击 **New project**，项目名填写 `word-meet`。
4. 设置并保存数据库密码；地区选择离玩家较近的亚洲地区，例如新加坡。密码由你自己保管，不需要发给协作者。
5. 创建项目，等待状态变为可用。

注册、服务条款、邮箱验证和新密码需要你本人完成。其余配置与发布可交给协作者。

## 2. 选择一种接入方法

### 方法 A：授权 Supabase 插件

在 Codex 中添加 Supabase 插件并完成账号授权，再告诉协作者项目名是 `word-meet`。协作者可通过连接工具查找项目、运行初始化脚本、读取公开项目 URL/key 并更新网页。已有同名项目时，先确认目标项目 ID，避免操作别的项目。

这是推荐方式，不需要在聊天中传输数据库密码、管理员密钥或访问令牌。

### 方法 B：自行运行一次初始化脚本

1. 打开新项目左侧 **SQL Editor → New query**。
2. 完整复制 [supabase/setup.sql](../supabase/setup.sql)，粘贴后点击 **Run**。脚本可重复执行，不会清空已有房间。
3. 打开 **Connect** 或项目设置的 **Data API / API Keys**，找到项目 URL 与 **Publishable key**。旧项目也支持角色为 `anon` 的旧版公开 key。
4. 只把这两项公开配置发给协作者，或填入 `src/config.js`：

```js
export const SUPABASE_URL = 'https://你的项目标识.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_这里填公开key';
```

publishable key 是设计给网页使用的公开配置：[官方说明](https://supabase.com/docs/guides/api/api-keys)。不要填写 `sb_secret_...`、`service_role`、数据库密码或个人访问令牌；客户端会拒绝管理员 key。

## 3. 验证并发布

协作者完成以下检查后，更新 GitHub Pages：

- 用公开 key 调用 `word_meet` 的 `health` 动作，确认初始化生效。
- 创建测试房间，两个同时加入请求只能成功一个；退出房主后清理测试房间。
- 公开 key 无法直接读取私有表；无席位令牌不能读取或发送房间消息。
- 内置浏览器验证创建、邀请加入和双方锁词；再由实际 Safari 与同学设备跨网络确认。

发布后仍使用 [原游戏入口](https://csq-an94.github.io/word-meet/)。两人刷新并新建房间，旧版房间码不通用。

## 免费项目暂停

免费项目一周低活动后可能暂停。若后台显示 **Paused**，项目所有者点击 **Restore / Resume**，等待恢复后重新打开游戏。这是免费服务的限制：[官方说明](https://supabase.com/docs/guides/platform/free-project-pausing)。
