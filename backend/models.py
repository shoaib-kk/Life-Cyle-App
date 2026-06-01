from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class DailyUsage(Base):
    __tablename__ = "daily_usage"

    date: Mapped[str] = mapped_column(String, primary_key=True)
    domain: Mapped[str] = mapped_column(String, primary_key=True)
    minutes: Mapped[float] = mapped_column(Float, nullable=False)
    has_tracking_coverage: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class BrowsingSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    domain: Mapped[str] = mapped_column(String, nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duration_minutes: Mapped[float] = mapped_column(Float, nullable=False)


class Category(Base):
    __tablename__ = "categories"

    domain: Mapped[str] = mapped_column(String, primary_key=True)
    category: Mapped[str] = mapped_column(String, nullable=False, default="neutral")
