"""Bounded, read-only query attempts with public, machine-readable failures."""
import asyncio
import random

from langchain_core.tools import StructuredTool

from backend.app.core.failures import QueryFailure, failure_for, stage_call, tool_error_text


def bounded_tool(original, label, timeout=20, gate=None):
    # Disable the inner tool's text-only error handler, so failures retain status.
    inner = original.model_copy(update={'handle_tool_error': False})

    async def execute(**arguments):
        for attempt in range(2):
            try:
                # Only the outer query is public progress; the inner tool is
                # the same operation and must not appear as a second query.
                return await stage_call(inner.ainvoke(arguments, config={'callbacks': []}), timeout)
            except Exception as error:
                failure = failure_for(error, 'tool', label)
                # Cancelling a thread does not terminate a synchronous provider
                # call. Never overlap a retry with that outstanding operation.
                can_retry = bool(getattr(original, 'coroutine', None)) and failure.kind in {'network', 'unavailable'} and failure.retryable
                if attempt or not can_retry:
                    raise QueryFailure(failure) from None
                await asyncio.sleep(random.uniform(0.2, 0.5))

    async def invoke(**arguments):
        if gate is not None:
            async with gate:
                return await execute(**arguments)
        return await execute(**arguments)

    return StructuredTool.from_function(name=original.name, description=original.description,
        args_schema=original.args_schema, coroutine=invoke, handle_tool_error=tool_error_text)
