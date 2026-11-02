"""Keep a bounded chat task alive across transient WebSocket disconnects.

One Uvicorn worker owns these tasks. Completed events are durable; a process
restart reports an interrupted task rather than pretending computation resumed.
"""
from __future__ import annotations

import asyncio
from contextlib import aclosing, suppress
from dataclasses import dataclass, field
import time

from backend.app.core.errors import ChatError
from backend.app.core.failures import failure_for


async def coalesce(events):
    """First text immediately, then at most one text frame per 50 ms/128 chars."""
    pending = None
    buffer = ''
    first = True
    try:
        pending = asyncio.create_task(anext(events))
        while True:
            done, _ = await asyncio.wait([pending], timeout=0.05 if buffer else None)
            if not done:
                yield {'type': 'delta', 'content': buffer}
                buffer = ''
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                break
            pending = asyncio.create_task(anext(events))
            if event.get('type') == 'delta' and not first:
                buffer += event.get('content', '')
                if len(buffer) >= 128:
                    yield {'type': 'delta', 'content': buffer}
                    buffer = ''
            else:
                if buffer:
                    yield {'type': 'delta', 'content': buffer}
                    buffer = ''
                yield event
                if event.get('type') == 'delta':
                    first = False
        if buffer:
            yield {'type': 'delta', 'content': buffer}
    finally:
        if pending:
            pending.cancel()
            with suppress(asyncio.CancelledError, StopAsyncIteration, Exception):
                await pending


@dataclass
class Run:
    request: object
    events: list = field(default_factory=list)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    turn_id: str | None = None
    done: bool = False
    started: float = field(default_factory=time.monotonic)


