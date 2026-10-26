"""Conversation tables; compatible with the previous local SQLite schema."""

from sqlalchemy import Column, Float, ForeignKey, Index, MetaData, String, Table, Text, UniqueConstraint

metadata = MetaData()

devices = Table(
    'devices', metadata,
    Column('token_hash', String(64), primary_key=True),
    Column('created', Float, nullable=False),
)
conversations = Table(
    'conversations', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner', String(64), nullable=False),
    Column('agent', String(20), nullable=False),
    Column('title', Text, nullable=False),
    Column('created', Float, nullable=False),
    Column('updated', Float, nullable=False),
)
Index('conversations_owner', conversations.c.owner, conversations.c.agent, conversations.c.updated)
turns = Table(
    'turns', metadata,
    Column('id', String(36), primary_key=True),
    Column('conversation_id', String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False),
    Column('request_id', String(100), nullable=False),
    Column('query', Text, nullable=False),
    Column('model_query', Text, nullable=False),
    Column('response', Text, nullable=False, server_default=''),
    Column('status', String(20), nullable=False),
    Column('created', Float, nullable=False),
    Column('updated', Float, nullable=False),
    UniqueConstraint('conversation_id', 'request_id', name='turn_request'),
)
Index('turns_request', turns.c.request_id)

# Separate table keeps existing SQLite/PostgreSQL conversation schemas compatible.
turn_steps = Table(
    'turn_steps', metadata,
    Column('turn_id', String(36), ForeignKey('turns.id', ondelete='CASCADE'), primary_key=True),
    Column('key', String(128), primary_key=True),
    Column('label', String(120), nullable=False),
    Column('kind', String(10), nullable=False),
    Column('state', String(20), nullable=False),
    Column('created', Float, nullable=False),
)
