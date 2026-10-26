from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect

from backend.app.core.errors import ChatError
from backend.app.schemas.chat import Agent, StartMessage
from backend.app.services.chat import ChatService, get_chat_service

logger = logging.getLogger(__name__)


def create_chat_router(service: ChatService | None = None):
    router = APIRouter()

    def current_service():
        return service or get_chat_service()

    def owner(authorization: str = Header(default='')):
        try:
            return current_service().authenticate(authorization.removeprefix('Bearer '))
        except ChatError as error:
            raise HTTPException(error.code, str(error)) from error

    @router.post('/devices')
    def create_device():
        return {'token': current_service().create_device(), 'identity': 'installation'}

    @router.get('/conversations')
    def conversations(agent: Agent | None = None, identity: str = Depends(owner)):
        return {'conversations': current_service().list_conversations(identity, agent)}

    @router.get('/conversations/{conversation_id}')
    def conversation(conversation_id: str, identity: str = Depends(owner)):
        try:
            return current_service().get_conversation(identity, conversation_id)
        except ChatError as error:
            raise HTTPException(error.code, str(error)) from error

    @router.delete('/conversations/{conversation_id}')
    def delete_conversation(conversation_id: str, identity: str = Depends(owner)):
        try:
            current_service().delete_conversation(identity, conversation_id)
            return {'deleted': True}
        except ChatError as error:
            raise HTTPException(error.code, str(error)) from error

    @router.websocket('/ws')
    async def chat(socket: WebSocket):
        await socket.accept()
        task = receiver = None
        try:
            try:
                first = await asyncio.wait_for(socket.receive_json(), timeout=10)
                request = StartMessage.model_validate(first)
            except (ValueError, TypeError) as error:
                raise ChatError('聊天请求格式无效', 422) from error

            async def produce():
                async with contextlib.aclosing(current_service().stream(request)) as events:
                    async for event in events:
                        await socket.send_json(event)

            async def listen():
                while True:
                    message = await socket.receive_json()
                    if isinstance(message, dict) and message.get('type') == 'cancel':
                        return

            task = asyncio.create_task(produce())
            receiver = asyncio.create_task(listen())
            done, _ = await asyncio.wait([task, receiver], return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                await task
            else:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                # Propagate a disconnected socket before trying to send a cancellation acknowledgement.
                await receiver
                await socket.send_json({'type': 'cancelled'})
        except WebSocketDisconnect:
            pass
        except ChatError as error:
            with contextlib.suppress(Exception):
                await socket.send_json({'type': 'error', 'message': str(error), 'code': error.code})
        except TimeoutError:
            with contextlib.suppress(Exception):
                await socket.send_json({'type': 'error', 'message': '等待旅行服务超时，请重试', 'code': 504})
        except Exception:
            logger.exception('Travel chat request failed')
            with contextlib.suppress(Exception):
                await socket.send_json({'type': 'error', 'message': '旅行服务暂不可用，请检查后端模型和工具配置', 'code': 503})
        finally:
            for pending in (task, receiver):
                if pending and not pending.done():
                    pending.cancel()
            for pending in (task, receiver):
                if pending:
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await pending
            with contextlib.suppress(Exception):
                await socket.close()

    return router