class ChatRuns:
    def __init__(self, service, heartbeat=10, max_active=8):
        self.service = service
        self.registry = {}
        self.lock = asyncio.Lock()
        self.heartbeat = heartbeat
        self.max_active = max_active

    @staticmethod
    def signature(request):
        return (request.agent, request.query, request.preferences)

    async def subscribe(self, request):
        repo = self.service._repository
        owner = await asyncio.to_thread(repo.authenticate, request.token)
        key = (owner, request.request_id)
        async with self.lock:
            run = self.registry.get(key)
            if run and (self.signature(run.request) != self.signature(request) or (
                    request.conversation_id and run.events and request.conversation_id != run.events[0].get('conversation_id'))):
                raise ChatError('重试内容与原请求不一致，请开启新消息', 409)
            # A deliberate manual retry after cancellation/error starts over.
            if run and run.done and not request.resume and run.events[-1]['type'] != 'done':
                self.registry.pop(key)
                run = None
            if run is None:
                previous = await asyncio.to_thread(repo.find_request, owner, request.request_id)
                model_query = request.query + ('\n\n[旅行偏好仅供参考；当前问题的明确要求优先]\n' + request.preferences if request.preferences else '')
                if previous:
                    # Ownership is established by find_request's join.
                    conversation = await asyncio.to_thread(repo.get_agent, owner, previous['conversation_id'])
                    if previous['query'] != request.query or previous['model_query'] != model_query or conversation != request.agent or (
                            request.conversation_id and request.conversation_id != previous['conversation_id']):
                        raise ChatError('重试内容与原请求不一致，请开启新消息', 409)
                if previous and previous['status'] == 'complete':
                    events = await asyncio.to_thread(repo.events, previous['id'])
                    if not events or events[-1]['type'] != 'done':
                        while events and events[-1]['type'] in {'error', 'cancelled'}:
                            events.pop()
                        payload = await asyncio.to_thread(repo.payload, previous['id'])
                        if not events:
                            events = [{'type': 'accepted', 'conversation_id': previous['conversation_id'], 'request_id': request.request_id}]
                        if payload and not any(event['type'] == 'artifact' for event in events):
                            events.append({'type': 'artifact', **payload})
                        if not any(event['type'] == 'final' for event in events):
                            events.append({'type': 'final', 'content': previous['response']})
                        events.append({'type': 'done', 'conversation_id': previous['conversation_id']})
                        events = [{**event, 'seq': index + 1} for index, event in enumerate(events)]
                    run = Run(request, events=events, done=True, turn_id=previous['id'])
                else:
                    if previous and previous['status'] == 'pending':
                        events = await asyncio.to_thread(repo.events, previous['id'])
                        content = ''
                        for event in events:
                            if event['type'] == 'delta':
                                content += event.get('content', '')
                            elif event['type'] == 'final':
                                content = event.get('content', '')
                        await asyncio.to_thread(repo.finish, previous['id'], content, 'interrupted')
                    if request.resume:
                        raise ChatError('原任务已中断或服务已重启，请点击重试重新查询', 409)
                if run is None:
                    if sum(not item.done for item in self.registry.values()) >= self.max_active:
                        raise ChatError('服务正在处理较多请求，请稍后重试', 429)
                    run = Run(request)
                    run.task = asyncio.create_task(self._produce(run, owner))
                # Completed runs can be restored from the database after eviction.
                for old in list(self.registry):
                    if len(self.registry) < 64:
                        break
                    if self.registry[old].done:
                        del self.registry[old]
                self.registry[key] = run
        cursor = request.after_seq
        if cursor > len(run.events):
            raise ChatError('恢复位置无效，请重新读取对话', 422)
        while True:
            changed = run.changed
            for event in run.events:
                if event['seq'] > cursor:
                    cursor = event['seq']
                    yield event
            if run.done:
                return
            try:
                await asyncio.wait_for(changed.wait(), timeout=self.heartbeat)
            except TimeoutError:
                yield {'type': 'heartbeat'}

    async def _publish(self, run, event):
        event = {**event, 'seq': len(run.events) + 1}
        if len(run.events) >= 8000 and event['type'] not in {'error', 'cancelled'}:
            raise ChatError('本次回复过长，请缩小查询范围', 422)
        if run.turn_id:
            await asyncio.to_thread(self.service._repository.append_event, run.turn_id, event)
        run.events.append(event)
        run.changed.set()
        run.changed = asyncio.Event()

    async def _produce(self, run, owner):
        try:
            async with aclosing(self.service.stream(run.request)) as source:
                async with aclosing(coalesce(source)) as events:
                    async for event in events:
                        if event['type'] == 'accepted':
                            turn = await asyncio.to_thread(self.service._repository.find_request, owner, run.request.request_id)
                            run.turn_id = turn['id']
                        if event['type'] == 'done':
                            elapsed = round((time.monotonic() - run.started) * 1000)
                            event = {**event, 'elapsed_ms': elapsed}
                            await asyncio.to_thread(self.service._repository.save_payload, run.turn_id, {'elapsed_ms': elapsed})
                        await self._publish(run, event)
        except asyncio.CancelledError:
            await self._publish(run, {'type': 'cancelled'})
        except Exception as error:
            failure = failure_for(error, 'chat')
            # ChatError messages originate in our ownership/lifecycle checks.
            message = str(error) if isinstance(error, ChatError) else failure.message
            await self._publish(run, {'type': 'error', 'message': message,
                'code': error.code if isinstance(error, ChatError) else 504 if failure.kind == 'timeout' else 503,
                'failure': failure.public()})
        finally:
            run.done = True
            run.changed.set()

    async def cancel(self, request):
        owner = await asyncio.to_thread(self.service.authenticate, request.token)
        await self.cancel_owner(owner, request.request_id)

    async def cancel_owner(self, owner, request_id):
        run = self.registry.get((owner, request_id))
        if run and run.task and not run.done:
            run.task.cancel()
            with suppress(asyncio.CancelledError):
                await run.task

    async def shutdown(self):
        tasks = [run.task for run in self.registry.values() if run.task and not run.done]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
