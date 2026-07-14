const axios = require('axios');

const PARTS_WITH_DATA = new Set([1, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17]);

const PANEL_DEFINITIONS = [
  { partNumber: 1, partNameDe: 'Motorhaube', partNameEn: 'Hood', direction: 'H' },
  { partNumber: 2, partNameDe: 'Toledoblech', partNameEn: 'Toledo Panel', direction: 'H' },
  { partNumber: 3, partNameDe: 'Schiebedach', partNameEn: 'Sunroof', direction: 'H' },
  { partNumber: 4, partNameDe: 'Dach', partNameEn: 'Roof', direction: 'H' },
  { partNumber: 5, partNameDe: 'Dachrahmen links', partNameEn: 'Roof Frame Left', direction: 'V' },
  { partNumber: 6, partNameDe: 'Kotflügel links', partNameEn: 'Fender Left', direction: 'V' },
  { partNumber: 7, partNameDe: 'Tür vorne links', partNameEn: 'Front Door Left', direction: 'V' },
  { partNumber: 8, partNameDe: 'Tür hinten links', partNameEn: 'Rear Door Left', direction: 'V' },
  { partNumber: 9, partNameDe: 'Seitenwand links', partNameEn: 'Side Panel Left', direction: 'V' },
  { partNumber: 10, partNameDe: 'Schwelle links', partNameEn: 'Rocker Panel Left', direction: 'V' },
  { partNumber: 11, partNameDe: 'Heckdeckel oben', partNameEn: 'Trunk Lid Upper', direction: 'H' },
  { partNumber: 12, partNameDe: 'Heckdeckel unten', partNameEn: 'Trunk Lid Lower', direction: 'V' },
  { partNumber: 13, partNameDe: 'Dachrahmen rechts', partNameEn: 'Roof Frame Right', direction: 'V' },
  { partNumber: 14, partNameDe: 'Kotflügel rechts', partNameEn: 'Fender Right', direction: 'V' },
  { partNumber: 15, partNameDe: 'Tür vorne rechts', partNameEn: 'Front Door Right', direction: 'V' },
  { partNumber: 16, partNameDe: 'Tür hinten rechts', partNameEn: 'Rear Door Right', direction: 'V' },
  { partNumber: 17, partNameDe: 'Seitenwand rechts', partNameEn: 'Side Panel Right', direction: 'V' },
  { partNumber: 18, partNameDe: 'Schwelle rechts', partNameEn: 'Rocker Panel Right', direction: 'V' },
];

function buildParts() {
  return PANEL_DEFINITIONS.map((panel) => {
    const hasData = PARTS_WITH_DATA.has(panel.partNumber);
    return {
      ...panel,
      dentCount: hasData ? 5 : null,
      diameter: hasData ? '20' : null,
    };
  });
}

async function testImport() {
  const parts = buildParts();

  const payload = {
    autoscanId: 'test-scan-001',
    licensePlate: 'SP310B',
    vin: 'B32S',
    brandType: 'Suzuki Baleno',
    color: 'Gray',
    calcDate: '2026-07-06T08:59:30.663Z',
    parts,
  };

  console.log('POST http://localhost:3000/api/internal/import-scan');
  console.log(`Parts with data: ${PARTS_WITH_DATA.size}`);
  console.log(`Parts empty: ${18 - PARTS_WITH_DATA.size}`);
  console.log('\nPayload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\nSending request...\n');

  try {
    const { data, status } = await axios.post(
      'http://localhost:3000/api/internal/import-scan',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret':
            '389ef5754fbdd83034b416412fd08ed6a758678ed64a21f91b71f3dd0497457a',
        },
      }
    );

    console.log(`HTTP ${status}`);
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
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

testImport();
