require('dotenv').config();

const axios = require('axios');
const cron = require('node-cron');
const { mapScanToPayload } = require('./mapper');
const { prisma } = require('./lib/prisma');

const BASE_URL = process.env.AUTOSCAN_BASE_URL;
const API_KEY = process.env.AUTOSCAN_API_KEY;
const M4CAR_INTERNAL_URL = process.env.M4CAR_INTERNAL_URL;
const M4CAR_INTERNAL_SECRET = process.env.M4CAR_INTERNAL_SECRET;
const M4CAR_STORAGE_URL = process.env.M4CAR_STORAGE_URL;
const M4CAR_UPLOAD_KEY = process.env.M4CAR_UPLOAD_KEY;
const PAGE_SIZE = 50;
const DAILY_IMPORT_LIMIT = 50;
const CRON_EXPRESSION = '0 6 * * *';
const CACHE_CRON_EXPRESSION = '0 * * * *';
const CRON_TIMEZONE = 'Europe/Berlin';
const IMPORT_DELAY_MS = 500;
const INCOMPLETE_ANALYZED = '0001-01-01T00:00:00+00:00';
const CHECKPOINT_KEY = 'autoscan';
const DAMAGE_PHOTO_CATEGORY = 'damages';
// One-time seed if ImportCheckpoint row is missing (former state.json value).
const CHECKPOINT_SEED_LAST_PROCESSED_AT = '2026-07-06T16:31:00.000Z';

console.log('=== AutoScan checker boot ===');
console.log('[pipeline-test] Ephemeral log for deployment pipeline verification');
console.log(`Base URL: ${BASE_URL}`);
console.log(`API key loaded: ${API_KEY ? `${API_KEY.slice(0, 8)}...` : 'MISSING'}`);
console.log(`M4Car URL: ${M4CAR_INTERNAL_URL}`);
console.log(`M4Car secret loaded: ${M4CAR_INTERNAL_SECRET ? 'yes' : 'MISSING'}`);
console.log(`M4Car storage URL: ${M4CAR_STORAGE_URL || 'MISSING'}`);
console.log(`M4Car upload key loaded: ${M4CAR_UPLOAD_KEY ? 'yes' : 'MISSING'}`);
console.log(`Checkpoint: ImportCheckpoint key="${CHECKPOINT_KEY}"`);
console.log(`Page size: ${PAGE_SIZE}`);
console.log(`Cache refresh cron: ${CACHE_CRON_EXPRESSION} (${CRON_TIMEZONE})`);

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    ApiKey: API_KEY,
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCheckpoint() {
  try {
    const row = await prisma.importCheckpoint.findUnique({
      where: { key: CHECKPOINT_KEY },
    });

    if (row) {
      const lastProcessedAt = row.lastProcessedAt.toISOString();
      console.log(`[checkpoint] Starting from: ${lastProcessedAt}`);
      return { lastProcessedAt };
    }

    const seededAt = new Date(CHECKPOINT_SEED_LAST_PROCESSED_AT);
    if (Number.isNaN(seededAt.getTime())) {
      throw new Error(`Invalid checkpoint seed: ${CHECKPOINT_SEED_LAST_PROCESSED_AT}`);
    }

    const created = await prisma.importCheckpoint.create({
      data: {
        key: CHECKPOINT_KEY,
        lastProcessedAt: seededAt,
      },
    });

    const lastProcessedAt = created.lastProcessedAt.toISOString();
    console.log(
      `[checkpoint] No row for key="${CHECKPOINT_KEY}"; seeded once from state.json backup: ${lastProcessedAt}`
    );
    return { lastProcessedAt };
  } catch (error) {
    console.error(`[checkpoint] Failed to load ImportCheckpoint (key="${CHECKPOINT_KEY}"): ${error.message}`);
    throw error;
  }
}

async function saveCheckpoint(scannedAt) {
  const scannedDate = new Date(scannedAt);
  if (Number.isNaN(scannedDate.getTime())) {
    throw new Error(`Invalid scanned date: ${scannedAt}`);
  }

  try {
    const row = await prisma.importCheckpoint.upsert({
      where: { key: CHECKPOINT_KEY },
      create: {
        key: CHECKPOINT_KEY,
        lastProcessedAt: scannedDate,
      },
      update: {
        lastProcessedAt: scannedDate,
      },
    });

    console.log(`[checkpoint] Updated lastProcessedAt to ${row.lastProcessedAt.toISOString()}`);
  } catch (error) {
    console.error(`[checkpoint] Failed to save ImportCheckpoint (key="${CHECKPOINT_KEY}"): ${error.message}`);
    throw error;
  }
}

