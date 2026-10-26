from __future__ import annotations

import os
from urllib.parse import urlsplit

from .errors import ChatError

MODEL_KEYS = {'team': 'TEAM_AGENT_MODEL_ID', 'flights': 'FLIGHT_AGENT_MODEL_ID', 'hotels': 'HOTEL_AGENT_MODEL_ID', 'destinations': 'DESTINATION_AGENT_MODEL_ID'}


def model_for(agent: str):
    base = os.getenv('TRAVEL_API_BASE')
    compatible_key = os.getenv('TRAVEL_API_KEY') or os.getenv('DASHSCOPE_API_KEY')
    if base or compatible_key:
        if not compatible_key:
            raise ChatError('请在后端配置 TRAVEL_API_KEY 或 DASHSCOPE_API_KEY', 503)
        from langchain_openai import ChatOpenAI
        model = os.getenv(MODEL_KEYS[agent]) or os.getenv('TRAVEL_MODEL', 'qwen-plus')
        base_url = base or 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        options = {}
        # These DashScope hybrid models support answering directly. Do not send
        # provider-specific parameters to unrelated OpenAI-compatible services.
        if (urlsplit(base_url).hostname in {'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'}
                and model.startswith(('qwen-plus', 'qwen-flash', 'qwen3.8-flash', 'qwen3.8-max'))):
            options['extra_body'] = {'enable_thinking': False}
        return ChatOpenAI(model=model,
                          api_key=compatible_key,
                          base_url=base_url,
                          temperature=0.4, timeout=60, max_retries=1, **options)
    if not os.getenv('TOGETHER_API_KEY'):
        raise ChatError('后端尚未配置大模型 API，请配置后再使用真实服务', 503)
    from langchain_together import ChatTogether
    model = os.getenv(MODEL_KEYS[agent]) or os.getenv('TRAVEL_MODEL') or os.getenv('HOTEL_AGENT_MODEL_ID')
    if not model:
        raise ChatError('请在后端配置 TRAVEL_MODEL 或助手模型名称', 503)
    return ChatTogether(model=model, temperature=0.4, timeout=60, max_retries=1)
