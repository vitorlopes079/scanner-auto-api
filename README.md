# m4car-apilayer

Simple Node.js service that connects to the AutoScan API, fetches scans across projects, and imports scans newer than the last processed timestamp.

## What it does

1. Loads `lastProcessedAt` from `state.json`
2. Calls `GET /api/ext/projects` to list all projects
3. For each project, calls `GET /api/ext/projects/{projectId}/scans` ordered ascending by `scanned`
4. Skips scans where `scanned <= lastProcessedAt`
5. Prints a console report:
   - Total scans found
   - Scans at or before `lastProcessedAt`
   - New scans waiting (with ID, registration number, and date when available)
6. Attempts up to 50 new scans per run and imports them into M4Car
7. Advances `lastProcessedAt` only through the latest contiguous processed scan

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

The checker runs as a long-lived process and triggers daily at 06:00 Germany time (`Europe/Berlin`).

### Manual scripts

```bash
# Import up to 50 new scans (advances ImportCheckpoint)
npm run import:manual

# Import one scan by AutoScan id (does not touch checkpoint)
npm run import:one -- <autoscanId>

# List all projects/scans vs checkpoint (read-only, no import)
npm run list:scans

# Fetch and print one AutoScan payload (no M4Car import)
npm run inspect:scan -- <autoscanId>

# Refresh AutoscanScanCache now (same as hourly job)
npm run cache:refresh

# Full rebuild — detail-fetch every scan and upsert (no early-stop)
npm run cache:rebuild

# Delete all AutoscanScanCache rows (manual/dev)
npm run cache:clear
```

### HTTP API (same process as the cron)

Listens on `PORT` (default `3100`):

```bash
# Health
curl -s http://localhost:3100/health

# Import one scan (does not touch checkpoint)
curl -s -X POST http://localhost:3100/import-one \
  -H "Content-Type: application/json" \
  -H "x-apilayer-secret: $APILAYER_SECRET" \
  -d '{"autoscanId":"<id>"}'

# Refresh AutoscanScanCache now
curl -s -X POST http://localhost:3100/cache-refresh \
  -H "x-apilayer-secret: $APILAYER_SECRET"
```

Responses use a clear `status`: `created`, `already_imported`, `incomplete`, or `error`.

The same process also runs an hourly job (`0 * * * *`, Europe/Berlin) that checks the 1,000 most recent scans per AutoScan project. Settled scans are skipped, while incomplete or unsynchronized scans inside that lookback window are detail-fetched again.

## Tracking import state

Checkpoint is stored in the M4Car DB table `ImportCheckpoint` (`key: "autoscan"`).

Processed scans include successful imports, already-imported M4Car responses (`409`), and incomplete AutoScan records that are skipped.

Failed scans count toward the 50-attempt run limit, but they do not stop the run. The checkpoint only advances up to the earliest failed scan. For example, if scan 12 fails and scans 13-50 succeed, `lastProcessedAt` remains at scan 11 so the next run retries scan 12 onward.
