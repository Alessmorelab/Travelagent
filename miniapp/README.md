# 远行 Roam · 微信小程序

Taro 4.3 + React 18 + TypeScript，接入现有 FastAPI / LangGraph 旅行助手。四个原生小程序页面：助手、行程、收藏、我的。保留米白、森林绿与目的地图片的设计。

## 直接导入体验

本目录的 `dist/` 是编译后的微信小程序。安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，选择「导入项目」：

1. **项目目录：本目录 `miniapp`**。
2. 项目配置已设置 `miniprogramRoot: "dist/"`，工具会加载编译产物。
3. 还没有小程序 AppID 时，可以先用工具提供的游客/测试模式查看模拟器。默认 `touristappid` 仅为游客配置，不能承诺支持真机预览、上传或发布。
4. 真机测试：在 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序并获取自己的 AppID，在项目详情中替换 AppID，或修改本目录 `project.config.json` 的 `appid`。当前登录微信需具备该小程序的开发者权限。
5. 点击「预览」，使用手机微信扫描二维码。发布前还需按微信当前后台要求完成相关配置与审核。

如果已经将仓库根目录 `travel_agent` 导入开发者工具，也可以继续使用：根目录的 `project.config.json` 已将 `miniprogramRoot` 指向 `miniapp/dist/`。该入口沿用你在开发者工具中填写的 AppID；修改配置后重新编译即可。不要将源码目录 `miniapp/src` 作为小程序根目录。

默认进入「灵感预览」。无需 Python 服务、无需模型密钥，可体验四个页面、逐步显示的示例对话、历史对话、收藏、旅行偏好、日期选择、草稿创建和完成进度。目的地图片使用外部 HTTPS 资源；资源加载失败时显示有色背景和目的地名称，功能仍可使用。

助手页以连续对话为主入口，新对话默认由团队助手自动分配任务。底部支持多行输入、生成期间编辑下一条草稿、停止回复和复制答案；标题、加粗、列表、表格及代码按富文本显示。查询过程默认折叠，向上阅读历史时暂停跟随输出，点击「最新消息」返回底部。旅行偏好、行程草稿和目的地灵感位于输入框的「＋」菜单；历史入口仍可查看原有专业助手的对话。

## 日常开发

```sh
cd miniapp
npm ci
npm run dev:weapp
```

保持终端运行，在微信开发者工具里查看变化。生成可导入的编译包：

```sh
npm run typecheck
npm test
npm run build:weapp
npm run check:dist
npm run check:runtime
```

需要 Node.js 20 或更新版本。`package-lock.json` 固定本次验证过的依赖。

编译脚本先运行 Taro 自带的本地配置 schema 校验，再调用编译器，避免配置校验器在用户目录创建全局缓存。`--no-check` 仅跳过重复的 CLI 包装校验；独立的配置校验仍必须通过。

## 连接真实旅行服务

使用 Python 3.11 或更新版本。在仓库根目录安装小程序聊天后端依赖，参考 `.env.chat.example` 将模型和旅行接口配置合并到自己的 `.env`：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-miniapp.txt
.venv/bin/python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

在小程序「我的 → 旅行服务」填写后端地址，测试连接，再保存「真实服务」模式。默认 `https://api.example.com` 只是地址占位符，需要替换为你的服务地址。

正式接入时为后端提供有效 HTTPS 地址，并在小程序后台配置 request 合法域名与 WebSocket 的 socket 合法域名（WSS）。真机不能用 `localhost` 访问电脑。开发阶段使用电脑局域网地址时，请按照微信开发者工具当前提供的调试方式配置；该方式不能当成上线配置。连接测试只确认 API 可访问，并不代表大模型和旅行供应商凭据全部有效。

小程序真实聊天使用新增接口：

| 功能 | 接口 |
| --- | --- |
| 获取当前安装的访问凭证 | `POST /api/v1/chat/devices` |
| 流式聊天 | `WS /api/v1/chat/ws` |
| 历史列表 | `GET /api/v1/chat/conversations?agent=team` |
| 打开或删除对话 | `GET / DELETE /api/v1/chat/conversations/{id}` |

每个助手独立保存会话 ID。旅行偏好仅在用户主动保存偏好或创建行程草稿后随聊天发送；初始京都示例不会作为真实需求发送，旧版自动保存的默认示例也会被排除。真实聊天由 `Taro.connectSocket` 接收 `accepted/status/delta/final/done/error` 事件，过程面板显示公开的任务和工具进度，不展示规划模型的内部推理。后端仅发布最终回复模型的文本，并过滤跨分片的推理标记；支持的千问混合思考模型使用直接回答模式。小程序等待上限为 130 秒，以接收后端 120 秒处理上限内的结果或错误。停止等待会发送取消信号并关闭连接；底层同步第三方工具会受请求超时限制，未必能立即中止已发出的外部请求。