function parseScanDate(scan) {
  const scannedAt = new Date(scan.scanned);
  return Number.isNaN(scannedAt.getTime()) ? null : scannedAt;
}

async function fetchAllPages(url, label) {
  const allItems = [];
  let skip = 0;
  let page = 1;

  console.log(`[api] Fetching all ${label} from ${BASE_URL}${url}`);

  while (true) {
    const { data } = await api.get(url, {
      headers: {
        'X-Paging-Top': PAGE_SIZE,
        'X-Paging-Skip': skip,
      },
    });

    const items = Array.isArray(data) ? data : [];
    allItems.push(...items);

    const isLastPage = items.length < PAGE_SIZE;
    console.log(
      `[api] Fetching page ${page} (skip: ${skip})... got ${items.length} ${label}${isLastPage ? ' (last page)' : ''}`
    );

    if (isLastPage) {
      break;
    }

    skip += PAGE_SIZE;
    page += 1;
  }

  console.log(`[api] Total ${label} collected: ${allItems.length}`);
  return allItems;
}

async function fetchProjects() {
  const projects = await fetchAllPages('/api/ext/projects', 'projects');
  for (const project of projects) {
    console.log(`  - ${project.id} | ${project.name} | ${project.city || 'N/A'}, ${project.country || 'N/A'}`);
  }
  return projects;
}

async function fetchScans(projectId, projectName, { orderBy = 'Ascending' } = {}) {
  console.log(`[api] Loading scans for project: ${projectName} (${projectId}) [${orderBy}]`);
  const params = new URLSearchParams({
    orderBy,
    orderByProperty: 'scanned',
  });
  return fetchAllPages(`/api/ext/projects/${projectId}/scans?${params.toString()}`, 'scans');
}

async function fetchScanDetails(scanId) {
  const { data } = await api.get(`/api/ext/scans/${scanId}`);
  return data;
}

async function listAutoscanScans({ orderBy = 'Descending' } = {}) {
  const projects = await fetchProjects();
  const allScans = [];

  for (const [index, project] of projects.entries()) {
    console.log(
      `[http] Fetching scans for project ${index + 1}/${projects.length}: ${project.name}`
    );
    const scans = await fetchScans(project.id, project.name, { orderBy });

    for (const scan of scans) {
      allScans.push({
        ...scan,
        projectId: project.id,
        projectName: project.name,
      });
    }
  }

  return allScans;
}

async function getAutoscanScan(scanId) {
  return fetchScanDetails(scanId);
}

function getSnapshotUrl(snapshot) {
  if (typeof snapshot === 'string') return snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  return (
    snapshot.url ||
    snapshot.imageUrl ||
    snapshot.imageURL ||
    snapshot.snapshotUrl ||
    snapshot.snapshotURL ||
    snapshot.uri ||
    snapshot.href ||
    null
  );
}

function getSnapshotLabel(snapshot, index) {
  if (snapshot && typeof snapshot === 'object') {
    return (
      snapshot.cameraAngle ||
      snapshot.angle ||
      snapshot.label ||
      snapshot.name ||
      snapshot.type ||
      `snapshot-${index + 1}`
    );
  }
  return `snapshot-${index + 1}`;
}

function extensionFromContentType(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return null;
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    const ext = match?.[1]?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp'].includes(ext)
      ? ext.replace('jpeg', 'jpg')
      : null;
  } catch {
    return null;
  }
}

function safeSnapshotFilename(label, index, ext) {
  const safeLabel = String(label || `snapshot-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `snapshot-${index + 1}`;
  return `autoscan-${safeLabel}-${index + 1}.${ext}`;
}

async function uploadBufferToM4CarStorage(buffer, contentType, filename) {
  if (!M4CAR_STORAGE_URL || !M4CAR_UPLOAD_KEY) {
    throw new Error('M4Car storage config is missing');
  }

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), filename);

  const response = await axios.post(
    `${M4CAR_STORAGE_URL.replace(/\/+$/, '')}/upload.php?category=${encodeURIComponent(DAMAGE_PHOTO_CATEGORY)}`,
    form,
    {
      headers: {
        Authorization: `Bearer ${M4CAR_UPLOAD_KEY}`,
      },
      validateStatus: () => true,
      timeout: 30000,
    }
  );

  if (response.status < 200 || response.status >= 300 || !response.data?.url) {
    throw new Error(`M4Car storage upload failed: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  }

  return response.data.url;
}

