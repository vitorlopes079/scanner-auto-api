const { runImportBatch } = require('./index');

async function main() {
  console.log('=== Manual state-based import run (max 50 scan attempts) ===\n');
  await runImportBatch();
}

main().catch((error) => {
  console.error('[error] Manual import failed:', error.message);
  process.exit(1);
});
