# 远行 Roam · 微信旅行助手

面向微信小程序的旅行助手，支持流式聊天、工具进度、历史会话，以及本地收藏、旅行偏好和行程草稿。系统架构参考 [Jevon-Zhong/agent-trip-planner](https://github.com/Jevon-Zhong/agent-trip-planner)。

当前主入口为 `miniapp/`，后端为 `backend/`。Expo 移动端及独立移动端预览已删除。已有 Taro + React 页面继续使用，后端采用 FastAPI、WebSocket、LangGraph、SQLAlchemy 和 PostgreSQL，本地开发兼容 SQLite。

本项目在 [aymen-000/travel_agent](https://github.com/aymen-000/travel_agent) 的基础上开发，微信小程序架构与对话交互参考 [Jevon-Zhong/agent-trip-planner](https://github.com/Jevon-Zhong/agent-trip-planner)。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `miniapp/src/pages` | 助手、行程、收藏、我的 |
| `miniapp/src/domain` | 小程序业务逻辑与数据类型 |
| `miniapp/src/stores` | 页面状态与动作 |
| `miniapp/src/services` | 微信平台适配、聊天与历史接口 |
| `backend/app/api`、`schemas` | HTTP / WebSocket 接口与参数校验 |
| `backend/app/services` | 聊天生命周期、上下文、取消和恢复 |
| `backend/app/graphs` | LangGraph 规划、专业助手和最终回复 |
| `backend/app/repositories`、`models` | 会话仓库与数据表 |
| `backend/app/core`、`tools` | 模型、数据库配置和只读工具目录 |
| `src/tools` | 原项目旅行查询工具，按需复用 |

分层和参考项目差异见 [架构说明](docs/architecture.md)，微信导入及真机操作见 [小程序说明](miniapp/README.md)。

## 运行微信小程序

需要 Node.js 20+。在仓库根目录执行：

```sh
cd miniapp
npm ci
npm run build:weapp
```

微信开发者工具导入 `miniapp`，入口配置为 `dist/`；该入口默认游客 AppID，手机预览需换成自己的 AppID。已经导入仓库根目录 `travel_agent` 的，可继续使用根目录项目配置，它指向 `miniapp/dist/`，沿用你填写的 AppID。

默认进入「真实服务」，电脑模拟器直接连接 `http://127.0.0.1:8000`，发送消息即通过后端调用已配置的模型，无需先进入设置。也可在「我的 → 旅行服务」主动切换到带明确标记的示例模式。

## 运行聊天后端

需要 Python 3.11+。在仓库根目录执行：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-miniapp.txt
.venv/bin/python -m backend.app
```

首次使用时将 `.env.chat.example` 复制为 `.env` 并填写自己的配置；已有 `.env` 时合并所需配置，保留原密钥。

启动入口默认监听 `0.0.0.0:8000`，沿用原来的端口。需要调整时使用 `--host`、`--port` 参数；原 Uvicorn 启动命令仍可使用。

- 大模型：配置 `TRAVEL_API_KEY` 或 `DASHSCOPE_API_KEY`，模型默认 `qwen-plus`。可用 `TRAVEL_API_BASE` 指定兼容服务。使用 Together 时移除该 base 并按模板配置。
- 百度地图：填写**服务端类型** `BAIDU_MAP_AK`。`BAIDU_MAP_TRANSPORT=mcp` 使用百度托管的 Streamable HTTP，后端发现工具后加入 LangGraph；`webapi` 切回原来的直接 API 工具。未设置 transport 的旧配置继续使用 Web API。MCP 只传 AK；`BAIDU_MAP_SK` 仅用于直接 Web API 的 SN 校验。地点信息不能代替房态或实时预订报价。
- 航班/酒店报价：原有工具需要 `AMADEUS_CLIENT_ID`、`AMADEUS_CLIENT_SECRET`，只有两项都填写时才加入聊天工具集。Amadeus 官网已有旧 Self-Service 门户停用提示，新接入应先核实供应商准入。未配置时助手明确说明无法查询，不尝试空凭据请求。
- PostgreSQL：设置 `DATABASE_URL=postgresql+psycopg://用户名:密码@主机:5432/数据库名`。密码中的特殊字符需 URL 编码。
- 本地数据库：不设置 `DATABASE_URL` 时使用 `.data/chat.sqlite3`；可用 `TRAVEL_CHAT_DB` 改路径。已有本地会话仍可读取。

### 可选 PostgreSQL 容器

安装并启动 Docker，在 `.env` 中填写 `POSTGRES_PASSWORD`，再执行：

```sh
docker compose up -d postgres
```

容器的用户、数据库名默认都是 `roam`，端口只绑定电脑 `127.0.0.1:5432`。将 `DATABASE_URL` 指向该数据库即可。数据保存在 Docker 命名卷中；修改初始密码变量不会修改已初始化数据库的密码。切换数据库不会自动搬迁已有 SQLite 会话。

小程序默认直接连接本机后端；旧版的默认示例模式和占位地址会自动升级，已配置的真实服务地址、行程、收藏与历史仍保留。更换后端时在「我的 → 旅行服务」修改地址。正式环境配置 HTTPS、WSS 及微信合法域名。手机上的 `127.0.0.1` 或 `localhost` 指手机自己，真机测试需改为电脑局域网地址或可访问的 HTTPS 服务。

「行程 → 地点地图」可按城市和关键词查询并显示地点。该入口由后端调用百度地点检索 Web API 和官方坐标转换 API，将 BD-09 转换为微信地图使用的 GCJ-02；转换失败时不显示未经转换的坐标。服务端 AK 需要开通这两项服务，使用 SN 校验时还需配置 SK。该入口独立于 MCP。AI 回复和已保存行程另支持按天地图、同名地点确认、步行/驾车/公交路线与分段重试；路线也需要开通对应 Web API 权限。

### 百度 MCP 配置与自检

在[百度地图控制台](https://lbsyun.baidu.com/apiconsole/key)新建服务端应用，启用 `MCP(SSE)` 及地点、地理编码、行政区划、国内天气、路线等需要的查询服务。小程序类型 AK 不能代替服务端 AK。按控制台说明配置合理的请求校验和白名单；保留应用现有安全限制，不使用全网白名单来绕过校验。

```dotenv
BAIDU_MAP_AK=你的服务端AK
BAIDU_MAP_TRANSPORT=mcp
```

后端自动拼接官方地址 `https://mcp.map.baidu.com/mcp?ak=...`，密钥不写进小程序。修改 `.env` 后重启后端。连接及一次天气查询可以分别检查：

```sh
.venv/bin/python -m backend.app.check_mcp
.venv/bin/python -m backend.app.check_mcp --district-id 420106
```

工具列表可读取不代表业务鉴权通过，必须以实际工具返回数据为准。若百度返回“自动开通 MCP（SSE）服务失败”，在控制台检查该 AK 的服务状态；若已启用仍开通超时，应向百度排查开通状态，不重复消耗模型调用。代码仅加载只读查询工具，不开放生成分享地图等工具。

官方说明：[百度 MCP 快速开始](https://lbs.baidu.com/docs/ai?title=mcpserver/quickstart)。

## 聊天接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/v1/chat/devices` | 创建当前安装的访问凭证 |
| `WS /api/v1/chat/ws` | 流式聊天与公开工具进度 |
| `GET /api/v1/chat/conversations?agent=team` | 当前安装的会话列表 |
| `GET /api/v1/chat/conversations/{id}` | 会话内容 |
| `DELETE /api/v1/chat/conversations/{id}` | 删除会话 |
| `POST /api/v1/map/places` | 查询地点并转换为小程序地图坐标 |
| `POST /api/v1/map/resolve` | 批量查询当天地点，保留候选与部分错误 |
| `POST /api/v1/map/routes` | 查询真实 GCJ-02 路径，可只重试指定路段 |
| `POST /api/v1/trips/adjust-day` | 为选中的单日活动生成替换建议，由小程序预览后保存 |
| `POST /api/v1/chat/requests/{id}/cancel` | 断线时仍可停止当前安装的请求 |

历史接口使用 Bearer 凭证；WebSocket 首条 `start` 消息携带凭证。事件包括 `accepted/status/delta/final/artifact/done/error/cancelled` 和心跳。业务事件携带递增 `seq`；断线重连使用相同请求编号与 `after_seq` 补发遗漏事件，已完成结果从数据库回放。主动停止才取消任务；进程重启后的未完成任务会明确提示中断。部署当前使用单个 Uvicorn worker。详见[行程地图与异常恢复](docs/map-and-resilience.md)。

小程序通过聊天服务访问旅行助手。

## 验证

```sh
cd miniapp
npm test
npm run typecheck
npm run build:weapp
npm run check:dist
npm run check:runtime
```

后端测试在仓库根目录执行，测试依赖另装：

```sh
.venv/bin/python -m pip install pytest pytest-asyncio httpx pgserver==0.1.4
.venv/bin/python -m pytest -q tests/test_chat_api.py tests/test_chat_runner.py tests/test_chat_storage.py tests/test_baidu_maps.py tests/test_baidu_mcp.py tests/test_chat_resilience.py tests/test_itinerary_map.py
```

`pgserver` 仅提供临时 PostgreSQL 测试实例所需的二进制，不访问用户数据库，也不属于生产运行依赖。未安装、平台不适用或主机沙箱禁止创建共享内存时，实际 PostgreSQL 测试会明确跳过。测试涵盖连接协议、所有权、取消、重试、旧 SQLite 兼容和数据库并发。本次环境的 PostgreSQL 实例启动被共享内存权限拦截，尚未完成实库连接验证。

百度地图鉴权排查：220 表示 Referer 校验失败，后端应新建服务端类型 AK；210 表示服务器出口 IP 未通过应用白名单校验；211 表示 SN 校验失败，检查 SK；240 表示尚未启用对应 API。日志和公开工具错误不会显示带 AK 的请求 URL。

当前身份按小程序安装隔离，尚未接入微信账号登录或跨设备同步。百度 MCP 已接入后端工具目录，业务查询仍取决于应用权限、服务开通与网络。地点地图支持手动检索、按天行程地点和真实路线；路线失败时保留地点与成功路段。高铁余票、语音尚未接入。手机微信效果需要独立验证；自动化页面挂载不能替代真机检查。


行程日常使用：支持编辑已保存行程的日期、人数、计划预算与备注；实际查询地点可收藏并加入指定一天，也可复制当前行程分享。详见[行程信息与地点收藏](docs/trip-and-place-workflows.md)。