async function rehostScanSnapshot(snapshot, index) {
  const url = getSnapshotUrl(snapshot);
  const label = getSnapshotLabel(snapshot, index);
  if (!url) {
    throw new Error(`snapshot ${index + 1} has no URL`);
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    validateStatus: () => true,
    timeout: 30000,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`AutoScan snapshot download failed: HTTP ${response.status}`);
  }

  const contentType =
    response.headers?.['content-type'] ||
    response.headers?.['Content-Type'] ||
    'image/jpeg';
  const ext = extensionFromContentType(contentType) || extensionFromUrl(url) || 'jpg';
  const filename = safeSnapshotFilename(label, index, ext);

  return uploadBufferToM4CarStorage(
    Buffer.from(response.data),
    contentType,
    filename
  );
}

async function rehostScanPhotos(scan) {
  const snapshots = Array.isArray(scan?.snapshots) ? scan.snapshots : [];
  if (snapshots.length === 0) return [];

  const urls = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const label = getSnapshotLabel(snapshot, index);
    try {
      const url = await rehostScanSnapshot(snapshot, index);
      urls.push(url);
      console.log(`[photos] ${scan.id || 'scan'} ${label} → uploaded ${url}`);
    } catch (error) {
      console.log(
        `[photos] ${scan.id || 'scan'} ${label} → skipped (${error.message})`
      );
    }
  }

  return urls;
}

function isIncompleteScan(scan) {
  if (scan.analyzed === INCOMPLETE_ANALYZED) {
    return 'analyzed date is incomplete (0001-01-01)';
  }

  const damages = scan.scanResult?.carPartDamages || [];
  const hasAnyDamage = damages.some(
    (part) => Array.isArray(part.damageCount) && part.damageCount.length > 0
  );

  if (!hasAnyDamage) {
    return 'all damageCount arrays are empty';
  }

  return null;
}

function getCreatedLabel(responseData) {
  return (
    responseData?.data?.quoteNumber ||
    responseData?.quoteNumber ||
    responseData?.data?.qtNumber ||
    responseData?.qtNumber ||
    responseData?.data?.number ||
    responseData?.number ||
    responseData?.data?.id ||
    responseData?.id ||
    'ok'
  );
}

