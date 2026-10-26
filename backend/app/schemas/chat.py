from typing import Literal

from pydantic import BaseModel, Field, field_validator

Agent = Literal['team', 'flights', 'hotels', 'destinations']


class StartMessage(BaseModel):
    type: Literal['start']
    token: str = Field(min_length=20, max_length=200)
    agent: Agent = 'team'
    conversation_id: str | None = Field(default=None, max_length=100)
    request_id: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=5000)
    preferences: str = Field(default='', max_length=1500)

    @field_validator('query')
    @classmethod
    def nonempty_query(cls, value: str):
        if not value.strip():
            raise ValueError('请输入旅行需求')
        return value
