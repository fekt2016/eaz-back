/**
 * Digital Address Helper Utilities
 * Functions for GhanaPostGPS digital address lookup and zone detection
 */

/**
 * Mock GhanaPostGPS digital address lookup
 * In production, this would call the actual GhanaPostGPS API
 * @param {String} digitalAddress - Digital address in format GA-123-4567
 * @returns {Object} Address details with zone information
 */
exports.lookupDigitalAddress = async (digitalAddress) => {
  if (!digitalAddress) {
    throw new Error('Digital address is required');
  }

  // Validate format
  const cleaned = digitalAddress.replace(/[^A-Z0-9]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{7}$/.test(cleaned)) {
    throw new Error('Invalid digital address format. Use GA-123-4567');
  }

  // Format as GA-123-4567
  const formatted = `${cleaned.substring(0, 2)}-${cleaned.substring(2, 5)}-${cleaned.substring(5)}`;

  // Extract zone from digital address (mock logic)
  // In real implementation, this would query GhanaPostGPS API
  const zoneCode = cleaned.substring(2, 5);
  const zoneNumber = parseInt(zoneCode);

  // Mock zone detection based on digital address ranges
  // Zone A: Accra central (000-200)
  // Zone B: Greater Accra suburbs (201-500)
  // Zone C: Nationwide (501-999)
  let zone = 'C';
  let city = 'ACCRA';
  let region = 'greater accra';

  if (zoneNumber <= 200) {
    zone = 'A';
    city = 'ACCRA';
    region = 'greater accra';
  } else if (zoneNumber <= 500) {
    zone = 'B';
    city = 'ACCRA';
    region = 'greater accra';
  } else {
    zone = 'C';
    // Could be any city, default to ACCRA
    city = 'ACCRA';
    region = 'greater accra';
  }

  // Mock street address generation
  // In production, this would come from GhanaPostGPS API
  const streetNumber = zoneNumber % 100;
  const streetNames = [
    'Independence Avenue',
    'Oxford Street',
    'Ring Road',
    'Airport Road',
    'Spintex Road',
    'Tema Motorway',
    'Legon Road',
    'East Legon',
    'Cantonments',
    'Labone',
  ];
  const streetName = streetNames[zoneNumber % streetNames.length];
  const streetAddress = `${streetNumber} ${streetName}`;

  // Mock town/city detection
  const towns = ['Accra', 'Tema', 'East Legon', 'Labone', 'Cantonments', 'Osu'];
  const town = towns[zoneNumber % towns.length];

  return {
    digitalAddress: formatted,
    streetAddress,
    city,
    town,
    region,
    zone,
    country: 'Ghana',
  };
};

/**
 * Detect zone from city name
 * @param {String} city - City name
 * @returns {String} Zone ID (A, B, or C)
 */
exports.detectZoneFromCity = (city) => {
  if (!city) return 'C';

  const normalizedCity = city.toUpperCase().trim();

  // Zone A: Same city (Accra central)
  if (normalizedCity === 'ACCRA') {
    return 'A';
  }

  // Zone B: Nearby cities (Tema, etc.)
  if (normalizedCity === 'TEMA') {
    return 'B';
  }

  // Zone C: Nationwide (all other cities)
  return 'C';
};

/**
 * Validate digital address format
 * @param {String} digitalAddress - Digital address to validate
 * @returns {Boolean} True if valid
 */
exports.validateDigitalAddress = (digitalAddress) => {
  if (!digitalAddress) return false;
  const cleaned = digitalAddress.replace(/[^A-Z0-9]/g, '').toUpperCase();
  return /^[A-Z]{2}\d{7}$/.test(cleaned);
};

