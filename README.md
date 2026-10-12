# Fitbit Health Dashboard

Personal Fitbit / Google Health dashboard for running, recovery, sleep, steps, weight, and workout analysis.

## Performance Lab V2

A completely redesigned GitHub Pages interface is available under `/v2/`. It uses the compact summary feeds and lazy-loads individual workout detail instead of downloading the multi-megabyte legacy dashboard payload on every visit.

V2 includes:

- Overview command view with weekly totals, deltas, personal-best badges, and generated performance insights
- Dedicated run analysis with synchronized HR/pace traces, weather burden, HR zones, HR recovery, and rolling cardio drift
- Privacy-safe route shapes colored and patterned by HR zone; absolute GPS coordinates are never written to the public export
- Trend views, two-run comparison, deep-linkable workouts, sortable/filterable history, and mobile touch inspection
- Light/dark themes and a responsive application-style navigation shell
- The existing legacy dashboard remains available at the repository Pages root while V2 is evaluated

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

The public GitHub Pages build uses sanitized workout data. Absolute GPS coordinates, sleep, weight, OAuth credentials, tokens, and private spreadsheet identifiers are not published.

## Historical MapMyRun archive (October 2026)

The V2 sidebar includes [Then vs. Now](https://mefferso.github.io/Fitbit-data/v2/historical.html), a standalone view of curated historical MapMyRun benchmarks and year-level activity. It does not modify the current run analysis, HRR, cardio drift, or weather-adjusted API pipelines.

The source workbook contains **287 activity rows (2011–2020)**, including **34 September dates encoded as strings** rather than Excel dates. The clean audit is preserved externally as `mapmyrun_cleaned.csv` for full-record integration; the website includes the **full 287-row archive**, plus a live browser-side join of the published Fitbit run index (49 runs at development time). Historical attributes currently include date, distance, duration, QC and row provenance; Fitbit-only physiological fields remain specific to the modern source. The audit flags suspicious instantaneous maximum pace separately from overall pace, which should not be discarded automatically. There are two potential duplicate pairs and one unusual average-pace record for manual review. The fast November 7, 2011 effort was **0.995 miles in 5:48**, not an independently certified full mile.

For future Runkeeper imports, preserve `source`, `source_row`, `date`, `distance_mi`, `duration_seconds`, `quality`, and `flags`. Keep external archives separate from Fitbit's current physiological metrics; cross-source deduplication should initially be review-only.
