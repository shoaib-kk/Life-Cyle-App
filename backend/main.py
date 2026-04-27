from datetime import date, datetime, timedelta
from pathlib import Path
import sqlite3
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


BASELINE_WEEKDAY_OCCURRENCES = 8
FULL_DAY_MINUTES = 24 * 60
ABOVE_BASELINE_THRESHOLD = 0.3
MIN_BASELINE_RECORDS = 2
MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION = 30
MIN_DOMAIN_MINUTES_FOR_PREDICTION = 10
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "lifecycle.db"


class UsagePayload(BaseModel):
    date: Optional[date] = None
    usage: Dict[str, float] = Field(default_factory=dict)
    tracked: bool = True


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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tracked_dates (
                usage_date TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL
            )
            """
        )


def date_key(value: date) -> str:
    return value.isoformat()


def previous_same_weekday_dates(value: date, occurrences: int) -> list[date]:
    return [value - timedelta(days=offset * 7) for offset in range(1, occurrences + 1)]


def elapsed_day_minutes(value: date) -> float:
    today = date.today()

    if value < today:
        return FULL_DAY_MINUTES

    if value > today:
        return 1

    now = datetime.now()
    midnight = datetime.combine(today, datetime.min.time())
    return max(0, (now - midnight).total_seconds() / 60)


def predicted_total_minutes(current_usage: float, elapsed_minutes_today: float) -> float:
    if elapsed_minutes_today <= 0:
        return 0

    return (current_usage / elapsed_minutes_today) * FULL_DAY_MINUTES


def confidence_label(data_points: int) -> str:
    if data_points >= 6:
        return "High confidence"
    if data_points >= 3:
        return "Medium confidence"
    if data_points >= 1:
        return "Low confidence"
    return "-"


def status_text(predicted_total: float, baseline_minutes: float) -> str:
    if baseline_minutes <= 0:
        return "New activity today" if predicted_total > 0 else "No usage yet"

    percent = round(((predicted_total - baseline_minutes) / baseline_minutes) * 100)

    if percent > 0:
        return f"+{percent}% above normal"

    if percent < 0:
        return f"{percent}% below normal"

    return "On your normal pace"


def recommendation_text(today_minutes: float, baseline_minutes: float, predicted_total: float) -> str:
    if baseline_minutes <= 0:
        if today_minutes > 0:
            return "No same-weekday baseline yet - keep tracking to make this meaningful"
        return "No usage recorded for this site today"

    if predicted_total > baseline_minutes * (1 + ABOVE_BASELINE_THRESHOLD):
        if today_minutes >= baseline_minutes:
            return "You've passed your usual full-day usage for this site"
        return "Stopping now keeps you within your normal range"

    if predicted_total <= baseline_minutes:
        return "Stopping now keeps you within your normal range"

    return "You're above normal pace, but still inside the 30% range"


def usage_for_date(connection: sqlite3.Connection, value: date) -> dict[str, float]:
    rows = connection.execute(
        "SELECT domain, minutes FROM daily_usage WHERE usage_date = ? ORDER BY minutes DESC",
        (date_key(value),),
    ).fetchall()
    return {row["domain"]: round(float(row["minutes"]), 2) for row in rows}


def tracked_total_for_date(connection: sqlite3.Connection, value: date) -> float:
    row = connection.execute(
        "SELECT SUM(minutes) AS total FROM daily_usage WHERE usage_date = ?",
        (date_key(value),),
    ).fetchone()
    return float(row["total"] or 0)


def tracked_date_keys(connection: sqlite3.Connection, keys: list[str]) -> set[str]:
    if not keys:
        return set()

    placeholders = ",".join("?" for _ in keys)
    rows = connection.execute(
        f"SELECT usage_date FROM tracked_dates WHERE usage_date IN ({placeholders})",
        (*keys,),
    ).fetchall()
    return {row["usage_date"] for row in rows}


def baseline_for_domain(
    connection: sqlite3.Connection, domain: str, value: date, occurrences: int
) -> tuple[float, int]:
    keys = [date_key(previous) for previous in previous_same_weekday_dates(value, occurrences)]
    recorded_keys = tracked_date_keys(connection, keys)
    if not recorded_keys:
        return 0.0, 0

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
    return sum(totals.get(key, 0.0) for key in recorded_keys) / len(recorded_keys), len(recorded_keys)


def prediction_insight(
    today_minutes: float,
    baseline_minutes: float,
    baseline_count: int,
    tracked_today_minutes: float,
    elapsed_minutes: float,
    value: date,
) -> dict:
    if baseline_count < MIN_BASELINE_RECORDS:
        return {
            "status": "-",
            "predicted_total_minutes": None,
            "prediction": "-",
            "recommendation": "",
        }

    if (
        tracked_today_minutes < MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION
        and today_minutes < MIN_DOMAIN_MINUTES_FOR_PREDICTION
    ):
        return {
            "status": "Baseline ready",
            "predicted_total_minutes": None,
            "prediction": "Early in day" if value == date.today() and datetime.now().hour < 10 else "-",
            "recommendation": "",
        }

    predicted_total = predicted_total_minutes(today_minutes, elapsed_minutes)
    prefix = "Early estimate" if value == date.today() and datetime.now().hour < 10 else "Prediction"

    return {
        "status": status_text(predicted_total, baseline_minutes),
        "predicted_total_minutes": round(predicted_total),
        "prediction": f"{prefix}: ~{round(predicted_total)} min today",
        "recommendation": recommendation_text(today_minutes, baseline_minutes, predicted_total),
    }


def compute_insights(connection: sqlite3.Connection, value: date, occurrences: int) -> dict:
    usage = usage_for_date(connection, value)
    elapsed_minutes = elapsed_day_minutes(value)
    tracked_today_minutes = tracked_total_for_date(connection, value)
    domains = {}

    for domain, today_minutes in usage.items():
        baseline_minutes, baseline_count = baseline_for_domain(connection, domain, value, occurrences)
        insight = prediction_insight(
            today_minutes,
            baseline_minutes,
            baseline_count,
            tracked_today_minutes,
            elapsed_minutes,
            value,
        )
        domains[domain] = {
            "today_minutes": round(today_minutes, 2),
            "baseline_minutes": round(baseline_minutes, 2),
            "baseline_record_count": baseline_count,
            "baseline_confidence": (
                confidence_label(baseline_count)
                if baseline_count >= MIN_BASELINE_RECORDS
                else "-"
            ),
            **insight,
        }

    return {
        "date": date_key(value),
        "baseline_type": "same_weekday_average",
        "baseline_weekday_occurrences": occurrences,
        "elapsed_minutes_today": round(elapsed_minutes, 2),
        "prediction_formula": "predicted_total = (current_usage / elapsed_minutes_today) * 1440",
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

        if payload.tracked:
            connection.execute(
                """
                INSERT INTO tracked_dates (usage_date, updated_at)
                VALUES (?, ?)
                ON CONFLICT(usage_date)
                DO UPDATE SET updated_at = excluded.updated_at
                """,
                (date_key(usage_date), now),
            )

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
        insights = compute_insights(connection, usage_date, BASELINE_WEEKDAY_OCCURRENCES)

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
    weeks: int = Query(default=BASELINE_WEEKDAY_OCCURRENCES, ge=1, le=12),
) -> dict:
    value = usage_date or date.today()
    init_db()

    with connect() as connection:
        return compute_insights(connection, value, weeks)

