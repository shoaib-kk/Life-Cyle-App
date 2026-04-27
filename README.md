# LifeCycle V1

LifeCycle is a browser-based behavioural analytics tool that uses local activity data to produce real-time session feedback, same-weekday baselines, and simple usage forecasts.

## What V1 Tracks

- Active Chrome tab time only
- Per-domain usage for today
- Continuous per-domain session history
- Idle-aware tracking with Chrome's idle API
- Local daily history in `chrome.storage.local`
- A same-weekday baseline per domain
- Explicit linear end-of-day prediction
- Deterministic recommendation rules
- One setting: daily reset time, either midnight or 3am

Local usage storage uses this shape:

```json
{
  "dailyUsage": {
    "2026-04-27": {
      "youtube.com": 120,
      "reddit.com": 45
    }
  },
  "trackedDays": {
    "2026-04-27": true
  }
}
```

Values are minutes.

`trackedDays` separates missing data from zero usage:

- `0` means LifeCycle recorded that day and the site was not used.
- Missing means LifeCycle has no data for that day.

Missing days are skipped in baselines, because treating them as zero would make the baseline fake-low.

Session storage uses this shape:

```json
{
  "sessions": [
    {
      "domain": "youtube.com",
      "startTime": "2026-04-27T14:20:00.000Z",
      "endTime": "2026-04-27T14:52:00.000Z",
      "durationMinutes": 32
    }
  ]
}
```

A continuous session starts when a domain becomes the active foreground tab. It ends when the active domain changes, the active tab is no longer trackable, Chrome reports idle/locked, or browser focus changes away from a trackable site.

## Data Logic

Baseline is calculated per domain using recorded previous matching weekdays, up to the previous 8 matching weekdays.

Example: if today is Monday, the baseline for `youtube.com` is the average of recorded recent Mondays:

```text
baseline = sum(recorded_previous_same_weekday_usage) / recorded_same_weekday_count
```

Recorded days with no usage count as `0` minutes. Missing days are skipped. This keeps weekday/weekend behavior separate without inventing fake zeros.

Minimum-data rule:

```text
fewer than 2 same-weekday records = hide baseline insight fields
```

Prediction is a linear extrapolation from elapsed time today:

```text
predicted_total = (current_usage / elapsed_minutes_today) * 1440
```

Prediction is gated to avoid noisy early-day forecasts:

- Before 10am, prediction copy is labelled `Early estimate`
- Prediction starts only after at least 30 tracked minutes today or 10 minutes on the current domain
- If the baseline is ready but today's sample is too small, the popup stays quiet instead of showing a warning

Status compares `predicted_total` against the same-weekday baseline:

```text
delta = (predicted_total - baseline) / baseline
```

The popup text is deterministic:

- `+40% above normal` when projected usage is 40% above baseline
- `-20% below normal` when projected usage is 20% below baseline
- `On your normal pace` when the projected delta rounds to 0%

Recommendation rules:

- Projected usage more than 30% above baseline and today's usage has already passed baseline: `You've passed your usual full-day usage for this site`
- Projected usage more than 30% above baseline but still below today's full-day baseline: `Stopping now keeps you within your normal range`
- Projected usage at or below baseline: `Stopping now keeps you within your normal range`
- Projected usage above baseline but not more than 30%: `You're above normal pace, but still inside the 30% range`

Insight confidence:

- Low confidence: 1-2 prior data points
- Medium confidence: 3-5 prior data points
- High confidence: 6+ prior data points

## Session Logic

The popup prioritizes the current active domain because session feedback is actionable before the daily total is already spent.

Current session:

```text
current_session = now - active_session_start_time
```

Typical session:

```text
typical_session = median(previous_session_durations_for_domain)
```

Minimum-data rule:

```text
fewer than 2 prior sessions = show current session only, hide comparison fields
```

Percentile comparison:

```text
percentile = count(previous_sessions_shorter_than_current) / previous_session_count
```

Session recommendation rules:

- No active session: show `No active tab`
- No prior sessions for this domain: show current session only
- Current session longer than prior sessions: `This session is already longer than 67% of your past YouTube sessions`
- Current session longer than typical: `Stop now if this was meant to be a quick check`
- Current session at or below typical: `You're still within your typical session length`

## Idle And Reset Rules

Chrome's idle API stops active tracking when the browser reports `idle` or `locked`. LifeCycle subtracts the idle threshold before closing the session, so leaving a site open while away does not count as active usage.

The daily reset time defaults to midnight. The popup includes one setting to move the reset to 3am for people whose work/study sessions run past midnight.

Changing the reset time applies the new boundary, checkpoints the current session against that boundary, then resumes tracking.

Daily local history is pruned after 70 lifecycle days. The same-weekday baseline only needs the recent lookback window, so older local records are removed to keep `chrome.storage.local` responsive.

## Chrome Extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the `extension` folder.

The badge shows total minutes today. The popup shows the active domain first:

- Daily reset setting
- Current session
- Typical session
- Session status
- Session percentile comparison
- Insight confidence
- Today
- Avg
- Status
- Prediction
- Recommendation
- Ranked site list, capped at 5 sites

The ranked site list reads from `summary.usage`, sorts domains by minutes descending, highlights the active domain, and shows minutes plus share of today's listed usage. Bar width is proportional to the top site.

The detail cards never fall back to the top site for the day. If there is no active trackable tab, the session area says `No active tab`; if Chrome reports idle while a trackable tab is open, the active domain is still shown and the session status says `Paused`. The ranked list remains the only place where previous sites from today appear.

While the popup is open, it refreshes once per second so the current-session timer stays live.

## Product Roadmap

Build in this order:

1. Session tracking
2. Site categories: distracting / productive / neutral
3. Focus hours: detect usage during user-defined study/work windows
4. Weekly trend summary
5. Tiny web dashboard

## Backend

The extension works locally without the backend. When the backend is running, it receives today's usage and stores daily totals.

Install dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Run the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

API:

- `POST /usage` stores daily totals and whether the day had tracking coverage
- `GET /usage/{date}` returns stored totals
- `GET /insights?date=YYYY-MM-DD&weeks=8` returns baseline, status, prediction, confidence, and recommendation

The local API URL used by the extension is `http://127.0.0.1:8000`.
 