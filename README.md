# LifeCycle

LifeCycle is evolving from a Chrome extension into a lightweight productivity analytics platform.

## Architecture

- `extension/`: minimal Chrome extension for active-tab tracking, current session timing, task profile start/stop controls, and backend sync.
- `backend/`: FastAPI API with SQLite storage, auth, usage-session ingestion, task profiles, goals, and analytics routes.
- `dashboard/`: React/TypeScript dashboard for deeper analytics, charts, reports, and demo-mode presentation.
- `data/`: local SQLite database files.

## Run Locally

Backend:

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Chrome extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension from `extension/`.
4. Sign in through the extension popup so data syncs to the backend.

The dashboard runs in demo mode until a bearer token is saved in the dashboard token field.

## MVP Focus

This version deliberately keeps the extension small. The internship-facing work is in the backend data model, analytics API, and separate dashboard experience.
