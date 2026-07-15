const { rebuildAutoscanScanCache } = require('./index');

async function main() {
  console.log('=== Manual AutoscanScanCache FULL rebuild ===\n');
  const result = await rebuildAutoscanScanCache();
  console.log(
    `[result] ok=${result.ok} upserted=${result.upsertedCount} list=${result.listTotal} failed=${result.failedDetails}`
  );
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[error] Cache rebuild failed:', error.message);
  process.exit(1);
});
