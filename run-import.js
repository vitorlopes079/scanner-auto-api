const { checkScans } = require('./index');

async function main() {
  console.log('=== Manual import run (max 20 scans) ===\n');
  await checkScans({ limit: 20 });
}

main().catch((error) => {
  console.error('[error] Manual import failed:', error.message);
  process.exit(1);
});
