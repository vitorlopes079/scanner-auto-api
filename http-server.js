const http = require('http');

const PORT = Number(process.env.PORT || process.env.APILAYER_PORT || 3100);
const APILAYER_SECRET = process.env.APILAYER_SECRET;

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
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

  console.log(`[http] POST /import-one autoscanId=${autoscanId}`);
  const result = await importScan({ id: autoscanId });
  sendJson(res, httpStatusForResult(result), result);
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

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, status: 'ok' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/import-one') {
        await handleImportOne(req, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/cache-refresh') {
        await handleCacheRefresh(req, res);
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
    console.log(`[http] POST /import-one (header x-apilayer-secret)`);
    console.log(`[http] POST /cache-refresh (header x-apilayer-secret)`);
  });

  return server;
}

module.exports = { startHttpServer, PORT };
