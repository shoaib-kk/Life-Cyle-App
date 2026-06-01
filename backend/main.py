from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date as Date, datetime, timedelta
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
from typing import Any, Dict, Optional
from urllib.parse import urlparse
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session as SqlAlchemySession

from backend.database import DB_PATH as SQLALCHEMY_DB_PATH
from backend.database import SessionLocal, ensure_sqlalchemy_schema
from backend.models import BrowsingSession, Category, DailyUsage


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")
BASELINE_WEEKDAY_OCCURRENCES = 8
FULL_DAY_MINUTES = 24 * 60
ABOVE_BASELINE_THRESHOLD = 0.3
MIN_BASELINE_RECORDS = 2
MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION = 30
MIN_DOMAIN_MINUTES_FOR_PREDICTION = 10
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "lifecycle.db"
DB_PATH = SQLALCHEMY_DB_PATH
APP_ENV = os.environ.get("LIFECYCLE_ENV", "development").lower()
AUTH_SECRET = os.environ.get("LIFECYCLE_AUTH_SECRET")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in (
        os.environ.get("LIFECYCLE_CORS_ORIGINS")
        or os.environ.get(
            "LIFECYCLE_ALLOWED_ORIGINS",
            "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:5173,http://localhost:5173",
        )
    ).split(",")
    if origin.strip()
]
TOKEN_TTL_DAYS = 30
PASSWORD_MIN_LENGTH = 8

if not AUTH_SECRET:
    if APP_ENV in {"production", "prod"}:
        raise RuntimeError("LIFECYCLE_AUTH_SECRET must be set in production")
    AUTH_SECRET = "lifecycle-dev-secret-change-me"


class UsagePayload(BaseModel):
    date: Optional[Date] = None
    usage: Dict[str, float] = Field(default_factory=dict)
    tracked: bool = True


class LocalSessionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    externalId: Optional[str] = None
    domain: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    startTime: Optional[datetime] = None
    endTime: Optional[datetime] = None
    startedAt: Optional[datetime] = None
    endedAt: Optional[datetime] = None
    duration_minutes: Optional[float] = None
    durationMinutes: Optional[float] = None


class LocalSessionBatchPayload(BaseModel):
    sessions: list[LocalSessionPayload] = Field(default_factory=list)


class CategoryUpdatePayload(BaseModel):
    category: str = "neutral"


class AuthPayload(BaseModel):
    email: str
    password: str


class TaskSessionPayload(BaseModel):
    profileId: Optional[str] = None
    profileName: str = "Focus"
    title: str = "Focus session"
    group: str = "focus"
    startedAt: datetime
    endedAt: datetime
    durationMinutes: float = 0
    allowedMinutes: float = 0
    blockedMinutes: float = 0
    idleMinutes: float = 0
    tabSwitches: int = 0
    blockedAttempts: int = 0
    overrideCount: int = 0
    qualityScore: int = 100
    distractingDomainCounts: Dict[str, int] = Field(default_factory=dict)
    overrideLog: list[dict] = Field(default_factory=list)


class TaskProfilePayload(BaseModel):
    id: str
    name: str
    group: str = "focus"
    allowedDomains: list[str] = Field(default_factory=list)
    blockedDomains: list[str] = Field(default_factory=list)
    defaultDurationMinutes: int = 60
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class DomainCategoryPayload(BaseModel):
    domain: str
    category: str = "neutral"
    productivity: str = "neutral"
    profileId: Optional[str] = None
    source: str = "manual"


class UsageSessionPayload(BaseModel):
    externalId: Optional[str] = None
    domain: str
    category: Optional[str] = None
    profileId: Optional[str] = None
    startedAt: datetime
    endedAt: datetime
    durationMinutes: Optional[float] = None
    reasonEnded: str = "tab_change"
    source: str = "extension"


class UsageSessionBatchPayload(BaseModel):
    sessions: list[UsageSessionPayload] = Field(default_factory=list)


class GoalPayload(BaseModel):
    metric: str
    targetMinutes: float
    period: str = "weekly"
    profileId: Optional[str] = None
    domain: Optional[str] = None
    active: bool = True


class GoalUpdatePayload(BaseModel):
    metric: Optional[str] = None
    targetMinutes: Optional[float] = None
    period: Optional[str] = None
    profileId: Optional[str] = None
    domain: Optional[str] = None
    active: Optional[bool] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="LifeCycle V1 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback) -> None:
        super().__exit__(exc_type, exc_value, traceback)
        self.close()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    return connection


def get_db():
    database = SessionLocal()
    try:
        yield database
    finally:
        database.close()


