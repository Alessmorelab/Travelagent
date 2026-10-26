"""Database selection lives here; controllers and graphs do not know the driver."""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, make_url


def create_database(location: str | Path | None = None):
    target = str(location) if location is not None else os.getenv('DATABASE_URL', '').strip()
    if not target:
        target = os.getenv('TRAVEL_CHAT_DB') or str(Path(__file__).resolve().parents[3] / '.data/chat.sqlite3')
    if '://' in target:
        url = make_url(target)
        if url.drivername in {'postgres', 'postgresql'}:
            url = url.set(drivername='postgresql+psycopg')
    else:
        url = URL.create('sqlite+pysqlite', database=str(Path(target).resolve()))
    if url.get_backend_name() not in {'sqlite', 'postgresql'}:
        raise ValueError('Use a PostgreSQL or SQLite conversation database')
    if url.get_backend_name() == 'sqlite':
        if url.database and url.database != ':memory:':
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={'timeout': 5, 'check_same_thread': False})

        @event.listens_for(engine, 'connect')
        def configure_sqlite(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')

        with engine.connect() as connection:
            connection.exec_driver_sql('PRAGMA journal_mode=WAL')
    else:
        engine = create_engine(url, pool_pre_ping=True, connect_args={'connect_timeout': 5})
    return engine
