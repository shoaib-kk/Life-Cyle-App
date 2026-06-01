"""create local usage, session, and category tables

Revision ID: 0001_create_local_tables
Revises:
Create Date: 2026-06-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_create_local_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "daily_usage" in tables:
        columns = {column["name"] for column in inspector.get_columns("daily_usage")}
        if "usage_date" in columns and "date" not in columns:
            op.rename_table("daily_usage", "legacy_daily_usage")
            tables.remove("daily_usage")

    if "daily_usage" not in tables:
        op.create_table(
            "daily_usage",
            sa.Column("date", sa.String(), nullable=False),
            sa.Column("domain", sa.String(), nullable=False),
            sa.Column("minutes", sa.Float(), nullable=False),
            sa.Column("has_tracking_coverage", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.PrimaryKeyConstraint("date", "domain"),
        )
        if "legacy_daily_usage" in set(sa.inspect(bind).get_table_names()):
            op.execute(
                """
                INSERT OR REPLACE INTO daily_usage (date, domain, minutes, has_tracking_coverage)
                SELECT usage_date, domain, minutes, 1 FROM legacy_daily_usage
                """
            )
            op.drop_table("legacy_daily_usage")
    else:
        columns = {column["name"] for column in sa.inspect(bind).get_columns("daily_usage")}
        if "has_tracking_coverage" not in columns:
            op.add_column(
                "daily_usage",
                sa.Column("has_tracking_coverage", sa.Boolean(), nullable=False, server_default=sa.true()),
            )

    tables = set(sa.inspect(bind).get_table_names())
    if "sessions" not in tables:
        op.create_table(
            "sessions",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("domain", sa.String(), nullable=False),
            sa.Column("start_time", sa.DateTime(), nullable=False),
            sa.Column("end_time", sa.DateTime(), nullable=False),
            sa.Column("duration_minutes", sa.Float(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_sessions_domain", "sessions", ["domain"])
        op.create_index("ix_sessions_start_time", "sessions", ["start_time"])
        op.create_index("ix_sessions_end_time", "sessions", ["end_time"])
    if "categories" not in tables:
        op.create_table(
            "categories",
            sa.Column("domain", sa.String(), nullable=False),
            sa.Column("category", sa.String(), nullable=False),
            sa.PrimaryKeyConstraint("domain"),
        )


def downgrade() -> None:
    op.drop_table("categories")
    op.drop_index("ix_sessions_end_time", table_name="sessions")
    op.drop_index("ix_sessions_start_time", table_name="sessions")
    op.drop_index("ix_sessions_domain", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("daily_usage")