def ensure_column(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    definition: str,
) -> None:
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    ensure_sqlalchemy_schema()
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_daily_usage (
                user_id INTEGER NOT NULL,
                usage_date TEXT NOT NULL,
                domain TEXT NOT NULL,
                minutes REAL NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, usage_date, domain),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_tracked_dates (
                user_id INTEGER NOT NULL,
                usage_date TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, usage_date),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS task_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                profile_id TEXT,
                profile_name TEXT NOT NULL,
                title TEXT NOT NULL,
                task_group TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL,
                duration_minutes REAL NOT NULL,
                allowed_minutes REAL NOT NULL,
                blocked_minutes REAL NOT NULL,
                idle_minutes REAL NOT NULL,
                tab_switches INTEGER NOT NULL,
                blocked_attempts INTEGER NOT NULL,
                override_count INTEGER NOT NULL,
                quality_score INTEGER NOT NULL,
                distracting_domain_counts TEXT NOT NULL,
                override_log TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS task_profiles (
                user_id INTEGER NOT NULL,
                profile_id TEXT NOT NULL,
                name TEXT NOT NULL,
                task_group TEXT NOT NULL DEFAULT 'focus',
                allowed_domains TEXT NOT NULL,
                blocked_domains TEXT NOT NULL,
                default_duration_minutes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, profile_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                external_id TEXT,
                domain TEXT NOT NULL,
                category TEXT NOT NULL,
                profile_id TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL,
                duration_minutes REAL NOT NULL,
                reason_ended TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, external_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS domain_categories (
                user_id INTEGER NOT NULL,
                domain TEXT NOT NULL,
                profile_id TEXT NOT NULL DEFAULT 'global',
                category TEXT NOT NULL,
                productivity TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, domain, profile_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                metric TEXT NOT NULL,
                target_minutes REAL NOT NULL,
                period TEXT NOT NULL,
                profile_id TEXT,
                domain TEXT,
                active INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_reports (
                user_id INTEGER NOT NULL,
                week_start TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                metrics TEXT NOT NULL,
                narrative TEXT NOT NULL,
                PRIMARY KEY (user_id, week_start),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        ensure_column(connection, "task_profiles", "task_group", "TEXT NOT NULL DEFAULT 'focus'")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_started ON usage_sessions(user_id, started_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_domain ON usage_sessions(user_id, domain)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_task_sessions_user_started ON task_sessions(user_id, started_at)"
        )


def date_key(value: Date) -> str:
    return value.isoformat()


def normalize_email(email: str) -> str:
    value = email.strip().lower()
    if "@" not in value or "." not in value.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    return value


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)

    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return base64.urlsafe_b64encode(digest).decode("ascii"), salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    actual_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(actual_hash, expected_hash)


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_token(user_id: int, email: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": int((datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS)).timestamp()),
    }
    signing_input = ".".join(
        [
            b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{b64url_encode(signature)}"


def parse_token(token: str) -> dict:
    try:
        header_part, payload_part, signature_part = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    signing_input = f"{header_part}.{payload_part}"
    expected_signature = hmac.new(
        AUTH_SECRET.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()

    try:
        provided_signature = b64url_decode(signature_part)
        payload = json.loads(b64url_decode(payload_part))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    if not hmac.compare_digest(provided_signature, expected_signature):
        raise HTTPException(status_code=401, detail="Invalid token")

    if int(payload.get("exp", 0)) < int(datetime.utcnow().timestamp()):
        raise HTTPException(status_code=401, detail="Token expired")

    return payload


def user_response(user: sqlite3.Row, token: Optional[str] = None) -> dict:
    response = {"userId": user["id"], "email": user["email"]}
    if token:
        response["token"] = token
    return response


def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    payload = parse_token(authorization.split(" ", 1)[1].strip())
    user_id = int(payload.get("sub") or 0)

    init_db()
    with connect() as connection:
        user = connection.execute(
            "SELECT id, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {"id": user["id"], "email": user["email"]}


def optional_current_user(authorization: Optional[str] = Header(default=None)) -> Optional[dict]:
    if not authorization:
        return None
    return current_user(authorization)


def previous_same_weekday_dates(value: Date, occurrences: int) -> list[Date]:
    return [value - timedelta(days=offset * 7) for offset in range(1, occurrences + 1)]


def elapsed_day_minutes(value: Date) -> float:
    today = Date.today()

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


def usage_table(user_id: Optional[int]) -> str:
    return "user_daily_usage" if user_id else "daily_usage"


def tracked_table(user_id: Optional[int]) -> str:
    return "user_tracked_dates" if user_id else "tracked_dates"


def usage_for_date(connection: sqlite3.Connection, value: Date, user_id: Optional[int] = None) -> dict[str, float]:
    if user_id:
        rows = connection.execute(
            """
            SELECT domain, minutes
            FROM user_daily_usage
            WHERE user_id = ? AND usage_date = ?
            ORDER BY minutes DESC
            """,
            (user_id, date_key(value)),
        ).fetchall()
    else:
        rows = connection.execute(
            "SELECT domain, minutes FROM daily_usage WHERE date = ? ORDER BY minutes DESC",
            (date_key(value),),
        ).fetchall()
    return {row["domain"]: round(float(row["minutes"]), 2) for row in rows}


def tracked_total_for_date(connection: sqlite3.Connection, value: Date, user_id: Optional[int] = None) -> float:
    if user_id:
        row = connection.execute(
            "SELECT SUM(minutes) AS total FROM user_daily_usage WHERE user_id = ? AND usage_date = ?",
            (user_id, date_key(value)),
        ).fetchone()
    else:
        row = connection.execute(
            "SELECT SUM(minutes) AS total FROM daily_usage WHERE date = ?",
            (date_key(value),),
        ).fetchone()
    return float(row["total"] or 0)


def tracked_date_keys(connection: sqlite3.Connection, keys: list[str], user_id: Optional[int] = None) -> set[str]:
    if not keys:
        return set()

    placeholders = ",".join("?" for _ in keys)
    if user_id:
        rows = connection.execute(
            f"SELECT usage_date FROM user_tracked_dates WHERE user_id = ? AND usage_date IN ({placeholders})",
            (user_id, *keys),
        ).fetchall()
    else:
        rows = connection.execute(
            f"SELECT usage_date FROM tracked_dates WHERE usage_date IN ({placeholders})",
            (*keys,),
        ).fetchall()
    return {row["usage_date"] for row in rows}


def baseline_for_domain(
    connection: sqlite3.Connection,
    domain: str,
    value: Date,
    occurrences: int,
    user_id: Optional[int] = None,
) -> tuple[float, int]:
    keys = [date_key(previous) for previous in previous_same_weekday_dates(value, occurrences)]
    recorded_keys = tracked_date_keys(connection, keys, user_id)
    if not recorded_keys:
        return 0.0, 0

    placeholders = ",".join("?" for _ in keys)
    if user_id:
        rows = connection.execute(
            f"""
            SELECT usage_date, minutes
            FROM user_daily_usage
            WHERE user_id = ? AND domain = ? AND usage_date IN ({placeholders})
            """,
            (user_id, domain, *keys),
        ).fetchall()
    else:
        rows = connection.execute(
            f"""
            SELECT date AS usage_date, minutes
            FROM daily_usage
            WHERE domain = ? AND date IN ({placeholders})
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
    value: Date,
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
            "prediction": "Early in day" if value == Date.today() and datetime.now().hour < 10 else "-",
            "recommendation": "",
        }

    predicted_total = predicted_total_minutes(today_minutes, elapsed_minutes)
    prefix = "Early estimate" if value == Date.today() and datetime.now().hour < 10 else "Prediction"

    return {
        "status": status_text(predicted_total, baseline_minutes),
        "predicted_total_minutes": round(predicted_total),
        "prediction": f"{prefix}: ~{round(predicted_total)} min today",
        "recommendation": recommendation_text(today_minutes, baseline_minutes, predicted_total),
    }


def compute_insights(
    connection: sqlite3.Connection,
    value: Date,
    occurrences: int,
    user_id: Optional[int] = None,
) -> dict:
    usage = usage_for_date(connection, value, user_id)
    elapsed_minutes = elapsed_day_minutes(value)
    tracked_today_minutes = tracked_total_for_date(connection, value, user_id)
    domains = {}

    for domain, today_minutes in usage.items():
        baseline_minutes, baseline_count = baseline_for_domain(
            connection,
            domain,
            value,
            occurrences,
            user_id,
        )
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


DEFAULT_DOMAIN_CATEGORIES = {
    "chatgpt.com": ("ai tools", "productive"),
    "github.com": ("development", "productive"),
    "stackoverflow.com": ("development", "productive"),
    "developer.mozilla.org": ("development", "productive"),
    "docs.google.com": ("documents", "productive"),
    "linkedin.com": ("career", "productive"),
    "seek.com.au": ("career", "productive"),
    "indeed.com": ("career", "productive"),
    "youtube.com": ("video", "distracting"),
    "reddit.com": ("social", "distracting"),
    "instagram.com": ("social", "distracting"),
    "facebook.com": ("social", "distracting"),
    "x.com": ("social", "distracting"),
    "twitter.com": ("social", "distracting"),
    "netflix.com": ("streaming", "distracting"),
    "gmail.com": ("communication", "neutral"),
    "mail.google.com": ("communication", "neutral"),
}
PRODUCTIVITY_VALUES = {"productive", "distracting", "neutral"}


def normalize_domain_name(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        raise HTTPException(status_code=400, detail="Domain is required")

    candidate = raw if "://" in raw else f"https://{raw}"
    hostname = urlparse(candidate).hostname
    if hostname:
        raw = hostname.lower()

    if raw.startswith("www."):
        raw = raw[4:]
    return raw.strip("/")


def normalize_productivity(value: Optional[str]) -> str:
    normalized = str(value or "neutral").strip().lower()
    return normalized if normalized in PRODUCTIVITY_VALUES else "neutral"


def normalize_category_name(value: Optional[str], productivity: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized:
        return normalized
    return productivity


def default_category_for_domain(domain: str) -> dict:
    normalized = normalize_domain_name(domain)
    for rule_domain, (category, productivity) in sorted(
        DEFAULT_DOMAIN_CATEGORIES.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    ):
        if normalized == rule_domain or normalized.endswith(f".{rule_domain}"):
            return {"category": category, "productivity": productivity}
    return {"category": "uncategorized", "productivity": "neutral"}


def profile_scope(profile_id: Optional[str]) -> str:
    return str(profile_id or "global").strip() or "global"


def parse_stored_datetime(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def clamp_number(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def seconds_between(started_at: datetime, ended_at: datetime) -> float:
    return max(0.0, (ended_at - started_at).total_seconds())


def local_category_record(category: Category) -> dict:
    return {"domain": category.domain, "category": normalize_productivity(category.category)}


def local_session_times(payload: LocalSessionPayload) -> tuple[datetime, datetime]:
    started_at = payload.start_time or payload.startTime or payload.startedAt
    ended_at = payload.end_time or payload.endTime or payload.endedAt

    if not started_at or not ended_at:
        raise HTTPException(status_code=400, detail="Session start and end times are required")

    if ended_at <= started_at:
        raise HTTPException(status_code=400, detail="Session end time must be after start time")

    return started_at, ended_at


def local_session_duration(payload: LocalSessionPayload, started_at: datetime, ended_at: datetime) -> float:
    value = payload.duration_minutes
    if value is None:
        value = payload.durationMinutes
    if value is None:
        value = seconds_between(started_at, ended_at) / 60
    return round(max(0.0, float(value)), 2)


def local_session_record(session: BrowsingSession) -> dict:
    return {
        "id": session.id,
        "domain": session.domain,
        "start_time": session.start_time.isoformat(),
        "end_time": session.end_time.isoformat(),
        "duration_minutes": round(float(session.duration_minutes or 0), 2),
    }


def date_keys_between(start_date: Date, end_date: Date) -> list[str]:
    days = (end_date - start_date).days + 1
    return [(start_date + timedelta(days=index)).isoformat() for index in range(max(0, days))]


def analytics_window(days: int) -> tuple[Date, Date]:
    bounded_days = max(1, min(180, int(days or 30)))
    end_date = Date.today()
    start_date = end_date - timedelta(days=bounded_days - 1)
    return start_date, end_date


def read_domain_category_map(
    connection: sqlite3.Connection,
    user_id: int,
    profile_id: Optional[str] = None,
) -> dict[str, dict]:
    scopes = ["global"]
    if profile_id:
        scopes.append(profile_scope(profile_id))

    placeholders = ",".join("?" for _ in scopes)
    rows = connection.execute(
        f"""
        SELECT domain, profile_id, category, productivity, source, updated_at
        FROM domain_categories
        WHERE user_id = ? AND profile_id IN ({placeholders})
        ORDER BY CASE WHEN profile_id = 'global' THEN 0 ELSE 1 END
        """,
        (user_id, *scopes),
    ).fetchall()

    mapping: dict[str, dict] = {}
    for row in rows:
        mapping[row["domain"]] = {
            "domain": row["domain"],
            "profileId": None if row["profile_id"] == "global" else row["profile_id"],
            "category": row["category"],
            "productivity": normalize_productivity(row["productivity"]),
            "source": row["source"],
            "updatedAt": row["updated_at"],
        }
    return mapping


def category_for_domain_from_map(domain: str, mapping: dict[str, dict]) -> dict:
    normalized = normalize_domain_name(domain)
    for rule_domain in sorted(mapping.keys(), key=len, reverse=True):
        if normalized == rule_domain or normalized.endswith(f".{rule_domain}"):
            item = mapping[rule_domain]
            return {
                "category": item["category"],
                "productivity": normalize_productivity(item["productivity"]),
            }
    return default_category_for_domain(normalized)


def upsert_domain_category(
    connection: sqlite3.Connection,
    user_id: int,
    payload: DomainCategoryPayload,
) -> dict:
    domain = normalize_domain_name(payload.domain)
    productivity = normalize_productivity(payload.productivity)
    category = normalize_category_name(payload.category, productivity)
    scope = profile_scope(payload.profileId)
    now = datetime.utcnow().isoformat(timespec="seconds")

    connection.execute(
        """
        INSERT INTO domain_categories (
            user_id, domain, profile_id, category, productivity,
            source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, domain, profile_id)
        DO UPDATE SET
            category = excluded.category,
            productivity = excluded.productivity,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        (
            user_id,
            domain,
            scope,
            category,
            productivity,
            payload.source.strip() or "manual",
            now,
            now,
        ),
    )
    return {
        "domain": domain,
        "profileId": None if scope == "global" else scope,
        "category": category,
        "productivity": productivity,
        "source": payload.source.strip() or "manual",
        "updatedAt": now,
    }


def usage_session_record(
    connection: sqlite3.Connection,
    user_id: int,
    payload: UsageSessionPayload,
) -> dict:
    domain = normalize_domain_name(payload.domain)
    mapping = read_domain_category_map(connection, user_id, payload.profileId)
    category_info = category_for_domain_from_map(domain, mapping)
    category = payload.category or category_info["category"]
    duration_minutes = (
        float(payload.durationMinutes)
        if payload.durationMinutes is not None
        else seconds_between(payload.startedAt, payload.endedAt) / 60
    )
    external_id = payload.externalId or (
        f"{domain}:{payload.startedAt.isoformat()}:{payload.endedAt.isoformat()}:{payload.reasonEnded}"
    )
    now = datetime.utcnow().isoformat(timespec="seconds")

    connection.execute(
        """
        INSERT INTO usage_sessions (
            user_id, external_id, domain, category, profile_id, started_at,
            ended_at, duration_minutes, reason_ended, source, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, external_id)
        DO UPDATE SET
            domain = excluded.domain,
            category = excluded.category,
            profile_id = excluded.profile_id,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            duration_minutes = excluded.duration_minutes,
            reason_ended = excluded.reason_ended,
            source = excluded.source
        """,
        (
            user_id,
            external_id,
            domain,
            category,
            payload.profileId,
            payload.startedAt.isoformat(),
            payload.endedAt.isoformat(),
            round(max(0.0, duration_minutes), 2),
            payload.reasonEnded.strip() or "tab_change",
            payload.source.strip() or "extension",
            now,
        ),
    )
    return {
        "externalId": external_id,
        "domain": domain,
        "category": category,
        "profileId": payload.profileId,
        "durationMinutes": round(max(0.0, duration_minutes), 2),
    }


def daily_domain_minutes(
    connection: sqlite3.Connection,
    user_id: int,
    start_date: Date,
    end_date: Date,
) -> list[dict]:
    rows = connection.execute(
        """
        SELECT usage_date, domain, SUM(minutes) AS minutes
        FROM user_daily_usage
        WHERE user_id = ? AND usage_date BETWEEN ? AND ?
        GROUP BY usage_date, domain
        ORDER BY usage_date ASC, minutes DESC
        """,
        (user_id, start_date.isoformat(), end_date.isoformat()),
    ).fetchall()
    return [
        {
            "date": row["usage_date"],
            "domain": row["domain"],
            "minutes": round(float(row["minutes"] or 0), 2),
        }
        for row in rows
    ]


def usage_session_rows(
    connection: sqlite3.Connection,
    user_id: int,
    start_date: Date,
    end_date: Date,
) -> list[dict]:
    end_exclusive = (end_date + timedelta(days=1)).isoformat()
    rows = connection.execute(
        """
        SELECT id, domain, category, profile_id, started_at, ended_at,
               duration_minutes, reason_ended, source
        FROM usage_sessions
        WHERE user_id = ? AND started_at >= ? AND started_at < ?
        ORDER BY started_at ASC
        """,
        (user_id, start_date.isoformat(), end_exclusive),
    ).fetchall()
    return [dict(row) for row in rows]


def task_session_rows(
    connection: sqlite3.Connection,
    user_id: int,
    start_date: Date,
    end_date: Date,
) -> list[dict]:
    end_exclusive = (end_date + timedelta(days=1)).isoformat()
    rows = connection.execute(
        """
        SELECT profile_id, profile_name, task_group, started_at, ended_at,
               duration_minutes, allowed_minutes, blocked_minutes, idle_minutes,
               tab_switches, blocked_attempts, override_count, quality_score,
               distracting_domain_counts
        FROM task_sessions
        WHERE user_id = ? AND started_at >= ? AND started_at < ?
        ORDER BY started_at ASC
        """,
        (user_id, start_date.isoformat(), end_exclusive),
    ).fetchall()
    return [dict(row) for row in rows]


def category_totals_from_daily(daily_rows: list[dict], category_map: dict[str, dict]) -> dict:
    totals = {"productive": 0.0, "distracting": 0.0, "neutral": 0.0}
    for row in daily_rows:
        info = category_for_domain_from_map(row["domain"], category_map)
        totals[info["productivity"]] += float(row["minutes"] or 0)
    total = sum(totals.values())
    return {
        "productiveMinutes": round(totals["productive"], 2),
        "distractingMinutes": round(totals["distracting"], 2),
        "neutralMinutes": round(totals["neutral"], 2),
        "totalMinutes": round(total, 2),
        "productiveRatio": round((totals["productive"] / total) * 100) if total else 0,
        "distractingRatio": round((totals["distracting"] / total) * 100) if total else 0,
    }


def domain_breakdown_from_daily(daily_rows: list[dict], category_map: dict[str, dict]) -> list[dict]:
    totals: dict[str, float] = {}
    for row in daily_rows:
        totals[row["domain"]] = totals.get(row["domain"], 0.0) + float(row["minutes"] or 0)
    total_minutes = sum(totals.values())
    items = []
    for domain, minutes in sorted(totals.items(), key=lambda item: item[1], reverse=True):
        info = category_for_domain_from_map(domain, category_map)
        items.append(
            {
                "domain": domain,
                "minutes": round(minutes, 2),
                "percentage": round((minutes / total_minutes) * 100, 1) if total_minutes else 0,
                "category": info["category"],
                "productivity": info["productivity"],
            }
        )
    return items


def daily_trend_from_rows(daily_rows: list[dict], start_date: Date, end_date: Date) -> list[dict]:
    totals = {key: 0.0 for key in date_keys_between(start_date, end_date)}
    for row in daily_rows:
        totals[row["date"]] = totals.get(row["date"], 0.0) + float(row["minutes"] or 0)
    return [{"date": key, "minutes": round(value, 2)} for key, value in totals.items()]


def weekly_trend_from_daily(daily_trend: list[dict]) -> list[dict]:
    weeks: dict[str, float] = {}
    for item in daily_trend:
        value = Date.fromisoformat(item["date"])
        monday = value - timedelta(days=value.weekday())
        key = monday.isoformat()
        weeks[key] = weeks.get(key, 0.0) + float(item["minutes"] or 0)
    return [{"weekStart": key, "minutes": round(value, 2)} for key, value in sorted(weeks.items())]


def hourly_heatmap_from_sessions(session_rows: list[dict], category_map: dict[str, dict]) -> list[dict]:
    buckets = {
        (weekday, hour): {"weekday": weekday, "hour": hour, "minutes": 0.0, "productiveMinutes": 0.0}
        for weekday in range(7)
        for hour in range(24)
    }
    for row in session_rows:
        try:
            started = parse_stored_datetime(row["started_at"])
        except ValueError:
            continue
        key = (started.weekday(), started.hour)
        minutes = float(row["duration_minutes"] or 0)
        info = category_for_domain_from_map(row["domain"], category_map)
        buckets[key]["minutes"] += minutes
        if info["productivity"] == "productive":
            buckets[key]["productiveMinutes"] += minutes
    return [
        {
            "weekday": value["weekday"],
            "hour": value["hour"],
            "minutes": round(value["minutes"], 2),
            "productiveMinutes": round(value["productiveMinutes"], 2),
        }
        for value in buckets.values()
    ]


def most_productive_hours(session_rows: list[dict], category_map: dict[str, dict], limit: int = 3) -> list[dict]:
    buckets: dict[int, float] = {}
    for row in session_rows:
        info = category_for_domain_from_map(row["domain"], category_map)
        if info["productivity"] != "productive":
            continue
        try:
            hour = parse_stored_datetime(row["started_at"]).hour
        except ValueError:
            continue
        buckets[hour] = buckets.get(hour, 0.0) + float(row["duration_minutes"] or 0)
    return [
        {"hour": hour, "minutes": round(minutes, 2)}
        for hour, minutes in sorted(buckets.items(), key=lambda item: item[1], reverse=True)[:limit]
    ]


def longest_focus_streak_minutes(session_rows: list[dict], category_map: dict[str, dict]) -> float:
    productive = []
    for row in session_rows:
        info = category_for_domain_from_map(row["domain"], category_map)
        if info["productivity"] != "productive":
            continue
        try:
            productive.append((parse_stored_datetime(row["started_at"]), parse_stored_datetime(row["ended_at"])))
        except ValueError:
            continue
    productive.sort(key=lambda item: item[0])

    longest = 0.0
    current_start = None
    current_end = None
    for started, ended in productive:
        if current_start is None:
            current_start, current_end = started, ended
            continue
        gap_minutes = (started - current_end).total_seconds() / 60
        if gap_minutes <= 5:
            current_end = max(current_end, ended)
        else:
            longest = max(longest, (current_end - current_start).total_seconds() / 60)
            current_start, current_end = started, ended
    if current_start is not None and current_end is not None:
        longest = max(longest, (current_end - current_start).total_seconds() / 60)
    return round(longest, 2)


def focus_length_distribution(task_rows: list[dict]) -> list[dict]:
    bins = [
        ("0-15", 0, 15),
        ("15-30", 15, 30),
        ("30-60", 30, 60),
        ("60-120", 60, 120),
        ("120+", 120, 100000),
    ]
    counts = {label: 0 for label, _start, _end in bins}
    for row in task_rows:
        minutes = float(row["duration_minutes"] or row["allowed_minutes"] or 0)
        for label, start, end in bins:
            if start <= minutes < end:
                counts[label] += 1
                break
    return [{"bucket": label, "sessions": count} for label, count in counts.items()]


def profile_analytics_from_task_rows(task_rows: list[dict], profiles: list[dict]) -> list[dict]:
    by_profile: dict[str, dict] = {}
    for profile in profiles:
        by_profile[profile["id"]] = {
            "profileId": profile["id"],
            "profileName": profile["name"],
            "group": profile.get("group") or "focus",
            "totalFocusMinutes": 0.0,
            "blockedMinutes": 0.0,
            "sessionCount": 0,
            "blockedAttempts": 0,
            "overrideCount": 0,
            "averageQuality": None,
            "_qualityTotal": 0,
            "_domainCounts": {},
        }

    for row in task_rows:
        key = row["profile_id"] or f"ad-hoc:{row['profile_name']}"
        item = by_profile.setdefault(
            key,
            {
                "profileId": key,
                "profileName": row["profile_name"],
                "group": row["task_group"],
                "totalFocusMinutes": 0.0,
                "blockedMinutes": 0.0,
                "sessionCount": 0,
                "blockedAttempts": 0,
                "overrideCount": 0,
                "averageQuality": None,
                "_qualityTotal": 0,
                "_domainCounts": {},
            },
        )
        item["totalFocusMinutes"] += float(row["allowed_minutes"] or row["duration_minutes"] or 0)
        item["blockedMinutes"] += float(row["blocked_minutes"] or 0)
        item["blockedAttempts"] += int(row["blocked_attempts"] or 0)
        item["overrideCount"] += int(row["override_count"] or 0)
        item["sessionCount"] += 1
        item["_qualityTotal"] += int(row["quality_score"] or 0)
        try:
            domain_counts = json.loads(row["distracting_domain_counts"] or "{}")
        except json.JSONDecodeError:
            domain_counts = {}
        for domain, count in domain_counts.items():
            item["_domainCounts"][domain] = item["_domainCounts"].get(domain, 0) + int(count or 0)

    output = []
    for item in by_profile.values():
        item["totalFocusMinutes"] = round(item["totalFocusMinutes"], 2)
        item["blockedMinutes"] = round(item["blockedMinutes"], 2)
        if item["sessionCount"]:
            item["averageQuality"] = round(item["_qualityTotal"] / item["sessionCount"])
        item["leakageRate"] = round(
            (item["blockedMinutes"] / (item["totalFocusMinutes"] + item["blockedMinutes"])) * 100,
            1,
        ) if item["totalFocusMinutes"] + item["blockedMinutes"] else 0
        item["mostDistractingDomains"] = [
            {"domain": domain, "count": count}
            for domain, count in sorted(item["_domainCounts"].items(), key=lambda pair: pair[1], reverse=True)[:5]
        ]
        del item["_qualityTotal"]
        del item["_domainCounts"]
        output.append(item)
    return sorted(output, key=lambda item: item["totalFocusMinutes"], reverse=True)


def focus_decay_estimate(task_rows: list[dict]) -> dict:
    scored = [row for row in task_rows if row.get("quality_score") is not None]
    if len(scored) < 4:
        return {"delta": 0, "label": "Not enough focus sessions yet"}
    midpoint = len(scored) // 2
    first = sum(int(row["quality_score"] or 0) for row in scored[:midpoint]) / midpoint
    second = sum(int(row["quality_score"] or 0) for row in scored[midpoint:]) / (len(scored) - midpoint)
    delta = round(second - first, 1)
    if delta < -8:
        label = "Focus quality decays later in the selected period"
    elif delta > 8:
        label = "Focus quality improves later in the selected period"
    else:
        label = "Focus quality is broadly stable"
    return {"delta": delta, "label": label}


def productivity_score(
    category_totals: dict,
    context_switches: int,
    longest_focus_minutes: float,
) -> Optional[int]:
    total = float(category_totals["productiveMinutes"] + category_totals["distractingMinutes"])
    if total <= 0:
        return None
    ratio_points = (category_totals["productiveMinutes"] / total) * 80
    focus_bonus = min(15, (longest_focus_minutes / 90) * 15)
    switch_penalty = min(25, context_switches * 1.25)
    return round(clamp_number(ratio_points + focus_bonus - switch_penalty, 0, 100))


def load_profiles(connection: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = connection.execute(
        """
        SELECT profile_id, name, task_group
        FROM task_profiles
        WHERE user_id = ?
        ORDER BY name ASC
        """,
        (user_id,),
    ).fetchall()
    return [{"id": row["profile_id"], "name": row["name"], "group": row["task_group"]} for row in rows]


def weekly_start_for(value: Date) -> Date:
    return value - timedelta(days=value.weekday())


def build_weekly_report(connection: sqlite3.Connection, user_id: int, week_start: Date) -> dict:
    week_end = week_start + timedelta(days=6)
    category_map = read_domain_category_map(connection, user_id)
    daily_rows = daily_domain_minutes(connection, user_id, week_start, week_end)
    sessions = usage_session_rows(connection, user_id, week_start, week_end)
    task_rows = task_session_rows(connection, user_id, week_start, week_end)
    profiles = load_profiles(connection, user_id)
    category_totals = category_totals_from_daily(daily_rows, category_map)
    domain_items = domain_breakdown_from_daily(daily_rows, category_map)
    context_switches = len([row for row in sessions if row["reason_ended"] == "tab_change"])
    longest_streak = longest_focus_streak_minutes(sessions, category_map)
    score = productivity_score(category_totals, context_switches, longest_streak)
    profile_items = profile_analytics_from_task_rows(task_rows, profiles)
    generated_at = datetime.utcnow().isoformat(timespec="seconds")

    metrics = {
        "weekStart": week_start.isoformat(),
        "weekEnd": week_end.isoformat(),
        "totalMinutes": category_totals["totalMinutes"],
        "productiveMinutes": category_totals["productiveMinutes"],
        "distractingMinutes": category_totals["distractingMinutes"],
        "productivityScore": score,
        "contextSwitchCount": context_switches,
        "longestFocusStreakMinutes": longest_streak,
        "topDomains": domain_items[:5],
        "mostProductiveHours": most_productive_hours(sessions, category_map),
        "focusDecay": focus_decay_estimate(task_rows),
        "profiles": profile_items[:6],
    }
    narrative = (
        "No tracked usage for this week yet."
        if category_totals["totalMinutes"] <= 0
        else f"{round(category_totals['productiveRatio'])}% of categorized time was productive with {context_switches} context switches."
    )
    connection.execute(
        """
        INSERT INTO weekly_reports (user_id, week_start, generated_at, metrics, narrative)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, week_start)
        DO UPDATE SET
            generated_at = excluded.generated_at,
            metrics = excluded.metrics,
            narrative = excluded.narrative
        """,
        (user_id, week_start.isoformat(), generated_at, json.dumps(metrics), narrative),
    )
    return {"generatedAt": generated_at, "narrative": narrative, "metrics": metrics}


@app.get("/login", response_class=HTMLResponse)
def login_page() -> str:
    return """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LifeCycle Sign In</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 360px; margin: 48px auto; padding: 0 20px; color: #1a1a18; }
    h1 { font-size: 22px; margin-bottom: 6px; }
    p { color: #6b6a65; font-size: 14px; line-height: 1.5; }
    form { display: grid; gap: 10px; margin-top: 20px; }
    input, button { font: inherit; padding: 10px 12px; border-radius: 6px; }
    input { border: 1px solid rgba(0,0,0,.16); }
    button { border: 0; background: #185fa5; color: white; cursor: pointer; }
    button.secondary { background: #f0efed; color: #1a1a18; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .error { min-height: 18px; color: #a32d2d; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Sign in to LifeCycle</h1>
  <p>Use the same account on each device to sync your browsing history.</p>
  <form id="auth-form">
    <input id="email" type="email" autocomplete="email" placeholder="Email" required>
    <input id="password" type="password" autocomplete="current-password" placeholder="Password" required minlength="8">
    <div class="actions">
      <button type="submit" data-mode="login">Sign in</button>
      <button class="secondary" type="button" id="register-btn">Register</button>
    </div>
    <div class="error" id="error"></div>
  </form>
  <script>
    const form = document.getElementById("auth-form");
    const registerBtn = document.getElementById("register-btn");
    const errorEl = document.getElementById("error");

    async function submit(mode) {
      errorEl.textContent = "";
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;
      const res = await fetch(`/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.detail || "Authentication failed";
        return;
      }
      const params = new URLSearchParams({ token: data.token, email: data.email, userId: data.userId });
      location.href = `/extension-callback?${params.toString()}`;
    }

    form.addEventListener("submit", event => {
      event.preventDefault();
      submit("login");
    });
    registerBtn.addEventListener("click", () => submit("register"));
  </script>
</body>
</html>
"""


@app.get("/extension-callback", response_class=HTMLResponse)
def extension_callback() -> str:
    return "<p>You can close this tab and return to LifeCycle.</p>"


@app.post("/auth/register")
def register(payload: AuthPayload) -> dict:
    email = normalize_email(payload.email)
    if len(payload.password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    password_hash, salt = hash_password(payload.password)
    now = datetime.utcnow().isoformat(timespec="seconds")

    init_db()
    with connect() as connection:
        try:
            cursor = connection.execute(
                """
                INSERT INTO users (email, password_hash, salt, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (email, password_hash, salt, now),
            )
            connection.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Email already registered") from exc

        user = connection.execute(
            "SELECT id, email FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return user_response(user, create_token(user["id"], user["email"]))


@app.post("/auth/login")
def login(payload: AuthPayload) -> dict:
    email = normalize_email(payload.email)

    init_db()
    with connect() as connection:
        user = connection.execute(
            "SELECT id, email, password_hash, salt FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if not user or not verify_password(payload.password, user["salt"], user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return user_response(user, create_token(user["id"], user["email"]))


@app.get("/auth/me")
def me(user: dict = Depends(current_user)) -> dict:
    return {"userId": user["id"], "email": user["email"]}


@app.post("/auth/logout")
def logout(_user: dict = Depends(current_user)) -> dict:
    return {"ok": True}


@app.post("/usage")
def save_usage(
    payload: UsagePayload,
    user: Optional[dict] = Depends(optional_current_user),
    database: SqlAlchemySession = Depends(get_db),
) -> dict:
    usage_date = payload.date or Date.today()
    clean_usage = {
        normalize_domain_name(domain): max(0.0, float(minutes))
        for domain, minutes in payload.usage.items()
        if domain.strip()
    }

    init_db()
    now = datetime.utcnow().isoformat(timespec="seconds")
    user_id = user["id"] if user else None

    if user_id:
        with connect() as connection:
            if payload.tracked:
                connection.execute(
                    """
                    INSERT INTO user_tracked_dates (user_id, usage_date, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, usage_date)
                    DO UPDATE SET updated_at = excluded.updated_at
                    """,
                    (user_id, date_key(usage_date), now),
                )

            for domain, minutes in clean_usage.items():
                connection.execute(
                    """
                    INSERT INTO user_daily_usage (user_id, usage_date, domain, minutes, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, usage_date, domain)
                    DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at
                    """,
                    (user_id, date_key(usage_date), domain, round(minutes, 2), now),
                )

            connection.commit()
            insights = compute_insights(connection, usage_date, BASELINE_WEEKDAY_OCCURRENCES, user_id)
    else:
        for domain, minutes in clean_usage.items():
            database.merge(
                DailyUsage(
                    date=date_key(usage_date),
                    domain=domain,
                    minutes=round(minutes, 2),
                    has_tracking_coverage=bool(payload.tracked),
                )
            )

        if payload.tracked:
            database.execute(
                text(
                    """
                    INSERT INTO tracked_dates (usage_date, updated_at)
                    VALUES (:usage_date, :updated_at)
                    ON CONFLICT(usage_date)
                    DO UPDATE SET updated_at = excluded.updated_at
                    """
                ),
                {"usage_date": date_key(usage_date), "updated_at": now},
            )

        database.commit()
        with connect() as connection:
            insights = compute_insights(connection, usage_date, BASELINE_WEEKDAY_OCCURRENCES)

    return {
        "date": date_key(usage_date),
        "stored_domains": len(clean_usage),
        "insights": insights,
    }


@app.get("/usage")
def read_usage_by_query(
    usage_date: Optional[Date] = Query(default=None, alias="date"),
    user: Optional[dict] = Depends(optional_current_user),
) -> dict:
    value = usage_date or Date.today()
    init_db()
    with connect() as connection:
        usage = usage_for_date(connection, value, user["id"] if user else None)

    return {"date": date_key(value), "usage": usage}


@app.get("/usage/history")
def read_usage_history(user: Optional[dict] = Depends(optional_current_user)) -> dict:
    init_db()
    with connect() as connection:
        if user:
            rows = connection.execute(
                """
                SELECT usage_date, domain, minutes
                FROM user_daily_usage
                WHERE user_id = ?
                ORDER BY usage_date ASC, minutes DESC
                """,
                (user["id"],),
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT date AS usage_date, domain, minutes
                FROM daily_usage
                ORDER BY date ASC, minutes DESC
                """
            ).fetchall()

    history: dict[str, dict[str, float]] = {}
    for row in rows:
        history.setdefault(row["usage_date"], {})[row["domain"]] = round(float(row["minutes"]), 2)

    return {"history": history}


@app.post("/sessions")
def save_local_sessions(
    payload: dict = Body(...),
    database: SqlAlchemySession = Depends(get_db),
) -> dict:
    init_db()
    raw_sessions = payload.get("sessions") if isinstance(payload, dict) and "sessions" in payload else [payload]
    stored: list[BrowsingSession] = []

    for raw_session in raw_sessions or []:
        session_payload = LocalSessionPayload(**raw_session)
        started_at, ended_at = local_session_times(session_payload)
        domain = normalize_domain_name(session_payload.domain)
        session = BrowsingSession(
            id=session_payload.id or str(uuid4()),
            domain=domain,
            start_time=started_at,
            end_time=ended_at,
            duration_minutes=local_session_duration(session_payload, started_at, ended_at),
        )
        stored.append(database.merge(session))

    database.commit()
    return {"stored": len(stored), "sessions": [local_session_record(session) for session in stored]}


@app.get("/sessions")
def read_local_sessions(
    domain: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    database: SqlAlchemySession = Depends(get_db),
) -> dict:
    init_db()
    query = database.query(BrowsingSession)
    if domain:
        query = query.filter(BrowsingSession.domain == normalize_domain_name(domain))
    rows = query.order_by(BrowsingSession.end_time.desc()).limit(limit).all()
    return {"sessions": [local_session_record(session) for session in rows]}


@app.get("/categories")
def read_local_categories(database: SqlAlchemySession = Depends(get_db)) -> dict:
    init_db()
    rows = database.query(Category).order_by(Category.domain.asc()).all()
    return {"categories": [local_category_record(category) for category in rows]}


@app.put("/categories/{domain}")
def update_local_category(
    domain: str,
    payload: CategoryUpdatePayload,
    database: SqlAlchemySession = Depends(get_db),
) -> dict:
    init_db()
    category = Category(domain=normalize_domain_name(domain), category=normalize_productivity(payload.category))
    database.merge(category)
    database.commit()
    return {"category": local_category_record(category)}


@app.get("/task-profiles")
def read_task_profiles(user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT profile_id, name, task_group, allowed_domains, blocked_domains,
                   default_duration_minutes, created_at, updated_at
            FROM task_profiles
            WHERE user_id = ?
            ORDER BY name ASC
            """,
            (user["id"],),
        ).fetchall()

    profiles = []
    for row in rows:
        profiles.append(
            {
                "id": row["profile_id"],
                "name": row["name"],
                "group": row["task_group"],
                "allowedDomains": json.loads(row["allowed_domains"] or "[]"),
                "blockedDomains": json.loads(row["blocked_domains"] or "[]"),
                "defaultDurationMinutes": int(row["default_duration_minutes"] or 60),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
        )

    return {"profiles": profiles}


@app.post("/task-profiles")
def save_task_profile(payload: TaskProfilePayload, user: dict = Depends(current_user)) -> dict:
    now = datetime.utcnow()
    created_at = payload.createdAt or now
    updated_at = payload.updatedAt or now

    init_db()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO task_profiles (
                user_id, profile_id, name, task_group, allowed_domains, blocked_domains,
                default_duration_minutes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, profile_id)
            DO UPDATE SET
                name = excluded.name,
                task_group = excluded.task_group,
                allowed_domains = excluded.allowed_domains,
                blocked_domains = excluded.blocked_domains,
                default_duration_minutes = excluded.default_duration_minutes,
                updated_at = excluded.updated_at
            """,
            (
                user["id"],
                payload.id,
                payload.name.strip() or "Focus",
                payload.group.strip().lower() or "focus",
                json.dumps(payload.allowedDomains),
                json.dumps(payload.blockedDomains),
                max(5, min(480, int(payload.defaultDurationMinutes or 60))),
                created_at.isoformat(),
                updated_at.isoformat(),
            ),
        )
        connection.commit()

    return {
        "profile": {
            "id": payload.id,
            "name": payload.name.strip() or "Focus",
            "group": payload.group.strip().lower() or "focus",
            "allowedDomains": payload.allowedDomains,
            "blockedDomains": payload.blockedDomains,
            "defaultDurationMinutes": max(5, min(480, int(payload.defaultDurationMinutes or 60))),
            "createdAt": created_at.isoformat(),
            "updatedAt": updated_at.isoformat(),
        }
    }


@app.delete("/task-profiles/{profile_id}")
def delete_task_profile(profile_id: str, user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        connection.execute(
            "DELETE FROM task_profiles WHERE user_id = ? AND profile_id = ?",
            (user["id"], profile_id),
        )
        connection.commit()

    return {"deleted": True, "profileId": profile_id}


@app.post("/task-sessions")
def save_task_session(payload: TaskSessionPayload, user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        now = datetime.utcnow().isoformat(timespec="seconds")
        cursor = connection.execute(
            """
            INSERT INTO task_sessions (
                user_id, profile_id, profile_name, title, task_group,
                started_at, ended_at, duration_minutes, allowed_minutes,
                blocked_minutes, idle_minutes, tab_switches, blocked_attempts,
                override_count, quality_score, distracting_domain_counts,
                override_log, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                payload.profileId,
                payload.profileName,
                payload.title,
                payload.group,
                payload.startedAt.isoformat(),
                payload.endedAt.isoformat(),
                max(0.0, float(payload.durationMinutes)),
                max(0.0, float(payload.allowedMinutes)),
                max(0.0, float(payload.blockedMinutes)),
                max(0.0, float(payload.idleMinutes)),
                max(0, int(payload.tabSwitches)),
                max(0, int(payload.blockedAttempts)),
                max(0, int(payload.overrideCount)),
                max(0, min(100, int(payload.qualityScore))),
                json.dumps(payload.distractingDomainCounts),
                json.dumps(payload.overrideLog),
                now,
            ),
        )
        connection.commit()

    return {"id": cursor.lastrowid, "stored": True}


@app.get("/task-sessions/analytics")
def read_task_session_analytics(user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT profile_id, profile_name, allowed_minutes, blocked_attempts,
                   override_count, quality_score, distracting_domain_counts
            FROM task_sessions
            WHERE user_id = ?
            """,
            (user["id"],),
        ).fetchall()

    analytics: dict[str, dict] = {}
    for row in rows:
        key = row["profile_id"] or f"ad-hoc:{row['profile_name']}"
        item = analytics.setdefault(
            key,
            {
                "profileId": key,
                "profileName": row["profile_name"],
                "totalFocusMinutes": 0,
                "blockedAttempts": 0,
                "overrideCount": 0,
                "sessionCount": 0,
                "_qualityTotal": 0,
                "_domainCounts": {},
            },
        )
        item["totalFocusMinutes"] += round(float(row["allowed_minutes"] or 0))
        item["blockedAttempts"] += int(row["blocked_attempts"] or 0)
        item["overrideCount"] += int(row["override_count"] or 0)
        item["sessionCount"] += 1
        item["_qualityTotal"] += int(row["quality_score"] or 0)

        try:
            domain_counts = json.loads(row["distracting_domain_counts"] or "{}")
        except json.JSONDecodeError:
            domain_counts = {}

        for domain, count in domain_counts.items():
            item["_domainCounts"][domain] = item["_domainCounts"].get(domain, 0) + int(count or 0)

    for item in analytics.values():
        item["averageSessionQuality"] = (
            round(item["_qualityTotal"] / item["sessionCount"])
            if item["sessionCount"]
            else None
        )
        item["mostDistractingDomains"] = [
            {"domain": domain, "count": count}
            for domain, count in sorted(item["_domainCounts"].items(), key=lambda pair: pair[1], reverse=True)[:3]
        ]
        del item["_qualityTotal"]
        del item["_domainCounts"]

    return {"profiles": analytics}


@app.get("/domain-categories")
def read_domain_categories(
    profile_id: Optional[str] = Query(default=None, alias="profileId"),
    user: dict = Depends(current_user),
) -> dict:
    init_db()
    with connect() as connection:
        mapping = read_domain_category_map(connection, user["id"], profile_id)
    return {"categories": list(mapping.values())}


@app.post("/domain-categories")
def save_domain_category(payload: DomainCategoryPayload, user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        category = upsert_domain_category(connection, user["id"], payload)
        connection.commit()
    return {"category": category}


@app.post("/task-profiles/{profile_id}/domains")
def assign_domain_to_task_profile(
    profile_id: str,
    payload: DomainCategoryPayload,
    user: dict = Depends(current_user),
) -> dict:
    init_db()
    scoped_payload = DomainCategoryPayload(
        domain=payload.domain,
        category=payload.category,
        productivity=payload.productivity,
        profileId=profile_id,
        source=payload.source,
    )
    with connect() as connection:
        category = upsert_domain_category(connection, user["id"], scoped_payload)
        connection.commit()
    return {"category": category}


@app.post("/usage-sessions")
def save_usage_sessions(
    payload: dict = Body(...),
    user: dict = Depends(current_user),
) -> dict:
    init_db()
    if "sessions" in payload:
        sessions = [UsageSessionPayload(**item) for item in payload.get("sessions") or []]
    else:
        sessions = [UsageSessionPayload(**payload)]
    stored = []
    with connect() as connection:
        for session in sessions:
            if session.endedAt <= session.startedAt:
                continue
            stored.append(usage_session_record(connection, user["id"], session))
        connection.commit()
    return {"stored": len(stored), "sessions": stored}


@app.get("/dashboard/summary")
def read_dashboard_summary(
    days: int = Query(default=30, ge=1, le=180),
    user: dict = Depends(current_user),
) -> dict:
    start_date, end_date = analytics_window(days)
    today = Date.today()
    previous_start = start_date - timedelta(days=days)
    previous_end = start_date - timedelta(days=1)

    init_db()
    with connect() as connection:
        category_map = read_domain_category_map(connection, user["id"])
        daily_rows = daily_domain_minutes(connection, user["id"], start_date, end_date)
        previous_rows = daily_domain_minutes(connection, user["id"], previous_start, previous_end)
        today_rows = daily_domain_minutes(connection, user["id"], today, today)
        sessions = usage_session_rows(connection, user["id"], start_date, end_date)
        task_rows = task_session_rows(connection, user["id"], start_date, end_date)

    totals = category_totals_from_daily(daily_rows, category_map)
    today_totals = category_totals_from_daily(today_rows, category_map)
    previous_totals = category_totals_from_daily(previous_rows, category_map)
    context_switches = len([row for row in sessions if row["reason_ended"] == "tab_change"])
    longest_streak = longest_focus_streak_minutes(sessions, category_map)
    score = productivity_score(totals, context_switches, longest_streak)
    previous_score = productivity_score(
        previous_totals,
        0,
        0,
    )

    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat(), "days": days},
        "hasData": totals["totalMinutes"] > 0 or len(task_rows) > 0,
        "score": score,
        "scoreDelta": None if score is None or previous_score is None else score - previous_score,
        "today": today_totals,
        "totals": totals,
        "topDomains": domain_breakdown_from_daily(daily_rows, category_map)[:5],
        "contextSwitchCount": context_switches,
        "longestFocusStreakMinutes": longest_streak,
        "focusSessionCount": len(task_rows),
        "focusDecay": focus_decay_estimate(task_rows),
        "mostProductiveHours": most_productive_hours(sessions, category_map),
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds"),
    }


@app.get("/analytics/time-series")
def read_time_series(
    days: int = Query(default=30, ge=1, le=180),
    user: dict = Depends(current_user),
) -> dict:
    start_date, end_date = analytics_window(days)
    init_db()
    with connect() as connection:
        category_map = read_domain_category_map(connection, user["id"])
        daily_rows = daily_domain_minutes(connection, user["id"], start_date, end_date)
        sessions = usage_session_rows(connection, user["id"], start_date, end_date)
    daily_trend = daily_trend_from_rows(daily_rows, start_date, end_date)
    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat(), "days": days},
        "daily": daily_trend,
        "weekly": weekly_trend_from_daily(daily_trend),
        "hourlyHeatmap": hourly_heatmap_from_sessions(sessions, category_map),
    }


@app.get("/analytics/domains")
def read_domain_analytics(
    days: int = Query(default=30, ge=1, le=180),
    user: dict = Depends(current_user),
) -> dict:
    start_date, end_date = analytics_window(days)
    init_db()
    with connect() as connection:
        category_map = read_domain_category_map(connection, user["id"])
        daily_rows = daily_domain_minutes(connection, user["id"], start_date, end_date)
        sessions = usage_session_rows(connection, user["id"], start_date, end_date)

    session_counts: dict[str, int] = {}
    session_minutes: dict[str, float] = {}
    for row in sessions:
        session_counts[row["domain"]] = session_counts.get(row["domain"], 0) + 1
        session_minutes[row["domain"]] = session_minutes.get(row["domain"], 0.0) + float(row["duration_minutes"] or 0)

    domains = domain_breakdown_from_daily(daily_rows, category_map)
    for item in domains:
        count = session_counts.get(item["domain"], 0)
        item["sessionCount"] = count
        item["averageSessionMinutes"] = round(session_minutes.get(item["domain"], 0.0) / count, 2) if count else None

    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat(), "days": days},
        "domains": domains,
        "categoryTotals": category_totals_from_daily(daily_rows, category_map),
    }


@app.get("/analytics/profiles")
def read_profile_analytics(
    days: int = Query(default=30, ge=1, le=180),
    user: dict = Depends(current_user),
) -> dict:
    start_date, end_date = analytics_window(days)
    init_db()
    with connect() as connection:
        profiles = load_profiles(connection, user["id"])
        task_rows = task_session_rows(connection, user["id"], start_date, end_date)
    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat(), "days": days},
        "profiles": profile_analytics_from_task_rows(task_rows, profiles),
        "focusLengthDistribution": focus_length_distribution(task_rows),
        "focusDecay": focus_decay_estimate(task_rows),
    }


@app.get("/analytics/focus-sessions")
def read_focus_session_analytics(
    days: int = Query(default=30, ge=1, le=180),
    user: dict = Depends(current_user),
) -> dict:
    start_date, end_date = analytics_window(days)
    init_db()
    with connect() as connection:
        task_rows = task_session_rows(connection, user["id"], start_date, end_date)

    quality_trend = [
        {
            "date": parse_stored_datetime(row["ended_at"]).date().isoformat(),
            "profileName": row["profile_name"],
            "qualityScore": int(row["quality_score"] or 0),
            "durationMinutes": round(float(row["duration_minutes"] or 0), 2),
        }
        for row in task_rows
    ]
    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat(), "days": days},
        "distribution": focus_length_distribution(task_rows),
        "qualityTrend": quality_trend,
        "averageQuality": (
            round(sum(item["qualityScore"] for item in quality_trend) / len(quality_trend))
            if quality_trend
            else None
        ),
    }


@app.get("/goals")
def read_goals(user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, metric, target_minutes, period, profile_id, domain,
                   active, created_at, updated_at
            FROM goals
            WHERE user_id = ?
            ORDER BY active DESC, updated_at DESC
            """,
            (user["id"],),
        ).fetchall()
    return {
        "goals": [
            {
                "id": row["id"],
                "metric": row["metric"],
                "targetMinutes": row["target_minutes"],
                "period": row["period"],
                "profileId": row["profile_id"],
                "domain": row["domain"],
                "active": bool(row["active"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
    }


@app.post("/goals")
def create_goal(payload: GoalPayload, user: dict = Depends(current_user)) -> dict:
    now = datetime.utcnow().isoformat(timespec="seconds")
    init_db()
    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO goals (
                user_id, metric, target_minutes, period, profile_id,
                domain, active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                payload.metric.strip().lower(),
                max(0.0, float(payload.targetMinutes)),
                payload.period.strip().lower() or "weekly",
                payload.profileId,
                normalize_domain_name(payload.domain) if payload.domain else None,
                1 if payload.active else 0,
                now,
                now,
            ),
        )
        connection.commit()
        goal_id = cursor.lastrowid
    return {"goal": {"id": goal_id, **payload.model_dump(), "createdAt": now, "updatedAt": now}}


@app.patch("/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalUpdatePayload, user: dict = Depends(current_user)) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return {"updated": False, "goalId": goal_id}

    column_map = {
        "metric": "metric",
        "targetMinutes": "target_minutes",
        "period": "period",
        "profileId": "profile_id",
        "domain": "domain",
        "active": "active",
    }
    assignments = []
    values: list[Any] = []
    for key, value in updates.items():
        assignments.append(f"{column_map[key]} = ?")
        if key == "active":
            values.append(1 if value else 0)
        elif key == "domain" and value:
            values.append(normalize_domain_name(value))
        else:
            values.append(value)
    assignments.append("updated_at = ?")
    values.append(datetime.utcnow().isoformat(timespec="seconds"))
    values.extend([user["id"], goal_id])

    init_db()
    with connect() as connection:
        cursor = connection.execute(
            f"UPDATE goals SET {', '.join(assignments)} WHERE user_id = ? AND id = ?",
            tuple(values),
        )
        connection.commit()
    return {"updated": cursor.rowcount > 0, "goalId": goal_id}


@app.get("/reports/weekly")
def read_weekly_report(
    week_start: Optional[Date] = Query(default=None, alias="weekStart"),
    user: dict = Depends(current_user),
) -> dict:
    selected_week_start = weekly_start_for(week_start or Date.today())
    init_db()
    with connect() as connection:
        report = build_weekly_report(connection, user["id"], selected_week_start)
        connection.commit()
    return report


@app.get("/usage/{usage_date}")
def read_usage(usage_date: Date, user: Optional[dict] = Depends(optional_current_user)) -> dict:
    init_db()
    with connect() as connection:
        usage = usage_for_date(connection, usage_date, user["id"] if user else None)

    if not usage:
        raise HTTPException(status_code=404, detail="No usage found for that date")

    return {"date": date_key(usage_date), "usage": usage}


@app.get("/insights")
def read_insights(
    usage_date: Optional[Date] = Query(default=None, alias="date"),
    weeks: int = Query(default=BASELINE_WEEKDAY_OCCURRENCES, ge=1, le=12),
    user: Optional[dict] = Depends(optional_current_user),
) -> dict:
    value = usage_date or Date.today()
    init_db()

    with connect() as connection:
        return compute_insights(connection, value, weeks, user["id"] if user else None)

