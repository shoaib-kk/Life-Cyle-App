from datetime import date, datetime, timedelta
from pathlib import Path
import sqlite3
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


BASELINE_DAYS = 7
FULL_DAY_MINUTES = 24 * 60
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "lifecycle.db"


class UsagePayload(BaseModel):
    date: Optional[date] = None
    usage: Dict[str, float] = Field(default_factory=dict)


app = FastAPI(title="LifeCycle V1 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_usage (
                usage_date TEXT NOT NULL,
                domain TEXT NOT NULL,
                minutes REAL NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (usage_date, domain)
            )
            """
        )


def date_key(value: date) -> str:
    return value.isoformat()


def previous_dates(value: date, days: int) -> list[date]:
    return [value - timedelta(days=offset) for offset in range(1, days + 1)]


def elapsed_day_minutes(value: date) -> float:
    today = date.today()

    if value < today:
        return FULL_DAY_MINUTES

    if value > today:
        return 1

    now = datetime.now()
    midnight = datetime.combine(today, datetime.min.time())
    return max(1, (now - midnight).total_seconds() / 60)


def status_text(today_minutes: float, baseline_minutes: float) -> str:
    if baseline_minutes <= 0:
        return "New activity today" if today_minutes > 0 else "No usage yet"

    percent = round(((today_minutes - baseline_minutes) / baseline_minutes) * 100)

    if percent > 0:
        return f"+{percent}% above normal"

    if percent < 0:
        return f"{percent}% below normal"

    return "On your normal pace"


def recommendation_text(today_minutes: float, baseline_minutes: float, predicted_total: float) -> str:
    if baseline_minutes > 0 and predicted_total > baseline_minutes:
        return "You're trending higher than usual - consider stopping now to stay within your average"

    if baseline_minutes > 0 and today_minutes < baseline_minutes:
        return "You're below your usual pace - keep it there if that is the goal"

    if today_minutes > 0:
        return "Keep tracking today so your baseline can become meaningful"

    return "No active usage recorded yet today"


def usage_for_date(connection: sqlite3.Connection, value: date) -> dict[str, float]:
    rows = connection.execute(
        "SELECT domain, minutes FROM daily_usage WHERE usage_date = ? ORDER BY minutes DESC",
        (date_key(value),),
    ).fetchall()
    return {row["domain"]: round(float(row["minutes"]), 2) for row in rows}


def baseline_for_domain(
    connection: sqlite3.Connection, domain: str, value: date, days: int
) -> float:
    keys = [date_key(previous) for previous in previous_dates(value, days)]
    placeholders = ",".join("?" for _ in keys)
    rows = connection.execute(
        f"""
        SELECT usage_date, minutes
        FROM daily_usage
        WHERE domain = ? AND usage_date IN ({placeholders})
        """,
        (domain, *keys),
    ).fetchall()
    totals = {row["usage_date"]: float(row["minutes"]) for row in rows}
    return sum(totals.get(key, 0.0) for key in keys) / days


def compute_insights(connection: sqlite3.Connection, value: date, days: int) -> dict:
    usage = usage_for_date(connection, value)
    elapsed_minutes = elapsed_day_minutes(value)
    domains = {}

    for domain, today_minutes in usage.items():
        baseline_minutes = baseline_for_domain(connection, domain, value, days)
        predicted_total = (today_minutes / elapsed_minutes) * FULL_DAY_MINUTES
        domains[domain] = {
            "today_minutes": round(today_minutes, 2),
            "baseline_minutes": round(baseline_minutes, 2),
            "status": status_text(today_minutes, baseline_minutes),
            "predicted_total_minutes": round(predicted_total),
            "prediction": f"~{round(predicted_total)} min today",
            "recommendation": recommendation_text(today_minutes, baseline_minutes, predicted_total),
        }

    return {
        "date": date_key(value),
        "baseline_days": days,
        "domains": domains,
    }


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.post("/usage")
def save_usage(payload: UsagePayload) -> dict:
    usage_date = payload.date or date.today()
    clean_usage = {
        domain.strip().lower(): max(0.0, float(minutes))
        for domain, minutes in payload.usage.items()
        if domain.strip()
    }

    init_db()
    with connect() as connection:
        now = datetime.utcnow().isoformat(timespec="seconds")

        for domain, minutes in clean_usage.items():
            connection.execute(
                """
                INSERT INTO daily_usage (usage_date, domain, minutes, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(usage_date, domain)
                DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at
                """,
                (date_key(usage_date), domain, round(minutes, 2), now),
            )

        connection.commit()
        insights = compute_insights(connection, usage_date, BASELINE_DAYS)

    return {
        "date": date_key(usage_date),
        "stored_domains": len(clean_usage),
        "insights": insights,
    }


@app.get("/usage/{usage_date}")
def read_usage(usage_date: date) -> dict:
    init_db()
    with connect() as connection:
        usage = usage_for_date(connection, usage_date)

    if not usage:
        raise HTTPException(status_code=404, detail="No usage found for that date")

    return {"date": date_key(usage_date), "usage": usage}


@app.get("/insights")
def read_insights(
    usage_date: Optional[date] = Query(default=None, alias="date"),
    days: int = Query(default=BASELINE_DAYS, ge=1, le=30),
) -> dict:
    value = usage_date or date.today()
    init_db()

    with connect() as connection:
        return compute_insights(connection, value, days)
