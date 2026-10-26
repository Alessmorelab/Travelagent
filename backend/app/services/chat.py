from __future__ import annotations

import asyncio
from contextlib import aclosing
from functools import lru_cache

from backend.app.core.errors import ChatError
from backend.app.repositories.chat import ChatRepository
from backend.app.schemas.chat import StartMessage


class ChatService:
    """Conversation ownership, retries and stream lifecycle; independent of WebSocket."""

    def __init__(self, repository: ChatRepository, runner=None):
        self._repository = repository
        self.runner = runner

    def close(self):
        self._repository.close()

    def create_device(self):
        return self._repository.create_device()

    def authenticate(self, token: str):
        return self._repository.authenticate(token)

    def list_conversations(self, identity: str, agent: str | None):
        return self._repository.list(identity, agent)

    def get_conversation(self, identity: str, conversation_id: str):
        return self._repository.detail(identity, conversation_id)

    def delete_conversation(self, identity: str, conversation_id: str):
        self._repository.delete(identity, conversation_id)

    async def stream(self, request: StartMessage):
        repo = self._repository
        identity = await asyncio.to_thread(repo.authenticate, request.token)
        model_query = request.query + ('\n\n[旅行偏好仅供参考；当前问题的明确要求优先]\n' + request.preferences if request.preferences else '')
        turn, replay = await asyncio.to_thread(repo.begin, identity, request.agent, request.conversation_id,
                                              request.request_id, request.query, model_query)
        content = ''
        complete = replay
        try:
            yield {'type': 'accepted', 'conversation_id': turn['conversation_id'], 'request_id': request.request_id}
            if replay:
                for step in await asyncio.to_thread(repo.progress, turn['id']):
                    yield {'type': 'status', **step}
                yield {'type': 'final', 'content': turn['response']}
                yield {'type': 'done', 'conversation_id': turn['conversation_id']}
                return
            history = await asyncio.to_thread(repo.context, turn['conversation_id'], turn['id'])
            execute = self.runner
            if execute is None:
                from backend.app.graphs.travel import stream_travel
                execute = stream_travel
            async with asyncio.timeout(120):
                async with aclosing(execute(request.agent, history, model_query)) as events:
                    async for event in events:
                        kind = event.get('type')
                        if kind == 'delta':
                            content += event.get('content', '')
                        elif kind == 'final':
                            content = event.get('content', '')
                        elif kind == 'status':
                            step = await asyncio.to_thread(repo.record_step, turn['id'], event)
                            if step:
                                yield {'type': 'status', **step}
                            continue
                        if kind in {'delta', 'final'}:
                            yield event
                if not content.strip():
                    raise ChatError('旅行助手返回了空回复，请重试', 502)
                await asyncio.to_thread(repo.finish, turn['id'], content, 'complete')
                complete = True
                yield {'type': 'done', 'conversation_id': turn['conversation_id']}
        finally:
            if not complete:
                await asyncio.to_thread(repo.finish, turn['id'], content, 'interrupted')


@lru_cache(maxsize=1)
def get_chat_service():
    # No database or model is opened merely by importing the API application.
    return ChatService(ChatRepository())
