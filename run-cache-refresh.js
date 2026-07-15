const { refreshAutoscanScanCache } = require('./index');

async function main() {
  console.log('=== Manual AutoscanScanCache refresh ===\n');
  const result = await refreshAutoscanScanCache();
  console.log(
    `[result] ok=${result.ok} cached=${result.cachedCount} skipped=${result.skippedCached} failed=${result.failedDetails}`
  );
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[error] Cache refresh failed:', error.message);
  process.exit(1);
});
