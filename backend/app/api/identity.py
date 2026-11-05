"""异步接口共用的小程序安装身份校验。"""

import asyncio

from fastapi import HTTPException

from backend.app.core.errors import ChatError
from backend.app.services.chat import get_chat_service


async def authenticated(authorization: str) -> str:
    try:
        return await asyncio.to_thread(get_chat_service().authenticate, authorization.removeprefix('Bearer '))
    except ChatError as error:
        raise HTTPException(error.code, str(error)) from error
