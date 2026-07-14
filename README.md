# m4car-apilayer

Simple Node.js service that connects to the AutoScan API, fetches all scans across projects, and reports which ones are new versus already processed.

## What it does

1. Loads already-processed scan IDs from `processed.json`
2. Calls `GET /api/ext/projects` to list all projects
3. For each project, calls `GET /api/ext/projects/{projectId}/scans`
4. Compares each scan ID against `processed.json`
5. Prints a console report:
   - Total scans found
   - Already processed
   - New scans waiting (with ID, registration number, and date when available)
6. Repeats on a cron schedule every 10 minutes

This project is **read-only** for now: it does not create jobs or mark scans as processed.

## Setup

```bash
npm install
```

Copy or edit `.env` with your AutoScan credentials:

```
AUTOSCAN_API_KEY=your-api-key
AUTOSCAN_BASE_URL=https://autoscan-api-prod.azurewebsites.net
```

## Run

```bash
npm start
```

The checker runs once immediately, then every 10 minutes.

## Tracking processed scans

`processed.json` stores an array of scan IDs that have already been handled:

```json
[]
```

Add scan IDs to this file when they are processed. Until then, they will appear as new in the report.
