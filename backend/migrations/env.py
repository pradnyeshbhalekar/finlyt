"""Alembic environment. Uses DATABASE_URL_UNPOOLED (Neon direct URL) or DATABASE_URL."""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool

from finlyt_api import models  # noqa: F401  (registers the tables)
from finlyt_api.config import normalize_db_url
from finlyt_api.db import Base

load_dotenv()

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    url = normalize_db_url(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL"))
    if not url:
        raise RuntimeError("Set DATABASE_URL_UNPOOLED or DATABASE_URL to run migrations")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
