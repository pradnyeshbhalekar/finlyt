from __future__ import annotations

from flask import Flask, current_app, g
from sqlalchemy import MetaData, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def make_engine(url: str, *, serverless: bool = False) -> Engine:
    if serverless:
        # Each Vercel invocation may be a fresh process; Neon's pooler does the pooling.
        return create_engine(url, pool_pre_ping=True, poolclass=NullPool)
    return create_engine(url, pool_pre_ping=True)


def init_app(app: Flask, engine: Engine | None) -> None:
    app.extensions["finlyt.engine"] = engine
    app.extensions["finlyt.sessionmaker"] = (
        sessionmaker(engine, expire_on_commit=False) if engine is not None else None
    )
    app.teardown_appcontext(_close_session)


def get_session() -> Session:
    """One session per request (or CLI command), closed when the app context ends."""
    if "db_session" not in g:
        factory = current_app.extensions.get("finlyt.sessionmaker")
        if factory is None:
            raise RuntimeError("DATABASE_URL is not configured")
        g.db_session = factory()
    return g.db_session


def _close_session(exc: BaseException | None) -> None:
    session = g.pop("db_session", None)
    if session is not None:
        if exc is not None:
            session.rollback()
        session.close()
