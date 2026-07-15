const { importScan } = require('./index');

async function main() {
  const scanId = process.argv[2];

  if (!scanId) {
    console.error('Usage: npm run import:one -- <autoscanId>');
    process.exit(1);
  }

  console.log(`=== Manual single-scan import ===`);
  console.log(`Scan id: ${scanId}`);
  console.log('Checkpoint is not updated by this script.\n');

  const result = await importScan({ id: scanId });
  console.log(`[result] status=${result.status} ok=${result.ok} ${result.message}`);
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[error] Single-scan import failed:', error.message);
  process.exit(1);
});
