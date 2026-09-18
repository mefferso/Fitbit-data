# Fitbit Health Dashboard

Personal Fitbit / Google Health dashboard for running, recovery, sleep, steps, weight, and workout analysis.

## Current status

The live Apps Script dashboard has been upgraded and tested successfully on September 18, 2026.

### Major improvements in this version

- Historical heart-rate cache backfills both older and newer missing ranges.
- Workout heart-rate zones use the workout date instead of today's thresholds.
- Fallback zone durations use actual sample timing instead of treating every HR sample as one minute.
- Pace can be shown as raw 1-minute data or a 3-minute smoothed view.
- Aerobic decoupling compares speed-per-heartbeat efficiency between workout halves.
- 1-, 2-, and 3-minute post-workout heart-rate recovery support.
- Automatic run/walk interval detection for runs.
- Transparent zone-weighted training load.
- Running efficiency and VO2 Max trend support.
- Native workout split support when Google Health returns it.
- Lazy-loaded GPS route support through Google Health TCX export.
- Weight spreadsheet ID moved to Apps Script Script Properties instead of source code.

## Apps Script deployment

The live application still runs in Google Apps Script because GitHub Pages cannot execute `.gs` server code or safely hold Google OAuth credentials.

Required Script Properties:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
WEIGHT_SHEET_ID
```

Optional:

```text
WEIGHT_SHEET_NAME
```

If `WEIGHT_SHEET_NAME` is omitted, the app falls back to:

```text
Shotsy_2026-05-23_08-09-34
```

## Repository layout

The source is split into smaller Apps Script and HTML partials so future changes do not require editing one enormous file.

- `00_Core_*.gs` – OAuth, dashboard bootstrap, shared helpers
- `01_Activity_*.gs` – steps and heart-rate history
- `02_Recovery_*.gs` – sleep and recent-change analysis
- `03_PersonalRanges_*.gs` – personal baselines and weight
- `04_Performance_*.gs` – running trends, training load, VO2 Max, GPS/TCX
- `05_Workouts_*.gs`, `06_Workouts_*.gs`, `07_Workouts_*.gs` – workout parsing and analysis
- `Client*.html` – browser-side dashboard behavior

## Privacy

Do not commit OAuth client secrets, access tokens, private health exports, or spreadsheet IDs that you do not intend to publish.

The public GitHub Pages preview uses demo/synthetic data only.
