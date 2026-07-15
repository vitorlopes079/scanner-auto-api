const { prisma } = require('./lib/prisma');

async function main() {
  console.log('=== Clear AutoscanScanCache ===\n');

  const before = await prisma.autoscanScanCache.count();
  console.log(`[cache] Rows before: ${before}`);

  const result = await prisma.autoscanScanCache.deleteMany();
  console.log(`Deleted ${result.count} rows from AutoscanScanCache`);

  const after = await prisma.autoscanScanCache.count();
  console.log(`[cache] Rows after: ${after}`);
}

main()
  .catch((error) => {
    console.error('[error] Cache clear failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