修改后端回答策略后需要重启 Python 服务；在开发者工具点击「编译」只会刷新小程序代码。验证新策略时使用「新对话」发送新消息，已完成请求的「重试」会按原请求编号重放保存的结果。

「新对话」保留旧记录；「历史」和「我的 → 历史对话」可以重新打开或删除。示例历史保存在设备本地（最多十份归档）。真实历史写入后端数据库：部署环境使用 PostgreSQL，配置 `DATABASE_URL`；未配置时使用本地 SQLite（默认 `.data/chat.sqlite3`，可用 `TRAVEL_CHAT_DB` 设置）。已有 SQLite 会话仍兼容，切换数据库不会自动搬迁旧数据。后端重启后仍可读取当前数据库的历史。对已完成请求使用同一请求编号重试时，会返回保存的结果，不再次调用模型；中断后的重试可能重新调用模型。

当前安装凭证由后端随机生成并在客户端保存，以隔离不同安装的历史；该机制不是微信登录。清除小程序缓存会丢失访问原历史的设备凭证。当前不提供账号级同步；面向公开服务时还需接入微信登录鉴权、额度与限流。凭证不放在 WebSocket URL 中，所有模型密钥只保留在服务端。

原有四个 `POST /api/v1/{team,flights,hotels,destinations}/search` 接口保留供旧网页使用。新聊天使用独立的异步 LangGraph 规划、专业工具查询和最终回复节点，不依赖原有内存会话。Expo 工程与独立移动端预览已移除，小程序源码和测试均在本目录内。

## 代码与保存方式

- `src/pages/`：四个页面。
- `src/components.tsx`：目的地详情、偏好和服务设置弹层等。
- `src/services/wechat.mjs`：微信请求、取消信号、地址校验与存储适配。
- `src/stores/travel.ts`：连接业务逻辑、网络服务与小程序页面导航。
- `src/services/chat-client.mjs`：WebSocket 聊天、访问凭证与服务端历史接口。
- `src/chat-components.tsx`：对话消息、多行输入、折叠查询进度和历史记录面板。
- `src/domain/message-format.mjs`：回复排版，转义原始 HTML，支持常用 Markdown 文本格式。
- `src/domain/travel.mjs`：小程序自己的旅行数据、会话、收藏与行程业务逻辑。
- `config/index.ts`、`project.config.json`：编译和微信开发者工具配置。

收藏、偏好和行程保存在当前小程序的本地缓存中。当前没有微信登录、账号、设备间同步、支付或真实预订。点击「新建行程草稿」生成带明确标注的草稿，不会把聊天回复自动当成核实过的结构化行程。

## 验证边界

小程序检查包括 Taro 微信端编译、官方内置配置 schema 校验、TypeScript 检查、产物完整性检查、编译后的 App 与四个页面在模拟微信环境中注册和挂载。小程序全部测试统一使用 `npm test`；后端测试 `python -m pytest -q tests/test_chat_api.py tests/test_chat_runner.py tests/test_chat_storage.py tests/test_baidu_maps.py`（仓库根目录，测试环境另装 pytest、pytest-asyncio、httpx；实际 PostgreSQL 测试另装 `pgserver==0.1.4`，缺少依赖或沙箱限制共享内存时该项明确跳过）。本机尚未完成 PostgreSQL 实库连接验证。

自动测试覆盖微信接口包装、HTTP 错误、请求取消、超时、域名错误、本地恢复，以及缺少浏览器全局对象时运行领域逻辑。模拟接口返回仅验证客户端契约，模拟页面挂载不能替代原生布局或设备 API 检查。当前电脑已安装微信开发者工具，已修正根目录导入配置并成功生成预览二维码；真实供应商调用与手机微信效果仍需分别验证。

参考：[Taro 编译与微信开发者工具导入](https://docs.taro.zone/docs/GETTING-STARTED/)。

系统以 [Jevon-Zhong/agent-trip-planner](https://github.com/Jevon-Zhong/agent-trip-planner) 为架构参考，采用小程序、FastAPI、WebSocket、LangGraph 和 PostgreSQL 的前后端分离方案。现有小程序继续使用 Taro + React，未迁移到其 Vue/Uni-app 技术栈。分层职责、差异和后续扩展见 [架构说明](../docs/architecture.md)。百度地点、国内天气和路线支持后端 MCP 与直接 Web API 两种接入，需填写服务端 AK、开通查询权限并通过实际业务验证；小程序内尚未绘制地图。微信账号登录、高铁余票和语音尚未接入。
