from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "lifecycle.db"
CONFIGURED_DB_PATH = Path(os.environ.get("LIFECYCLE_DB_PATH", DEFAULT_DB_PATH))
DB_PATH = CONFIGURED_DB_PATH if CONFIGURED_DB_PATH.is_absolute() else PROJECT_ROOT / CONFIGURED_DB_PATH
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def _column_names(connection, table_name: str) -> set[str]:
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _table_names(connection) -> set[str]:
    rows = connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'")).fetchall()
    return {row[0] for row in rows}


def ensure_sqlalchemy_schema() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with engine.begin() as connection:
        tables = _table_names(connection)
        columns = _column_names(connection, "daily_usage") if "daily_usage" in tables else set()
        if "usage_date" in columns and "date" not in columns:
            connection.execute(text("ALTER TABLE daily_usage RENAME TO legacy_daily_usage"))

    from backend.models import BrowsingSession, Category, DailyUsage  # noqa: F401

    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        tables = _table_names(connection)
        if "legacy_daily_usage" in tables:
            connection.execute(
                text(
                    """
                    INSERT OR REPLACE INTO daily_usage (date, domain, minutes, has_tracking_coverage)
                    SELECT usage_date, domain, minutes, 1
                    FROM legacy_daily_usage
                    """
                )
            )
            connection.execute(text("DROP TABLE legacy_daily_usage"))

        columns = _column_names(connection, "daily_usage")
        if "has_tracking_coverage" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE daily_usage "
                    "ADD COLUMN has_tracking_coverage BOOLEAN NOT NULL DEFAULT 1"
                )
            )
