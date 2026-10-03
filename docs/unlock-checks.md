# 私有免费解锁检测

MiSub 负责节点管理、D1 任务与结果、管理员页面展示；独立私有 GitHub 仓库运行 Mihomo 和四个平台的低成本探针。既有转换引擎、节点排序、订阅内容不变，不同步上游代码，不启用 Pages 自动部署。

## 初始化

1. 创建私有检测仓库并上传检测脚本与仅支持 schedule/workflow_dispatch 的工作流。
2. 生成一个至少 32 字符的随机专用密钥，在 Cloudflare Pages **生产环境 secret** 设置 `UNLOCK_RUNNER_TOKEN`，同时在私有仓库 Actions secrets 中设置同名密钥。
3. Cloudflare 环境变量 `UNLOCK_RUNNER_REPO` 填私有仓库 `owner/name`，供管理员查看运行器；GitHub secret `MISUB_URL` 填 MiSub HTTPS 根域名。
4. 仅部署本次 fork 修改，不开启原作者同步。
5. 手动节点 → 检测设置：选择平台和分组，启用检测，默认 12 小时。首次在私有仓库 Actions 手动运行并验收。

使用已有 `MISUB_DB` 绑定，首次请求自动创建独立的 `unlock_settings`、`unlock_jobs`、`unlock_results` 表，不修改 subscriptions 或 profiles。关闭检测即停止导出配置；撤销密钥可彻底阻止运行器访问。

## 接口与隐私

管理员会话接口：GET/POST `/api/unlock/settings`、GET `/api/unlock/results`、POST `/api/unlock/queue`。

运行器只能 POST `/api/unlock/runner/claim` 和 `/api/unlock/runner/results`，使用专用 Bearer secret；不使用管理员密码／管理 API key。领取任务仅返回启用且在允许分组内的手动节点的临时代理参数。不支持协议明确显示无法检测。不接受待测节点 URL、任意检测目标或可执行脚本。

节点参数用 SHA-256 指纹关联，运行期间变更参数会拒绝旧结果；页面标记历史结果过期。结果仅允许固定状态、两位地区代码和固定原因码，丢弃任意 HTML、错误信息、密码和 URL。仅保留最近 30 天任务与最新节点结果。

私有工作流没有 push/PR trigger、附件上传、节点日志或缓存；checkout 固定提交，核心固定版本与校验和。检测脚本没有目标站点的 TLS 校验绕过。节点参数仍需交给 GitHub 运行器，因此无法承诺零泄露风险；账号与依赖安全仍需维护。

## 结果边界与免费额度

Netflix 标记仅用于疑似地区可用性，不保证会员播放；YouTube Premium 不等于无广告，识别 CN 仅提示疑似送中；OpenAI 区分两个入口但不能保证登录／聊天；Claude 公开首页只能标记入口可达。验证码和意外页面按未知处理。

GitHub 私有标准运行器消耗账户免费分钟额度，每小时轮询也计时。12 小时为推荐间隔；不得设置允许超额付费的预算。高节点数或改成每小时检测可能耗尽免费额度，此时结果保持历史值，不能承诺无上限免费运行。定时执行可能延迟。

IPv6-only 节点受实际运行器网络限制，运行器没有 IPv6 时显示 `ipv6_unavailable`，不代表节点坏了。解锁检测的访问路径始终为运行器 → 节点 → 目标平台，没有直连回退，也不占你家软路由 CPU。
