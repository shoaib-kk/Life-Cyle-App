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
from typing import Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


BASELINE_WEEKDAY_OCCURRENCES = 8
FULL_DAY_MINUTES = 24 * 60
ABOVE_BASELINE_THRESHOLD = 0.3
MIN_BASELINE_RECORDS = 2
MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION = 30
MIN_DOMAIN_MINUTES_FOR_PREDICTION = 10
DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "lifecycle.db"
DB_PATH = Path(os.environ.get("LIFECYCLE_DB_PATH", DEFAULT_DB_PATH))
APP_ENV = os.environ.get("LIFECYCLE_ENV", "development").lower()
AUTH_SECRET = os.environ.get("LIFECYCLE_AUTH_SECRET")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "LIFECYCLE_ALLOWED_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000",
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


class AuthPayload(BaseModel):
    email: str
    password: str


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="LifeCycle V1 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
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


def init_db() -> None:
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
            "SELECT domain, minutes FROM daily_usage WHERE usage_date = ? ORDER BY minutes DESC",
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
            "SELECT SUM(minutes) AS total FROM daily_usage WHERE usage_date = ?",
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
def save_usage(payload: UsagePayload, user: dict = Depends(current_user)) -> dict:
    usage_date = payload.date or Date.today()
    clean_usage = {
        domain.strip().lower(): max(0.0, float(minutes))
        for domain, minutes in payload.usage.items()
        if domain.strip()
    }

    init_db()
    with connect() as connection:
        now = datetime.utcnow().isoformat(timespec="seconds")
        user_id = user["id"]

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

    return {
        "date": date_key(usage_date),
        "stored_domains": len(clean_usage),
        "insights": insights,
    }


@app.get("/usage")
def read_usage_by_query(
    usage_date: Optional[Date] = Query(default=None, alias="date"),
    user: dict = Depends(current_user),
) -> dict:
    value = usage_date or Date.today()
    init_db()
    with connect() as connection:
        usage = usage_for_date(connection, value, user["id"])

    return {"date": date_key(value), "usage": usage}


@app.get("/usage/history")
def read_usage_history(user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT usage_date, domain, minutes
            FROM user_daily_usage
            WHERE user_id = ?
            ORDER BY usage_date ASC, minutes DESC
            """,
            (user["id"],),
        ).fetchall()

    history: dict[str, dict[str, float]] = {}
    for row in rows:
        history.setdefault(row["usage_date"], {})[row["domain"]] = round(float(row["minutes"]), 2)

    return {"history": history}


@app.get("/usage/{usage_date}")
def read_usage(usage_date: Date, user: dict = Depends(current_user)) -> dict:
    init_db()
    with connect() as connection:
        usage = usage_for_date(connection, usage_date, user["id"])

    if not usage:
        raise HTTPException(status_code=404, detail="No usage found for that date")

    return {"date": date_key(usage_date), "usage": usage}


@app.get("/insights")
def read_insights(
    usage_date: Optional[Date] = Query(default=None, alias="date"),
    weeks: int = Query(default=BASELINE_WEEKDAY_OCCURRENCES, ge=1, le=12),
    user: dict = Depends(current_user),
) -> dict:
    value = usage_date or Date.today()
    init_db()

    with connect() as connection:
        return compute_insights(connection, value, weeks, user["id"])

