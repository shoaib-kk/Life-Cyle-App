# LifeCycle Product Architecture

## Product Direction

LifeCycle should be a lightweight productivity analytics platform, not a crowded browser popup. The Chrome extension captures accurate activity data and offers fast task-profile controls. The web dashboard owns deeper analytics, visualization, goals, and weekly reports.

## Repository Structure

```text
backend/
  main.py                  FastAPI API, SQLite schema, auth, analytics
dashboard/
  package.json             React dashboard dependencies and scripts
  src/
    api.ts                 Backend client with demo fallback
    demoData.ts            Recruiter-friendly demo data
    App.tsx                Shell, token input, page routing
    components/            Sidebar, metric cards, empty states
    pages/                 Overview, trends, domains, profiles, focus, distractions, reports
extension/
  background.js            Tracking, task sessions, sync
  popup.html               Minimal quick-status popup
  popup.js                 Popup renderer and profile start/stop controls
  popup.css                Minimal popup styles
  manifest.json            Extension metadata and backend permissions
data/
  lifecycle.db             Local SQLite database
```

## Backend API Routes

Auth:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`

Extension sync:

- `POST /usage`
- `GET /usage`
- `GET /usage/history`
- `POST /usage-sessions`
- `POST /task-sessions`

Task profiles and categories:

- `GET /task-profiles`
- `POST /task-profiles`
- `DELETE /task-profiles/{profile_id}`
- `GET /domain-categories`
- `POST /domain-categories`
- `POST /task-profiles/{profile_id}/domains`

Dashboard analytics:

- `GET /dashboard/summary`
- `GET /analytics/time-series`
- `GET /analytics/domains`
- `GET /analytics/profiles`
- `GET /analytics/focus-sessions`
- `GET /reports/weekly`

Goals:

- `GET /goals`
- `POST /goals`
- `PATCH /goals/{goal_id}`

## Database Schema

Core tables:

- `users`: account identity and password hash.
- `user_daily_usage`: daily domain aggregates retained for compatibility and fast totals.
- `usage_sessions`: session-level active-tab records for hourly heatmaps, context switching, focus streaks, and richer analytics.
- `task_profiles`: reusable task modes such as Coding, Studying, Job Hunting, and Entertainment.
- `task_sessions`: explicit focus sessions with quality score, blocked time, overrides, and leakage domains.
- `domain_categories`: global or profile-scoped domain category/productivity labels.
- `goals`: weekly or daily targets.
- `weekly_reports`: generated weekly report snapshots.

SQLite is used through a small `connect()` wrapper and plain SQL. The schema avoids SQLite-only application logic so the storage layer can later move to PostgreSQL behind the same repository boundary.

## Analytics Metrics

- Productive, distracting, and neutral time.
- Top domains and category mix.
- Daily and weekly trend charts.
- Hourly heatmap from session records.
- Focus session length distribution.
- Context-switch count from tab-change session endings.
- Task profile leakage from blocked time and distracting-domain counts.
- Most productive hours.
- Longest focus streak.
- Focus decay estimate from task-session quality trend.
- Simple productivity score based on productive ratio, focus streak bonus, and context-switch penalty.

## Priority Order

1. Stabilize extension tracking and session-level backend sync.
2. Keep popup minimal: current site time, today total, current task profile, session duration, one recommendation.
3. Expand backend schema and analytics endpoints.
4. Build React dashboard pages with demo mode.
5. Add goal creation/editing UI and richer report persistence.
6. Add automated tests for analytics edge cases and migration behavior.
