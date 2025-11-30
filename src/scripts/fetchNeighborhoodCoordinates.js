/**
 * Script to fetch coordinates for all neighborhoods from Google Maps Geocoding API
 * Reads from data/neighborhoods.accra.tema.json and updates with lat/lng
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
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
      console.log(`📍 Geocoding: ${address} (attempt ${attempt}/${retries})`);
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
        console.log(`📍 Retrying with municipality: ${addressWithMunicipality}`);
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
      
      console.warn(`⚠️  No coordinates found for: ${address}`);
      return null;
    } catch (error) {
      console.error(`❌ Error geocoding ${address}:`, error.message);
      
      if (attempt < retries) {
        const delay = attempt * 1000; // Exponential backoff
        console.log(`⏳ Retrying in ${delay}ms...`);
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
    console.log(`📋 Found ${data.length} neighborhoods to process\n`);

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
        console.log(`⏭️  Skipping ${neighborhood.name} - coordinates already exist`);
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
        
        console.log(`✅ ${neighborhood.name}: ${coords.lat}, ${coords.lng}`);
      } else {
        results.failed++;
        console.log(`❌ Failed to get coordinates for: ${neighborhood.name}`);
      }

      // Save progress after each update
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      console.log(`💾 Progress saved (${i + 1}/${data.length})\n`);

      // Delay between requests to avoid rate limiting
      if (i < data.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 FETCHING SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully fetched: ${results.success} neighborhoods`);
    console.log(`⏭️  Skipped (already have coordinates): ${results.skipped} neighborhoods`);
    console.log(`❌ Failed: ${results.failed} neighborhoods`);
    console.log(`\n💾 Updated file: ${DATA_FILE}`);

    if (results.updated.length > 0) {
      console.log('\n✅ Successfully updated neighborhoods:');
      results.updated.forEach((item) => {
        console.log(`   - ${item.name}, ${item.city}: ${item.lat}, ${item.lng}`);
      });
    }

    return results;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  }
}

// Run the script
if (require.main === module) {
  fetchAllCoordinates()
    .then(() => {
      console.log('\n✅ Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fetchAllCoordinates, fetchCoordinates };

