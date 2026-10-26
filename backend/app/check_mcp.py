"""Run `python -m backend.app.check_mcp [--district-id 420106]` from the repo."""

import argparse
import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.tools import ToolException

from backend.app.services.baidu_mcp import BaiduMCP


async def check(district_id):
    client = BaiduMCP()
    try:
        tools = await client.discover()
        print(json.dumps({'connected': True, 'tools': [tool.name for tool in tools]}, ensure_ascii=False))
        if district_id:
            result = await client.call('map_weather', {'district_id': district_id})
            print(json.dumps({'weather_query_succeeded': True, 'result': result}, ensure_ascii=False))
        return 0
    except ToolException as error:
        print(json.dumps({'query_succeeded': False, 'message': str(error)}, ensure_ascii=False))
        return 1


def main():
    parser = argparse.ArgumentParser(description='验证百度 MCP 连接；可选一次行政区天气查询，不显示密钥。')
    parser.add_argument('--district-id', help='已确认的六位行政区代码，例如武汉市武昌区 420106')
    args = parser.parse_args()
    if args.district_id and (len(args.district_id) != 6 or not args.district_id.isascii() or not args.district_id.isdigit()):
        parser.error('--district-id 必须是六位数字')
    load_dotenv(Path(__file__).resolve().parents[2] / '.env')
    raise SystemExit(asyncio.run(check(args.district_id)))


if __name__ == '__main__':
    main()
