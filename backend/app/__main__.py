"""本地启动入口：python -m backend.app，默认沿用 8000 端口。"""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="启动旅行助手真实聊天后端")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    args = parser.parse_args()
    # 模型及地图配置由服务端加载，不写入小程序编译包。
    uvicorn.run("backend.app.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