async function importScan(summaryScan, { overwrite = false } = {}) {
  const label = summaryScan.registrationNumber || summaryScan.id;

  try {
    // List endpoint has no `scanned`; checkScans may already attach full detail.
    const hasDetail = summaryScan.scanned != null;
    let fullScan = summaryScan;

    if (hasDetail) {
      console.log(`[import] ${label} → using prefetched scan detail...`);
    } else {
      console.log(`[import] ${label} → fetching full scan...`);
      fullScan = await fetchScanDetails(summaryScan.id);
    }

    const incompleteReason = isIncompleteScan(fullScan);
    if (incompleteReason) {
      console.log(`[import] ${label} → skipped (incomplete: ${incompleteReason})`);
      return {
        ok: true,
        status: 'incomplete',
        autoscanId: summaryScan.id,
        reason: incompleteReason,
        message: `skipped (incomplete: ${incompleteReason})`,
      };
    }

    console.log(`[import] ${label} → rehosting scan photos...`);
    const scanPhotos = await rehostScanPhotos(fullScan);

    const correction = await prisma.autoscanCorrection.findUnique({
      where: { autoscanId: fullScan.id },
      select: { parts: true },
    });
    const correctionParts = Array.isArray(correction?.parts)
      ? correction.parts
      : [];

    if (correctionParts.length > 0) {
      const correctedPanelNames = correctionParts
        .map((part) =>
          part &&
          typeof part === 'object' &&
          typeof part.carPartType === 'string'
            ? part.carPartType
            : null
        )
        .filter(Boolean);
      if (correctedPanelNames.length > 0) {
        console.log(
          `[import] ${fullScan.id} → applied correction for: ${correctedPanelNames.join(', ')}`
        );
      }
    }

    console.log(`[import] ${label} → mapping data...`);
    const payload = {
      ...mapScanToPayload(fullScan, { correctionParts }),
      scanPhotos,
      overwrite,
    };

    console.log(`[import] ${label} → posting to M4Car...`);
    const response = await axios.post(
      `${M4CAR_INTERNAL_URL}/api/internal/import-scan`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': M4CAR_INTERNAL_SECRET,
        },
        validateStatus: () => true,
      }
    );

    if (response.status === 201) {
      const created = getCreatedLabel(response.data);
      console.log(`[import] ${label} → ✓ created ${created}`);
      return {
        ok: true,
        status: 'created',
        autoscanId: summaryScan.id,
        created,
        m4carStatus: 201,
        message: `created ${created}`,
      };
    }

    if (response.status === 200 && response.data?.overwritten === true) {
      const overwritten = getCreatedLabel(response.data);
      console.log(`[import] ${label} → ✓ overwritten ${overwritten}`);
      return {
        ok: true,
        status: 'overwritten',
        autoscanId: summaryScan.id,
        created: overwritten,
        m4carStatus: 200,
        message: `overwritten ${overwritten}`,
      };
    }

    if (response.status === 409) {
      console.log(`[import] ${label} → already imported, skipping`);
      return {
        ok: true,
        status: 'already_imported',
        autoscanId: summaryScan.id,
        m4carStatus: 409,
        message: 'already imported, skipping',
      };
    }

    const errorMessage =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data) || response.statusText;
    console.log(`[import] ${label} → ✗ failed: HTTP ${response.status} ${errorMessage}`);
    return {
      ok: false,
      status: 'error',
      autoscanId: summaryScan.id,
      m4carStatus: response.status,
      message: `HTTP ${response.status} ${errorMessage}`,
    };
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data) || error.response.statusText}`
      : error.message;
    console.log(`[import] ${label} → ✗ failed: ${message}`);
    return {
      ok: false,
      status: 'error',
      autoscanId: summaryScan.id,
      message,
    };
  }
}

async function listScans() {
  console.log('\n========================================');
  console.log(`[list] Started at ${new Date().toISOString()}`);
  console.log('[list] Report only — no imports, checkpoint unchanged');
  console.log('========================================');

  try {
    const state = await loadCheckpoint();
    const projects = await fetchProjects();

    if (projects.length === 0) {
      console.log('[list] No projects found.');
      return;
    }

    const allScans = [];

    for (const [index, project] of projects.entries()) {
      console.log(`[list] Fetching scans for project ${index + 1}/${projects.length}: ${project.name}`);
      const scans = await fetchScans(project.id, project.name);

      for (const scan of scans) {
        const scannedAt = parseScanDate(scan);
        const isOlderOrCurrent = scannedAt && scannedAt <= new Date(state.lastProcessedAt);
        console.log(
          `  [scan] ${scan.id} | scanned: ${scan.scanned || 'N/A'} | reg: ${scan.registrationNumber || 'N/A'} | chassis: ${scan.chassisNumber || 'N/A'} | ${isOlderOrCurrent ? 'SKIP' : 'NEW'}`
        );
        allScans.push({
          ...scan,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }

    const lastProcessedAt = new Date(state.lastProcessedAt);
    const invalidScans = allScans.filter((scan) => !parseScanDate(scan));
    const sortedScans = allScans
      .filter((scan) => parseScanDate(scan))
      .sort((a, b) => parseScanDate(a) - parseScanDate(b));
    const alreadyProcessed = sortedScans.filter((scan) => parseScanDate(scan) <= lastProcessedAt);
    const newScans = sortedScans.filter((scan) => parseScanDate(scan) > lastProcessedAt);

    console.log('\n---------- REPORT ----------');
    console.log(`Checkpoint lastProcessedAt: ${state.lastProcessedAt}`);
    console.log(`Total scans found: ${allScans.length}`);
    console.log(`Invalid scanned timestamps: ${invalidScans.length}`);
    console.log(`At or before lastProcessedAt: ${alreadyProcessed.length}`);
    console.log(`New scans waiting: ${newScans.length}`);
    console.log('----------------------------');

    if (newScans.length > 0) {
      console.log('\nNew scans:');
      for (const scan of newScans) {
        console.log(
          `  - ${scan.id} | ${scan.scanned} | ${scan.registrationNumber || 'N/A'} | ${scan.projectName}`
        );
      }
    } else {
      console.log('\nNo new scans waiting.');
    }

    console.log(`\n[list] Finished at ${new Date().toISOString()}`);
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`[error] Failed to list scans: ${message}`);
    if (error.response?.data) {
      console.error('[error] Response body:', JSON.stringify(error.response.data));
    }
    if (error.stack) {
      console.error('[error] Stack:', error.stack);
    }
    throw error;
  }
}

async function checkScans({ limit = null } = {}) {
  console.log('\n========================================');
  console.log(`[run] Started at ${new Date().toISOString()}`);
  if (limit != null) {
    console.log(`[run] Import limit: ${limit} scan(s)`);
  }
  console.log('========================================');

  try {
    const state = await loadCheckpoint();
    const projects = await fetchProjects();

    if (projects.length === 0) {
      console.log('[run] No projects found. Nothing to check.');
      return {
        ok: true,
        status: 'ok',
        message: 'No projects found',
        checkpointLastProcessedAt: state.lastProcessedAt,
        listTotal: 0,
        detailFetches: 0,
        invalidDetails: 0,
        newScansWaiting: 0,
        attempts: 0,
        processedCount: 0,
        failedCount: 0,
        remaining: 0,
      };
    }

    const lastProcessedAt = new Date(state.lastProcessedAt);
    const newScans = [];
    let listTotal = 0;
    let detailFetches = 0;
    let invalidDetails = 0;

    // List endpoint omits `scanned`. Walk each project newest→oldest via detail
    // fetches and stop at the checkpoint so we don't detail-fetch all history.
    for (const [index, project] of projects.entries()) {
      console.log(
        `[run] Fetching scans (Descending) for project ${index + 1}/${projects.length}: ${project.name}`
      );
      const summaries = await fetchScans(project.id, project.name, { orderBy: 'Descending' });
      listTotal += summaries.length;

      for (const summary of summaries) {
        const label = summary.registrationNumber || summary.id;
        console.log(`[run] Detail-fetch ${label} (${summary.id})...`);

        let detail;
        try {
          detail = await fetchScanDetails(summary.id);
          detailFetches += 1;
        } catch (error) {
          const message = error.response
            ? `${error.response.status} ${error.response.statusText}`
            : error.message;
          console.log(`[run] Detail-fetch failed for ${summary.id}: ${message}`);
          invalidDetails += 1;
          continue;
        }

        const scannedAt = parseScanDate(detail);
        if (!scannedAt) {
          console.log(
            `  [scan] ${detail.id} | scanned: ${detail.scanned || 'N/A'} | reg: ${summary.registrationNumber || 'N/A'} | INVALID`
          );
          invalidDetails += 1;
          continue;
        }

        if (scannedAt <= lastProcessedAt) {
          console.log(
            `  [scan] ${detail.id} | scanned: ${detail.scanned} | reg: ${summary.registrationNumber || 'N/A'} | SKIP (at/before checkpoint) — stop project walk`
          );
          break;
        }

        console.log(
          `  [scan] ${detail.id} | scanned: ${detail.scanned} | reg: ${summary.registrationNumber || 'N/A'} | chassis: ${summary.chassisNumber || 'N/A'} | NEW`
        );

        newScans.push({
          ...detail,
          id: detail.id || summary.id,
          registrationNumber:
            summary.registrationNumber || detail.car?.registrationNumber || detail.registrationNumber,
          chassisNumber: summary.chassisNumber || detail.car?.chassisNumber || detail.chassisNumber,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }

    newScans.sort((a, b) => parseScanDate(a) - parseScanDate(b));

    console.log('\n---------- REPORT ----------');
    console.log(`Checkpoint lastProcessedAt: ${state.lastProcessedAt}`);
    console.log(`List summaries found: ${listTotal}`);
    console.log(`Detail fetches: ${detailFetches}`);
    console.log(`Invalid/failed details: ${invalidDetails}`);
    console.log(`New scans waiting: ${newScans.length}`);
    console.log('----------------------------');

    if (newScans.length === 0) {
      console.log('\nNo new scans waiting.');
      console.log(`\n[run] Finished at ${new Date().toISOString()}`);
      return {
        ok: true,
        status: 'ok',
        message: 'No new scans waiting',
        checkpointLastProcessedAt: state.lastProcessedAt,
        listTotal,
        detailFetches,
        invalidDetails,
        newScansWaiting: 0,
        attempts: 0,
        processedCount: 0,
        failedCount: 0,
        remaining: 0,
      };
    } else {
      const batch = limit != null ? newScans.slice(0, limit) : newScans;
      const remaining = newScans.length - batch.length;
      let processedCount = 0;
      let failedCount = 0;
      const outcomes = [];

      console.log(`\n[import] Attempting up to ${batch.length} scans (oldest → newest)...`);

      for (const [index, scan] of batch.entries()) {
        const scannedAt = parseScanDate(scan);
        if (!scannedAt) {
          console.log(`[import] ${scan.registrationNumber || scan.id} → ✗ failed: invalid scanned date ${scan.scanned}`);
          failedCount += 1;
          outcomes.push({ scan, scannedAt: null, processed: false });
          continue;
        }

        const result = await importScan(scan);
        if (!result.ok) {
          console.log('[import] Continuing run; checkpoint will not advance past this scan.');
          failedCount += 1;
        } else {
          processedCount += 1;
        }
        outcomes.push({ scan, scannedAt, processed: result.ok });

        if (index < batch.length - 1) {
          await sleep(IMPORT_DELAY_MS);
        }
      }

      const firstFailureIndex = outcomes.findIndex((outcome) => !outcome.processed);
      let checkpointIndex =
        firstFailureIndex === -1 ? outcomes.length - 1 : firstFailureIndex - 1;

      if (firstFailureIndex !== -1) {
        const firstFailureScannedAt = outcomes[firstFailureIndex].scannedAt;

        while (
          checkpointIndex >= 0 &&
          firstFailureScannedAt &&
          outcomes[checkpointIndex].scannedAt >= firstFailureScannedAt
        ) {
          checkpointIndex -= 1;
        }
      }

      if (checkpointIndex >= 0) {
        const checkpointScannedAt = outcomes[checkpointIndex].scannedAt.toISOString();
        await saveCheckpoint(checkpointScannedAt);
        state.lastProcessedAt = checkpointScannedAt;
      } else if (failedCount > 0) {
        console.log('[checkpoint] Unchanged because the earliest attempted scan failed.');
      }

      console.log(
        `[import] Done. Attempts: ${batch.length}, Processed: ${processedCount}, Failed: ${failedCount}, Remaining after attempted batch: ${remaining}`
      );

      console.log(`\n[run] Finished at ${new Date().toISOString()}`);
      return {
        ok: failedCount === 0,
        status: failedCount === 0 ? 'ok' : 'partial_error',
        message: `Attempts: ${batch.length}, Processed: ${processedCount}, Failed: ${failedCount}, Remaining: ${remaining}`,
        checkpointLastProcessedAt: state.lastProcessedAt,
        listTotal,
        detailFetches,
        invalidDetails,
        newScansWaiting: newScans.length,
        attempts: batch.length,
        processedCount,
        failedCount,
        remaining,
      };
    }
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`[error] Failed to check scans: ${message}`);
    if (error.response?.data) {
      console.error('[error] Response body:', JSON.stringify(error.response.data));
    }
    if (error.stack) {
      console.error('[error] Stack:', error.stack);
    }
    return {
      ok: false,
      status: 'error',
      message,
    };
  }
}

async function recordImportBatchLog(result, { limit = null } = {}) {
  if (!result || typeof result !== 'object') return;

  try {
    await prisma.autoscanImportBatchLog.create({
      data: {
        status: result.status || 'unknown',
        attempts: Number(result.attempts) || 0,
        processedCount: Number(result.processedCount) || 0,
        failedCount: Number(result.failedCount) || 0,
        remaining: Number(result.remaining) || 0,
        limit: Number.isInteger(Number(limit)) ? Number(limit) : null,
        message: typeof result.message === 'string' ? result.message : null,
      },
    });
  } catch (error) {
    console.error(`[import] Failed to save batch log: ${error.message}`);
  }
}

async function runImportBatch({ limit = DAILY_IMPORT_LIMIT } = {}) {
  const result = await checkScans({ limit });
  await recordImportBatchLog(result, { limit });
  return result;
}

function isIncompleteAnalyzedDate(scan) {
  return scan?.analyzed === INCOMPLETE_ANALYZED;
}

function cacheFieldsFromScan(summary, detail) {
  const scannedAt = parseScanDate(detail);
  return {
    registrationNumber:
      summary.registrationNumber ||
      detail.car?.registrationNumber ||
      detail.registrationNumber ||
      null,
    chassisNumber:
      summary.chassisNumber ||
      detail.car?.chassisNumber ||
      detail.chassisNumber ||
      null,
    make:
      summary.brand ||
      summary.make ||
      detail.car?.brand ||
      detail.brand ||
      detail.make ||
      null,
    model:
      summary.model ||
      detail.car?.model ||
      detail.model ||
      null,
    scanned: scannedAt,
    isIncomplete: isIncompleteAnalyzedDate(detail),
  };
}

async function refreshAutoscanScanCache() {
  console.log('\n========================================');
  console.log(`[cache] Started at ${new Date().toISOString()}`);
  console.log('[cache] AutoscanScanCache refresh (incremental)');
  console.log('========================================');

  let cachedCount = 0;
  let skippedCached = 0;
  let detailFetches = 0;
  let failedDetails = 0;

  try {
    const projects = await fetchProjects();

    if (projects.length === 0) {
      console.log('[cache] No projects found.');
      return {
        ok: true,
        status: 'ok',
        cachedCount: 0,
        skippedCached: 0,
        detailFetches: 0,
        failedDetails: 0,
        message: 'No projects found',
      };
    }

    for (const [index, project] of projects.entries()) {
      console.log(
        `[cache] Fetching scans (Descending) for project ${index + 1}/${projects.length}: ${project.name}`
      );
      const summaries = await fetchScans(project.id, project.name, { orderBy: 'Descending' });

      for (const summary of summaries) {
        const existing = await prisma.autoscanScanCache.findUnique({
          where: { id: summary.id },
          select: { id: true },
        });

        if (existing) {
          skippedCached += 1;
          console.log(
            `  [cache] ${summary.id} | already cached — stop project walk`
          );
          break;
        }

        const label = summary.registrationNumber || summary.id;
        console.log(`[cache] Detail-fetch ${label} (${summary.id})...`);

        let detail;
        try {
          detail = await fetchScanDetails(summary.id);
          detailFetches += 1;
        } catch (error) {
          const message = error.response
            ? `${error.response.status} ${error.response.statusText}`
            : error.message;
          console.log(`[cache] Detail-fetch failed for ${summary.id}: ${message}`);
          failedDetails += 1;
          continue;
        }

        const fields = cacheFieldsFromScan(summary, detail);

        try {
          await prisma.autoscanScanCache.create({
            data: {
              id: summary.id,
              ...fields,
            },
          });
          cachedCount += 1;
          console.log(
            `  [cache] ${summary.id} | scanned: ${fields.scanned ? fields.scanned.toISOString() : 'null'} | incomplete: ${fields.isIncomplete} | CACHED`
          );
        } catch (error) {
          if (error.code === 'P2002') {
            skippedCached += 1;
            console.log(
              `  [cache] ${summary.id} | already cached (race) — stop project walk`
            );
            break;
          }
          console.error(`[cache] Failed to create cache row for ${summary.id}: ${error.message}`);
          failedDetails += 1;
        }
      }
    }

    console.log('\n---------- CACHE REPORT ----------');
    console.log(`New scans cached: ${cachedCount}`);
    console.log(`Skipped (already cached / boundary): ${skippedCached}`);
    console.log(`Detail fetches: ${detailFetches}`);
    console.log(`Failed details/creates: ${failedDetails}`);
    console.log('----------------------------------');
    console.log(`[cache] Finished at ${new Date().toISOString()}`);

    return {
      ok: true,
      status: 'ok',
      cachedCount,
      skippedCached,
      detailFetches,
      failedDetails,
      message: `Cached ${cachedCount} new scan(s); skipped ${skippedCached} already-cached`,
    };
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`[cache] Failed to refresh AutoscanScanCache: ${message}`);
    if (error.stack) {
      console.error('[cache] Stack:', error.stack);
    }
    return {
      ok: false,
      status: 'error',
      cachedCount,
      skippedCached,
      detailFetches,
      failedDetails,
      message,
    };
  }
}

async function rebuildAutoscanScanCache() {
  console.log('\n========================================');
  console.log(`[cache] Started at ${new Date().toISOString()}`);
  console.log('[cache] AutoscanScanCache FULL rebuild (no early-stop)');
  console.log('========================================');

  let upsertedCount = 0;
  let detailFetches = 0;
  let failedDetails = 0;
  let listTotal = 0;

  try {
    const projects = await fetchProjects();

    if (projects.length === 0) {
      console.log('[cache] No projects found.');
      return {
        ok: true,
        status: 'ok',
        upsertedCount: 0,
        detailFetches: 0,
        failedDetails: 0,
        listTotal: 0,
        message: 'No projects found',
      };
    }

    for (const [index, project] of projects.entries()) {
      console.log(
        `[cache] Fetching scans (Descending) for project ${index + 1}/${projects.length}: ${project.name}`
      );
      const summaries = await fetchScans(project.id, project.name, { orderBy: 'Descending' });
      listTotal += summaries.length;

      for (const summary of summaries) {
        const label = summary.registrationNumber || summary.id;
        console.log(`[cache] Detail-fetch ${label} (${summary.id})...`);

        let detail;
        try {
          detail = await fetchScanDetails(summary.id);
          detailFetches += 1;
        } catch (error) {
          const message = error.response
            ? `${error.response.status} ${error.response.statusText}`
            : error.message;
          console.log(`[cache] Detail-fetch failed for ${summary.id}: ${message}`);
          failedDetails += 1;
          continue;
        }

        const fields = cacheFieldsFromScan(summary, detail);

        try {
          await prisma.autoscanScanCache.upsert({
            where: { id: summary.id },
            create: {
              id: summary.id,
              ...fields,
            },
            update: fields,
          });
          upsertedCount += 1;
          console.log(
            `  [cache] ${summary.id} | scanned: ${fields.scanned ? fields.scanned.toISOString() : 'null'} | incomplete: ${fields.isIncomplete} | UPSERTED`
          );
        } catch (error) {
          console.error(`[cache] Failed to upsert cache row for ${summary.id}: ${error.message}`);
          failedDetails += 1;
        }
      }
    }

    console.log('\n---------- CACHE REBUILD REPORT ----------');
    console.log(`List summaries: ${listTotal}`);
    console.log(`Upserted: ${upsertedCount}`);
    console.log(`Detail fetches: ${detailFetches}`);
    console.log(`Failed details/upserts: ${failedDetails}`);
    console.log('-----------------------------------------');
    console.log(`[cache] Finished at ${new Date().toISOString()}`);

    return {
      ok: true,
      status: 'ok',
      upsertedCount,
      detailFetches,
      failedDetails,
      listTotal,
      message: `Upserted ${upsertedCount} scan(s) from ${listTotal} list item(s)`,
    };
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`[cache] Failed to rebuild AutoscanScanCache: ${message}`);
    if (error.stack) {
      console.error('[cache] Stack:', error.stack);
    }
    return {
      ok: false,
      status: 'error',
      upsertedCount,
      detailFetches,
      failedDetails,
      listTotal,
      message,
    };
  }
}

function startScheduler() {
  let isCacheRunning = false;

  // Daily 06:00 import batch disabled for now — re-enable when ready.
  // console.log(`Schedule: daily import at 06:00 (${CRON_TIMEZONE})`);
  // let isImportRunning = false;
  // cron.schedule(
  //   CRON_EXPRESSION,
  //   async () => {
  //     if (isImportRunning) {
  //       console.log('[cron] Previous import run is still active; skipping this trigger.');
  //       return;
  //     }
  //
  //     isImportRunning = true;
  //     console.log('\n[cron] Triggered scheduled import run');
  //
  //     try {
  //       await runImportBatch();
  //     } finally {
  //       isImportRunning = false;
  //     }
  //   },
  //   {
  //     timezone: CRON_TIMEZONE,
  //   }
  // );

  console.log('[cron] Daily 06:00 import batch is DISABLED');
  console.log(`Schedule: hourly AutoscanScanCache refresh (0 * * * *, ${CRON_TIMEZONE})`);
  console.log('Waiting for scheduled runs...\n');

  cron.schedule(
    CACHE_CRON_EXPRESSION,
    async () => {
      if (isCacheRunning) {
        console.log('[cron] Previous cache refresh is still active; skipping this trigger.');
        return;
      }

      isCacheRunning = true;
      console.log('\n[cron] Triggered hourly AutoscanScanCache refresh');

      try {
        await refreshAutoscanScanCache();
      } finally {
        isCacheRunning = false;
      }
    },
    {
      timezone: CRON_TIMEZONE,
    }
  );
}

module.exports = {
  checkScans,
  importScan,
  getAutoscanScan,
  listAutoscanScans,
  listScans,
  runImportBatch,
  refreshAutoscanScanCache,
  rebuildAutoscanScanCache,
  startScheduler,
};

if (require.main === module) {
  const { startHttpServer } = require('./http-server');
  startHttpServer();
  startScheduler();
}
