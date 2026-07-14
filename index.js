require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
// const cron = require('node-cron');
const { mapScanToPayload } = require('./mapper');

const PROCESSED_FILE = path.join(__dirname, 'processed.json');
const BASE_URL = process.env.AUTOSCAN_BASE_URL;
const API_KEY = process.env.AUTOSCAN_API_KEY;
const M4CAR_INTERNAL_URL = process.env.M4CAR_INTERNAL_URL;
const M4CAR_INTERNAL_SECRET = process.env.M4CAR_INTERNAL_SECRET;
const PAGE_SIZE = 50;
const IMPORT_DELAY_MS = 500;
const INCOMPLETE_ANALYZED = '0001-01-01T00:00:00+00:00';

console.log('=== AutoScan checker boot ===');
console.log('[pipeline-test] Ephemeral log for deployment pipeline verification');
console.log(`Base URL: ${BASE_URL}`);
console.log(`API key loaded: ${API_KEY ? `${API_KEY.slice(0, 8)}...` : 'MISSING'}`);
console.log(`M4Car URL: ${M4CAR_INTERNAL_URL}`);
console.log(`M4Car secret loaded: ${M4CAR_INTERNAL_SECRET ? 'yes' : 'MISSING'}`);
console.log(`Processed file: ${PROCESSED_FILE}`);
console.log(`Page size: ${PAGE_SIZE}`);

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    ApiKey: API_KEY,
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadProcessedIds() {
  console.log(`[processed] Reading ${PROCESSED_FILE}...`);
  const raw = fs.readFileSync(PROCESSED_FILE, 'utf8');
  const ids = JSON.parse(raw);
  console.log(`[processed] Loaded ${ids.length} processed scan ID(s)`);
  if (ids.length > 0) {
    console.log(`[processed] IDs: ${ids.join(', ')}`);
  }
  return new Set(ids);
}

function markAsProcessed(processedIds, scanId) {
  processedIds.add(scanId);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...processedIds], null, 2));
  console.log(`[processed] Marked ${scanId} as processed (${processedIds.size} total)`);
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

async function fetchScans(projectId, projectName) {
  console.log(`[api] Loading scans for project: ${projectName} (${projectId})`);
  return fetchAllPages(`/api/ext/projects/${projectId}/scans`, 'scans');
}

async function fetchScanDetails(scanId) {
  const { data } = await api.get(`/api/ext/scans/${scanId}`);
  return data;
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
    responseData?.quoteNumber ||
    responseData?.qtNumber ||
    responseData?.number ||
    responseData?.id ||
    'ok'
  );
}

async function importScan(summaryScan, processedIds) {
  const label = summaryScan.registrationNumber || summaryScan.id;

  try {
    console.log(`[import] ${label} → fetching full scan...`);
    const fullScan = await fetchScanDetails(summaryScan.id);

    const incompleteReason = isIncompleteScan(fullScan);
    if (incompleteReason) {
      console.log(`[import] ${label} → skipped (incomplete: ${incompleteReason})`);
      return;
    }

    console.log(`[import] ${label} → mapping data...`);
    const payload = mapScanToPayload(fullScan);

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
      markAsProcessed(processedIds, summaryScan.id);
      return;
    }

    if (response.status === 409) {
      console.log(`[import] ${label} → already imported, skipping`);
      markAsProcessed(processedIds, summaryScan.id);
      return;
    }

    const errorMessage =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data) || response.statusText;
    console.log(`[import] ${label} → ✗ failed: HTTP ${response.status} ${errorMessage}`);
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data) || error.response.statusText}`
      : error.message;
    console.log(`[import] ${label} → ✗ failed: ${message}`);
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
    const processedIds = loadProcessedIds();
    const projects = await fetchProjects();

    if (projects.length === 0) {
      console.log('[run] No projects found. Nothing to check.');
      return;
    }

    const allScans = [];

    for (const [index, project] of projects.entries()) {
      console.log(`[run] Fetching scans for project ${index + 1}/${projects.length}: ${project.name}`);
      const scans = await fetchScans(project.id, project.name);

      for (const scan of scans) {
        const isProcessed = processedIds.has(scan.id);
        console.log(
          `  [scan] ${scan.id} | reg: ${scan.registrationNumber || 'N/A'} | chassis: ${scan.chassisNumber || 'N/A'} | ${isProcessed ? 'PROCESSED' : 'NEW'}`
        );
        allScans.push({
          ...scan,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }

    const alreadyProcessed = allScans.filter((scan) => processedIds.has(scan.id));
    const newScans = allScans.filter((scan) => !processedIds.has(scan.id));

    console.log('\n---------- REPORT ----------');
    console.log(`Total scans found: ${allScans.length}`);
    console.log(`Already processed: ${alreadyProcessed.length}`);
    console.log(`New scans waiting: ${newScans.length}`);
    console.log('----------------------------');

    if (newScans.length === 0) {
      console.log('\nNo new scans waiting.');
    } else {
      const batch = limit != null ? newScans.slice(0, limit) : newScans;
      const remaining = newScans.length - batch.length;

      console.log(`\n[import] Processing up to ${batch.length} scans...`);

      for (const [index, scan] of batch.entries()) {
        await importScan(scan, processedIds);

        if (index < batch.length - 1) {
          await sleep(IMPORT_DELAY_MS);
        }
      }

      console.log(`[import] Done. Processed: ${batch.length}, Remaining: ${remaining}`);
    }

    console.log(`\n[run] Finished at ${new Date().toISOString()}`);
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
  }
}

// Cron disabled while testing manually via: node run-import.js
// console.log('Schedule: every 10 minutes (*/10 * * * *)');
// console.log('Running first check now...\n');
// checkScans();
// cron.schedule('*/10 * * * *', () => {
//   console.log('\n[cron] Triggered scheduled run');
//   checkScans();
// });

module.exports = { checkScans };
