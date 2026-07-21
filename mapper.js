const PANEL_MAP = {
  Bonnet: { partNumber: 1, partNameDe: 'Motorhaube', partNameEn: 'Hood', direction: 'H' },
  Roof: { partNumber: 4, partNameDe: 'Dach', partNameEn: 'Roof', direction: 'H' },
  RailRoofLeft: { partNumber: 5, partNameDe: 'Dachrahmen links', partNameEn: 'Roof Frame Left', direction: 'V' },
  LeftFrontWing: { partNumber: 6, partNameDe: 'Kotflügel links', partNameEn: 'Fender Left', direction: 'V' },
  LeftFrontDoor: { partNumber: 7, partNameDe: 'Tür vorne links', partNameEn: 'Front Door Left', direction: 'V' },
  LeftRearDoor: { partNumber: 8, partNameDe: 'Tür hinten links', partNameEn: 'Rear Door Left', direction: 'V' },
  LeftRearWing: { partNumber: 9, partNameDe: 'Seitenwand links', partNameEn: 'Side Panel Left', direction: 'V' },
  Tailgate: { partNumber: 12, partNameDe: 'Heckdeckel unten', partNameEn: 'Trunk Lid Lower', direction: 'V' },
  RailRoofRight: { partNumber: 13, partNameDe: 'Dachrahmen rechts', partNameEn: 'Roof Frame Right', direction: 'V' },
  RightFrontWing: { partNumber: 14, partNameDe: 'Kotflügel rechts', partNameEn: 'Fender Right', direction: 'V' },
  RightFrontDoor: { partNumber: 15, partNameDe: 'Tür vorne rechts', partNameEn: 'Front Door Right', direction: 'V' },
  RightRearDoor: { partNumber: 16, partNameDe: 'Tür hinten rechts', partNameEn: 'Rear Door Right', direction: 'V' },
  RightRearWing: { partNumber: 17, partNameDe: 'Seitenwand rechts', partNameEn: 'Side Panel Right', direction: 'V' },
};

const ALL_PARTS = [
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

const SIZE_CLASS_MAP = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
};

const AUTOSCAN_KEY_BY_PART_NUMBER = Object.fromEntries(
  Object.entries(PANEL_MAP).map(([key, panel]) => [panel.partNumber, key])
);

function cleanLicensePlate(registrationNumber) {
  if (!registrationNumber) return '';
  return String(registrationNumber).replace(/[-.\s]+$/g, '');
}

function sumDamageCount(damageCount) {
  const grouped = {};

  for (const entry of damageCount || []) {
    const sizeClass = entry.sizeClass;
    const count = Number(entry.count) || 0;
    grouped[sizeClass] = (grouped[sizeClass] || 0) + count;
  }

  return grouped;
}

function calculateWeightedAverage(grouped) {
  let totalCount = 0;
  let weightedSum = 0;

  for (const [sizeClass, count] of Object.entries(grouped)) {
    const mmValue = SIZE_CLASS_MAP[sizeClass];
    if (mmValue == null || count <= 0) continue;

    totalCount += count;
    weightedSum += count * mmValue;
  }

  if (totalCount === 0) {
    return { dentCount: null, diameter: null };
  }

  const average = weightedSum / totalCount;
  let diameter = Math.round(average / 10) * 10;
  diameter = Math.min(80, Math.max(10, diameter));

  return {
    dentCount: totalCount,
    diameter: String(diameter),
  };
}

function mapPushToPaint(pushToPaint) {
  return pushToPaint ? 50 : 0;
}

function buildCorrectionByType(correctionParts) {
  const correctionByType = new Map();

  if (!Array.isArray(correctionParts)) return correctionByType;

  for (const part of correctionParts) {
    if (
      part &&
      typeof part === 'object' &&
      typeof part.carPartType === 'string' &&
      Array.isArray(part.damageCount)
    ) {
      correctionByType.set(part.carPartType, part.damageCount);
    }
  }

  return correctionByType;
}

function mapScanToPayload(scan, { correctionParts = null } = {}) {
  const car = scan.car || {};
  const damages = scan.scanResult?.carPartDamages || [];
  const damageByType = Object.fromEntries(
    damages.map((damage) => [damage.carPartType, damage])
  );
  const correctionByType = buildCorrectionByType(correctionParts);

  const parts = ALL_PARTS.map((part) => {
    const autoscanKey = AUTOSCAN_KEY_BY_PART_NUMBER[part.partNumber];

    if (!autoscanKey) {
      return {
        ...part,
        dentCount: null,
        diameter: null,
        alu25: false,
        pushToPaint: 0,
      };
    }

    const damage = damageByType[autoscanKey];
    const correctedDamageCount = correctionByType.get(autoscanKey);
    const grouped = sumDamageCount(
      correctedDamageCount ?? damage?.damageCount ?? []
    );
    const { dentCount, diameter } = calculateWeightedAverage(grouped);

    return {
      ...part,
      dentCount,
      diameter,
      alu25: Boolean(damage?.aluminium),
      pushToPaint: mapPushToPaint(Boolean(damage?.pushToPaint)),
    };
  });

  const brand = car.brand || '';
  const model = car.model || '';
  const brandType = [brand, model].filter(Boolean).join(' ');

  return {
    autoscanId: scan.id,
    licensePlate: cleanLicensePlate(car.registrationNumber),
    vin: car.chasisNumber || '',
    brandType,
    color: car.color || '',
    calcDate: scan.scanned,
    parts,
  };
}

module.exports = {
  PANEL_MAP,
  ALL_PARTS,
  SIZE_CLASS_MAP,
  buildCorrectionByType,
  cleanLicensePlate,
  sumDamageCount,
  calculateWeightedAverage,
  mapScanToPayload,
};
