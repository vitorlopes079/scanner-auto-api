const http = require('http');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const swaggerUiDist = require('swagger-ui-dist');
const { PANEL_MAP } = require('./mapper');

const PORT = Number(process.env.PORT || process.env.APILAYER_PORT || 3100);
const APILAYER_SECRET = process.env.APILAYER_SECRET;
const DEFAULT_IMPORT_BATCH_LIMIT = 50;
const prisma = new PrismaClient();
const KNOWN_PANEL_NAMES = new Set(Object.keys(PANEL_MAP));
const SWAGGER_UI_PATH = swaggerUiDist.getAbsoluteFSPath();
const OPENAPI_PATH = path.join(__dirname, 'openapi.json');
let isImportBatchRunning = false;
const importBatchStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  limit: null,
  lastResult: null,
};

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function contentTypeForFile(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, {
        ok: false,
        status: 'error',
        message: 'Not found',
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypeForFile(filePath),
      'Content-Length': content.length,
    });
    res.end(content);
  });
}

function handleDocs(req, res) {
  void req;
  sendText(
    res,
    200,
    'text/html; charset=utf-8',
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>M4Car API Layer Docs</title>
    <link rel="stylesheet" href="/swagger-ui/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
      .swagger-ui section.models,
      .swagger-ui .models { display: none !important; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/swagger-ui/swagger-ui-bundle.js"></script>
    <script src="/swagger-ui/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: 'StandaloneLayout',
        persistAuthorization: true,
        defaultModelsExpandDepth: -1
      });
    </script>
  </body>
</html>`
  );
}

function handleOpenApi(req, res) {
  void req;
  sendFile(res, OPENAPI_PATH);
}

function handleSwaggerAsset(url, res) {
  const assetName = decodeURIComponent(url.pathname.replace('/swagger-ui/', ''));
  const assetPath = path.resolve(SWAGGER_UI_PATH, assetName);

  if (!assetPath.startsWith(`${SWAGGER_UI_PATH}${path.sep}`)) {
    sendJson(res, 404, {
      ok: false,
      status: 'error',
      message: 'Not found',
    });
    return;
  }

  sendFile(res, assetPath);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function httpStatusForResult(result) {
  if (!result.ok) return 502;
  if (result.status === 'created') return 201;
  if (result.status === 'already_imported') return 200;
  if (result.status === 'incomplete') return 200;
  return 200;
}

function assertApilayerSecret(req, res) {
  if (!APILAYER_SECRET) {
    sendJson(res, 500, {
      ok: false,
      status: 'error',
      message: 'APILAYER_SECRET is not configured',
    });
    return false;
  }

  const provided = req.headers['x-apilayer-secret'];
  if (!provided || provided !== APILAYER_SECRET) {
    sendJson(res, 401, {
      ok: false,
      status: 'error',
      message: 'Unauthorized',
    });
    return false;
  }

  return true;
}

async function handleImportOne(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      status: 'error',
      message: error.message,
    });
    return;
  }

  const autoscanId =
    typeof body.autoscanId === 'string' ? body.autoscanId.trim() : '';
  const overwrite = body?.overwrite === true;
  if (!autoscanId) {
    sendJson(res, 400, {
      ok: false,
      status: 'error',
      message: 'autoscanId is required',
    });
    return;
  }

  // Lazy require avoids circular load with index.js boot.
  const { importScan } = require('./index');

  console.log(
    `[http] POST /import-one autoscanId=${autoscanId}${overwrite ? ' overwrite=true' : ''}`
  );
  const result = await importScan({ id: autoscanId }, { overwrite });
  sendJson(res, httpStatusForResult(result), result);
}

async function handleScanPhotosRefresh(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      status: 'error',
      message: error.message,
    });
    return;
  }

  const autoscanId =
    typeof body.autoscanId === 'string' ? body.autoscanId.trim() : '';
  if (!autoscanId) {
    sendJson(res, 400, {
      ok: false,
      status: 'error',
      message: 'autoscanId is required',
    });
    return;
  }

  try {
    const { refreshScanPhotos } = require('./index');
    console.log(`[http] POST /scan-photos-refresh autoscanId=${autoscanId}`);
    const result = await refreshScanPhotos(autoscanId);
    sendJson(res, 200, result);
  } catch (error) {
    const status = Number(error?.response?.status);
    const message = messageForExternalError(
      error,
      'Failed to refresh AutoScan photos'
    );
    console.error(`[http] POST /scan-photos-refresh failed: ${message}`);
    sendJson(res, status === 404 ? 404 : 502, {
      ok: false,
      status: 'error',
      autoscanId,
      message,
    });
  }
}

function validationError(message) {
  return {
    ok: false,
    status: 'error',
    message,
  };
}

function validateAutoscanCorrectionBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: validationError('Request body must be an object'),
    };
  }

  const autoscanId =
    typeof body.autoscanId === 'string' ? body.autoscanId.trim() : '';
  if (!autoscanId) {
    return { ok: false, response: validationError('autoscanId is required') };
  }

  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    return {
      ok: false,
      response: validationError('parts must be a non-empty array'),
    };
  }

  const seenPanels = new Set();
  const parts = [];

  for (let partIndex = 0; partIndex < body.parts.length; partIndex += 1) {
    const part = body.parts[partIndex];
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      return {
        ok: false,
        response: validationError(`parts[${partIndex}] must be an object`),
      };
    }

    const carPartType =
      typeof part.carPartType === 'string' ? part.carPartType.trim() : '';
    if (!carPartType) {
      return {
        ok: false,
        response: validationError(`parts[${partIndex}].carPartType is required`),
      };
    }
    if (!KNOWN_PANEL_NAMES.has(carPartType)) {
      return {
        ok: false,
        response: validationError(
          `Unknown carPartType "${carPartType}". Must be one of: ${Array.from(KNOWN_PANEL_NAMES).join(', ')}`
        ),
      };
    }
    if (seenPanels.has(carPartType)) {
      return {
        ok: false,
        response: validationError(`Duplicate carPartType "${carPartType}"`),
      };
    }
    seenPanels.add(carPartType);

    if (!Array.isArray(part.damageCount)) {
      return {
        ok: false,
        response: validationError(
          `parts[${partIndex}].damageCount must be an array`
        ),
      };
    }

    const damageCount = [];
    for (
      let damageIndex = 0;
      damageIndex < part.damageCount.length;
      damageIndex += 1
    ) {
      const damage = part.damageCount[damageIndex];
      if (!damage || typeof damage !== 'object' || Array.isArray(damage)) {
        return {
          ok: false,
          response: validationError(
            `parts[${partIndex}].damageCount[${damageIndex}] must be an object`
          ),
        };
      }

      if (
        !Number.isInteger(damage.sizeClass) ||
        damage.sizeClass < 1 ||
        damage.sizeClass > 8
      ) {
        return {
          ok: false,
          response: validationError(
            `parts[${partIndex}].damageCount[${damageIndex}].sizeClass must be an integer between 1 and 8`
          ),
        };
      }

      if (!Number.isInteger(damage.count)) {
        return {
          ok: false,
          response: validationError(
            `parts[${partIndex}].damageCount[${damageIndex}].count must be an integer`
          ),
        };
      }

      damageCount.push({
        sizeClass: damage.sizeClass,
        count: damage.count,
      });
    }

    parts.push({ carPartType, damageCount });
  }

  return { ok: true, autoscanId, parts };
}

async function handleScanCorrections(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, validationError(error.message));
    return;
  }

  const validation = validateAutoscanCorrectionBody(body);
  if (!validation.ok) {
    sendJson(res, 400, validation.response);
    return;
  }

  const existing = await prisma.autoscanCorrection.findUnique({
    where: { autoscanId: validation.autoscanId },
    select: { autoscanId: true, parts: true },
  });

  const existingParts = Array.isArray(existing?.parts) ? existing.parts : [];
  const mergedPartsByType = new Map();

  for (const part of existingParts) {
    if (
      part &&
      typeof part === 'object' &&
      typeof part.carPartType === 'string'
    ) {
      mergedPartsByType.set(part.carPartType, part);
    }
  }

  for (const part of validation.parts) {
    mergedPartsByType.set(part.carPartType, part);
  }

  const mergedParts = Array.from(mergedPartsByType.values());

  const saved = await prisma.autoscanCorrection.upsert({
    where: { autoscanId: validation.autoscanId },
    create: {
      autoscanId: validation.autoscanId,
      parts: mergedParts,
    },
    update: {
      parts: mergedParts,
      submittedAt: new Date(),
    },
  });

  console.log(
    `[http] POST /scan-corrections autoscanId=${validation.autoscanId} submittedParts=${validation.parts.length} savedParts=${mergedParts.length}`
  );
  sendJson(res, existing ? 200 : 201, {
    ok: true,
    status: existing ? 'updated' : 'created',
    data: saved,
  });
}

async function handleGetScanCorrection(req, res, autoscanId) {
  if (!assertApilayerSecret(req, res)) return;

  const normalizedAutoscanId =
    typeof autoscanId === 'string' ? decodeURIComponent(autoscanId).trim() : '';

  if (!normalizedAutoscanId) {
    sendJson(res, 400, validationError('autoscanId is required'));
    return;
  }

  const correction = await prisma.autoscanCorrection.findUnique({
    where: { autoscanId: normalizedAutoscanId },
  });

  if (!correction) {
    sendJson(res, 404, {
      ok: false,
      status: 'error',
      message: 'No correction exists for this autoscanId',
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    status: 'ok',
    data: correction,
  });
}

async function handleDeleteScanCorrectionPart(req, res, autoscanId, carPartType) {
  if (!assertApilayerSecret(req, res)) return;

  const normalizedAutoscanId =
    typeof autoscanId === 'string' ? decodeURIComponent(autoscanId).trim() : '';
  const normalizedCarPartType =
    typeof carPartType === 'string' ? decodeURIComponent(carPartType).trim() : '';

  if (!normalizedAutoscanId) {
    sendJson(res, 400, validationError('autoscanId is required'));
    return;
  }

  if (!normalizedCarPartType) {
    sendJson(res, 400, validationError('carPartType is required'));
    return;
  }

  const correction = await prisma.autoscanCorrection.findUnique({
    where: { autoscanId: normalizedAutoscanId },
    select: { autoscanId: true, parts: true, submittedAt: true },
  });

  if (!correction) {
    sendJson(res, 404, {
      ok: false,
      status: 'error',
      message: 'No correction exists for this autoscanId',
    });
    return;
  }

  const parts = Array.isArray(correction.parts) ? correction.parts : [];
  const remainingParts = parts.filter(
    (part) =>
      !(
        part &&
        typeof part === 'object' &&
        typeof part.carPartType === 'string' &&
        part.carPartType === normalizedCarPartType
      )
  );

  if (remainingParts.length === parts.length) {
    sendJson(res, 404, {
      ok: false,
      status: 'error',
      message: 'No correction exists for this carPartType on this autoscanId',
    });
    return;
  }

  if (remainingParts.length === 0) {
    await prisma.autoscanCorrection.delete({
      where: { autoscanId: normalizedAutoscanId },
    });
    console.log(
      `[http] DELETE /scan-corrections autoscanId=${normalizedAutoscanId} carPartType=${normalizedCarPartType} deletedRow=true`
    );
    sendJson(res, 200, {
      ok: true,
      status: 'deleted',
      autoscanId: normalizedAutoscanId,
      carPartType: normalizedCarPartType,
      data: null,
    });
    return;
  }

  const saved = await prisma.autoscanCorrection.update({
    where: { autoscanId: normalizedAutoscanId },
    data: {
      parts: remainingParts,
      submittedAt: new Date(),
    },
  });

  console.log(
    `[http] DELETE /scan-corrections autoscanId=${normalizedAutoscanId} carPartType=${normalizedCarPartType} remainingParts=${remainingParts.length}`
  );
  sendJson(res, 200, {
    ok: true,
    status: 'updated',
    autoscanId: normalizedAutoscanId,
    carPartType: normalizedCarPartType,
    data: saved,
  });
}

function httpStatusForExternalError(error) {
  const status = Number(error?.response?.status);
  if (status === 404) return 404;
  if (status === 400) return 400;
  if (status === 401 || status === 403) return 502;
  return 502;
}

function messageForExternalError(error, fallback) {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.response?.statusText) {
    return `${error.response.status} ${error.response.statusText}`;
  }
  return error?.message || fallback;
}

async function handleListScans(req, res, url) {
  if (!assertApilayerSecret(req, res)) return;

  const orderByParam = url.searchParams.get('orderBy');
  const orderBy = orderByParam === 'Ascending' ? 'Ascending' : 'Descending';

  try {
    const { listAutoscanScans } = require('./index');
    const scans = await listAutoscanScans({ orderBy });
    sendJson(res, 200, {
      ok: true,
      status: 'ok',
      count: scans.length,
      data: scans,
    });
  } catch (error) {
    const message = messageForExternalError(error, 'Failed to list AutoScan scans');
    console.error(`[http] GET /scans failed: ${message}`);
    sendJson(res, httpStatusForExternalError(error), {
      ok: false,
      status: 'error',
      message,
    });
  }
}

async function handleGetScan(req, res, autoscanId) {
  if (!assertApilayerSecret(req, res)) return;

  const normalizedAutoscanId =
    typeof autoscanId === 'string' ? decodeURIComponent(autoscanId).trim() : '';

  if (!normalizedAutoscanId) {
    sendJson(res, 400, validationError('autoscanId is required'));
    return;
  }

  try {
    const { getAutoscanScan } = require('./index');
    const scan = await getAutoscanScan(normalizedAutoscanId);
    sendJson(res, 200, {
      ok: true,
      status: 'ok',
      data: scan,
    });
  } catch (error) {
    const message = messageForExternalError(error, 'Failed to fetch AutoScan scan');
    console.error(`[http] GET /scans/${normalizedAutoscanId} failed: ${message}`);
    sendJson(res, httpStatusForExternalError(error), {
      ok: false,
      status: 'error',
      message,
    });
  }
}

async function handleCacheRefresh(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  // Drain body if present (optional for this endpoint).
  try {
    await readJsonBody(req);
  } catch {
    // ignore empty/invalid body for trigger endpoint
  }

  console.log('[http] POST /cache-refresh');
  const { refreshAutoscanScanCache } = require('./index');
  const result = await refreshAutoscanScanCache();
  sendJson(res, result.ok ? 200 : 502, result);
}

async function handleImportBatch(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      status: 'error',
      message: error.message,
    });
    return;
  }

  if (isImportBatchRunning) {
    sendJson(res, 409, {
      ok: false,
      status: 'already_running',
      message: 'An import batch is already running',
    });
    return;
  }

  const requestedLimit = Number(body.limit);
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : DEFAULT_IMPORT_BATCH_LIMIT;

  isImportBatchRunning = true;
  importBatchStatus.running = true;
  importBatchStatus.startedAt = new Date().toISOString();
  importBatchStatus.finishedAt = null;
  importBatchStatus.limit = limit;
  importBatchStatus.lastResult = null;
  console.log(`[http] POST /import-batch limit=${limit}`);

  try {
    const { runImportBatch } = require('./index');
    const result = await runImportBatch({ limit });
    importBatchStatus.lastResult = result || null;
    sendJson(res, result?.status === 'error' ? 502 : 200, result || {
      ok: false,
      status: 'error',
      message: 'Import batch did not return a result',
    });
  } finally {
    isImportBatchRunning = false;
    importBatchStatus.running = false;
    importBatchStatus.finishedAt = new Date().toISOString();
  }
}

function handleImportBatchStatus(req, res) {
  if (!assertApilayerSecret(req, res)) return;

  sendJson(res, 200, {
    ok: true,
    status: 'ok',
    running: importBatchStatus.running,
    startedAt: importBatchStatus.startedAt,
    finishedAt: importBatchStatus.finishedAt,
    limit: importBatchStatus.limit,
    lastResult: importBatchStatus.lastResult,
  });
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, status: 'ok' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/docs') {
        handleDocs(req, res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/openapi.json') {
        handleOpenApi(req, res);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/swagger-ui/')) {
        handleSwaggerAsset(url, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/import-one') {
        await handleImportOne(req, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/scan-photos-refresh') {
        await handleScanPhotosRefresh(req, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/scan-corrections') {
        await handleScanCorrections(req, res);
        return;
      }

      const scanCorrectionPartMatch = url.pathname.match(
        /^\/scan-corrections\/([^/]+)\/([^/]+)$/
      );
      if (req.method === 'DELETE' && scanCorrectionPartMatch) {
        await handleDeleteScanCorrectionPart(
          req,
          res,
          scanCorrectionPartMatch[1],
          scanCorrectionPartMatch[2]
        );
        return;
      }

      const scanCorrectionMatch = url.pathname.match(/^\/scan-corrections\/([^/]+)$/);
      if (req.method === 'GET' && scanCorrectionMatch) {
        await handleGetScanCorrection(req, res, scanCorrectionMatch[1]);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/scans') {
        await handleListScans(req, res, url);
        return;
      }

      const scanMatch = url.pathname.match(/^\/scans\/([^/]+)$/);
      if (req.method === 'GET' && scanMatch) {
        await handleGetScan(req, res, scanMatch[1]);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/cache-refresh') {
        await handleCacheRefresh(req, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/import-batch') {
        await handleImportBatch(req, res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/import-batch/status') {
        handleImportBatchStatus(req, res);
        return;
      }

      sendJson(res, 404, {
        ok: false,
        status: 'error',
        message: 'Not found',
      });
    } catch (error) {
      console.error(`[http] Unhandled error: ${error.message}`);
      sendJson(res, 500, {
        ok: false,
        status: 'error',
        message: error.message || 'Internal server error',
      });
    }
  });

  server.listen(PORT, () => {
    console.log(`[http] Listening on port ${PORT}`);
    console.log(`[http] GET /docs`);
    console.log(`[http] GET /openapi.json`);
    console.log(`[http] POST /import-one (header x-apilayer-secret)`);
    console.log(`[http] POST /scan-photos-refresh (header x-apilayer-secret)`);
    console.log(`[http] POST /scan-corrections (header x-apilayer-secret)`);
    console.log(`[http] GET /scan-corrections/{autoscanId} (header x-apilayer-secret)`);
    console.log(`[http] GET /scans (header x-apilayer-secret)`);
    console.log(`[http] GET /scans/{autoscanId} (header x-apilayer-secret)`);
    console.log(`[http] POST /cache-refresh (header x-apilayer-secret)`);
    console.log(`[http] POST /import-batch (header x-apilayer-secret)`);
    console.log(`[http] GET /import-batch/status (header x-apilayer-secret)`);
  });

  return server;
}

module.exports = { startHttpServer, PORT };
