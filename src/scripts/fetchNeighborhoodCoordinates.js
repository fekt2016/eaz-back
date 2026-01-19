/**
 * Script to fetch coordinates for all neighborhoods from Google Maps Geocoding API
 * Reads from data/neighborhoods.accra.tema.json and updates with lat/lng
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { geocodeAddress } = require('../services/googleMapsService');

const DATA_FILE = path.join(__dirname, '../../data/neighborhoods.accra.tema.json');
const DELAY_BETWEEN_REQUESTS = 200; // 200ms delay to avoid rate limiting

/**
 * Fetch coordinates for a single neighborhood
 */
async function fetchCoordinates(neighborhood, retries = 3) {
  const address = `${neighborhood.name}, ${neighborhood.city}, Ghana`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`📍 Geocoding: ${address} (attempt ${attempt}/${retries});`);
      const result = await geocodeAddress(address);
      
      if (result && result.lat && result.lng) {
        return {
          lat: result.lat,
          lng: result.lng,
          formattedAddress: result.formattedAddress,
          placeId: result.placeId,
        };
      }
      
      // If no result, try with municipality
      if (neighborhood.municipality) {
        const addressWithMunicipality = `${neighborhood.name}, ${neighborhood.municipality}, ${neighborhood.city}, Ghana`;
        logger.info(`📍 Retrying with municipality: ${addressWithMunicipality}`);
        const result2 = await geocodeAddress(addressWithMunicipality);
        
        if (result2 && result2.lat && result2.lng) {
          return {
            lat: result2.lat,
            lng: result2.lng,
            formattedAddress: result2.formattedAddress,
            placeId: result2.placeId,
          };
        }
      }
      
      logger.warn(`⚠️  No coordinates found for: ${address}`);
      return null;
    } catch (error) {
      logger.error(`❌ Error geocoding ${address}:`, error.message);
      
      if (attempt < retries) {
        const delay = attempt * 1000; // Exponential backoff
        logger.info(`⏳ Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Main function to process all neighborhoods
 */
async function fetchAllCoordinates() {
  try {
    // Read the JSON file
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Data file not found: ${DATA_FILE}`);
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    logger.info(`📋 Found ${data.length} neighborhoods to process\n`);

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      updated: [],
    };

    // Process each neighborhood
    for (let i = 0; i < data.length; i++) {
      const neighborhood = data[i];
      
      // Skip if coordinates already exist
      if (neighborhood.lat && neighborhood.lng) {
        logger.info(`⏭️  Skipping ${neighborhood.name} - coordinates already exist`);
        results.skipped++;
        continue;
      }

      // Fetch coordinates
      const coords = await fetchCoordinates(neighborhood);
      
      if (coords) {
        data[i].lat = coords.lat;
        data[i].lng = coords.lng;
        data[i].formattedAddress = coords.formattedAddress;
        data[i].placeId = coords.placeId;
        
        results.success++;
        results.updated.push({
          name: neighborhood.name,
          city: neighborhood.city,
          lat: coords.lat,
          lng: coords.lng,
        });
        
        logger.info(`✅ ${neighborhood.name}: ${coords.lat}, ${coords.lng}`);
      } else {
        results.failed++;
        logger.info(`❌ Failed to get coordinates for: ${neighborhood.name}`);
      }

      // Save progress after each update
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      logger.info(`💾 Progress saved (${i + 1}/${data.length});\n`);

      // Delay between requests to avoid rate limiting
      if (i < data.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
    }

    // Final summary
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 FETCHING SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`✅ Successfully fetched: ${results.success} neighborhoods`);
    logger.info(`⏭️  Skipped (already have coordinates);: ${results.skipped} neighborhoods`);
    logger.info(`❌ Failed: ${results.failed} neighborhoods`);
    logger.info(`\n💾 Updated file: ${DATA_FILE}`);

    if (results.updated.length > 0) {
      logger.info('\n✅ Successfully updated neighborhoods:');
      results.updated.forEach((item) => {
        logger.info(`   - ${item.name}, ${item.city}: ${item.lat}, ${item.lng}`);
      });
    }

    return results;
  } catch (error) {
    logger.error('❌ Fatal error:', error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  fetchAllCoordinates()
    .then(() => {
      logger.info('\n✅ Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fetchAllCoordinates, fetchCoordinates };

