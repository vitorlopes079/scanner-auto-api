require('dotenv').config();

const axios = require('axios');
const { mapScanToPayload } = require('./mapper');

const SCAN_ID = process.argv[2] || '6fb54868-e07a-4f84-b98b-e8cd27e1d7c9';
const BASE_URL = process.env.AUTOSCAN_BASE_URL;
const API_KEY = process.env.AUTOSCAN_API_KEY;

async function testMapper() {
  console.log(`Fetching scan: ${SCAN_ID}`);
  console.log(`GET ${BASE_URL}/api/ext/scans/${SCAN_ID}\n`);

  try {
    const { data: scan } = await axios.get(`${BASE_URL}/api/ext/scans/${SCAN_ID}`, {
      headers: {
        ApiKey: API_KEY,
      },
    });

    console.log('Scan fetched successfully.');
    console.log(`Car: ${scan.car?.brand} ${scan.car?.model} | ${scan.car?.registrationNumber}`);
    console.log(`carPartDamages: ${scan.scanResult?.carPartDamages?.length || 0}\n`);

    const payload = mapScanToPayload(scan);

    console.log('Mapped M4Car payload:');
    console.log(JSON.stringify(payload, null, 2));

    const withDents = payload.parts.filter((part) => part.dentCount != null);
    const empty = payload.parts.filter((part) => part.dentCount == null);
    console.log(`\nParts with dents: ${withDents.length}`);
    console.log(`Empty parts: ${empty.length}`);
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`Failed: ${message}`);
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testMapper();
