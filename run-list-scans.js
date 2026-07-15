const { listScans } = require('./index');

async function main() {
  console.log('=== Manual scan list (read-only) ===\n');
  await listScans();
}

main().catch((error) => {
  console.error('[error] List scans failed:', error.message);
  process.exit(1);
});
