require('dotenv').config();

const axios = require('axios');

const SCAN_ID = process.argv[2] || '6fb54868-e07a-4f84-b98b-e8cd27e1d7c9';
const BASE_URL = process.env.AUTOSCAN_BASE_URL;
const API_KEY = process.env.AUTOSCAN_API_KEY;

async function inspectScan() {
  if (!process.argv[2]) {
    console.log(`No scanId provided. Using default: ${SCAN_ID}`);
  }

  const url = `${BASE_URL}/api/ext/scans/${SCAN_ID}`;

  console.log(`Fetching scan: ${SCAN_ID}`);
  console.log(`GET ${url}\n`);

  try {
    const { data, status } = await axios.get(url, {
      headers: {
        ApiKey: API_KEY,
      },
    });

    console.log(`HTTP ${status}`);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error.response
      ? `${error.response.status} ${error.response.statusText}`
      : error.message;
    console.error(`Failed to fetch scan: ${message}`);
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

inspectScan();
