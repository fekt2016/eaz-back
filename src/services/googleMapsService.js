const axios = require('axios');

/**
 * Google Maps Service
 * Handles geocoding (address → coordinates) and reverse geocoding (coordinates → address) using Google Maps Geocoding API
 */

/**
 * Simple reverse geocode function that directly calls Google Maps API
 * Returns clean address components without additional processing
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Parsed address data
 */
async function reverseGeocodeSimple(lat, lng) {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error('Google Maps API key not configured');
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleMapsApiKey}`;
    const response = await axios.get(url, {
      timeout: 15000,
    });

    const results = response.data.results;

    if (!results || !results.length) {
      return null;
    }

    const components = results[0].address_components;

    const get = (type) => {
      const component = components.find((c) => c.types.includes(type));
      return component ? component.long_name : '';
    };

    return {
      latitude: lat,
      longitude: lng,
      streetAddress: get('route'),
      town: get('neighborhood') || get('sublocality_level_1') || get('sublocality_level_2'),
      city: get('locality'),
      district: get('administrative_area_level_2'),
      region: get('administrative_area_level_1'),
      country: get('country'),
      formattedAddress: results[0].formatted_address || '',
    };
  } catch (error) {
    console.error('Google Maps API error:', error.message);
    throw new Error(`Failed to reverse geocode: ${error.message}`);
  }
}

/**
 * Reverse geocode GPS coordinates to physical address using Google Maps API
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Parsed address data
 */
async function reverseGeocode(lat, lng) {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    console.warn('Google Maps API key not found, using mock reverse geocoding');
    return mockReverseGeocode(lat, lng);
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${lat},${lng}`,
        key: googleMapsApiKey,
        region: 'gh', // Bias results to Ghana
        language: 'en', // English language
        result_type: 'street_address|route|neighborhood|sublocality|locality|administrative_area_level_1|administrative_area_level_2|country',
        location_type: 'ROOFTOP|RANGE_INTERPOLATED|GEOMETRIC_CENTER|APPROXIMATE',
      },
      timeout: 15000,
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      return parseGoogleMapsResponse(response.data.results[0], lat, lng);
    } else if (response.data.status === 'ZERO_RESULTS') {
      console.warn('Google Maps API returned zero results, using mock data');
      return mockReverseGeocode(lat, lng);
    } else {
      console.warn(`Google Maps API error: ${response.data.status}, using mock data`);
      return mockReverseGeocode(lat, lng);
    }
  } catch (error) {
    console.error('Google Maps API error:', error.message);
    console.warn('Falling back to mock reverse geocoding');
    return mockReverseGeocode(lat, lng);
  }
}

/**
 * Parse Google Maps geocoding response into structured address
 * @param {Object} result - Google Maps API result object
 * @param {number} lat - Original latitude
 * @param {number} lng - Original longitude
 * @returns {Object} Parsed address data
 */
function parseGoogleMapsResponse(result, lat, lng) {
  const addressComponents = result.address_components || [];
  const formattedAddress = result.formatted_address || '';

  // Initialize address fields
  let street = null;
  let town = null;
  let city = null;
  let region = null;
  let country = null;
  let streetNumber = null;
  let route = null;
  let political = null;

  // Parse address components - prioritize more specific types first
  for (const component of addressComponents) {
    const types = component.types || [];
    const longName = component.long_name;
    const shortName = component.short_name;

    // Street number (most specific)
    if (types.includes('street_number')) {
      streetNumber = longName;
    }

    // Route (street name) - prioritize this
    if (types.includes('route') && !route) {
      route = longName;
    }

    // Street address (complete street) - highest priority
    if (types.includes('street_address')) {
      street = longName;
    }

    // Political route (fallback for street)
    if (types.includes('political') && types.includes('route') && !route) {
      political = longName;
    }

    // Neighborhood (town) - most specific
    if (types.includes('neighborhood') && !town) {
      town = longName;
    }
    
    // Sublocality levels (town) - prioritize level 1, then level 2
    if (types.includes('sublocality_level_1') && !town) {
      town = longName;
    }
    if (types.includes('sublocality_level_2') && !town) {
      town = longName;
    }
    if ((types.includes('sublocality') || types.includes('sublocality_level_3')) && !town) {
      town = longName;
    }

    // Locality (city) - prioritize this
    if (types.includes('locality') && !city) {
      city = longName;
    }
    
    // Administrative area level 2 (district/county) - can help with town
    if (types.includes('administrative_area_level_2') && !town) {
      town = longName;
    }

    // Administrative area level 1 (region/state)
    if (types.includes('administrative_area_level_1') && !region) {
      region = longName;
    }

    // Country
    if (types.includes('country') && !country) {
      country = longName;
    }
  }

  // Construct street address if we have components
  // Priority: street_address > route + street_number > route > political > formatted address first part
  if (!street) {
    if (streetNumber && route) {
      street = `${streetNumber} ${route}`;
    } else if (route) {
      street = route;
    } else if (political && political !== city && political !== town) {
      street = political;
    } else if (streetNumber) {
      street = streetNumber;
    }
  }

  // Fallback: extract street from formatted address if still null
  if (!street && formattedAddress) {
    const parts = formattedAddress.split(',');
    street = parts[0]?.trim() || null;
  }

  // Normalize region to lowercase
  if (region) {
    region = region.toLowerCase();
  }

  return {
    latitude: lat,
    longitude: lng,
    street: street || null,
    town: town || null,
    city: city || null,
    region: region || null,
    country: country || null,
    formattedAddress: formattedAddress || null,
    placeId: result.place_id || null,
  };
}

/**
 * Mock reverse geocoding fallback (when API key is unavailable)
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Object} Mock address data
 */
function mockReverseGeocode(lat, lng) {
  // Determine location based on coordinates
  let street = '';
  let town = '';
  let city = '';
  let region = '';
  let country = 'Ghana';

  // Greater Accra region
  if (lat >= 5.4 && lat <= 6.0 && lng >= -0.4 && lng <= 0.3) {
    city = 'Accra';
    region = 'Greater Accra';
    
    if (lat >= 5.55 && lat <= 5.65 && lng >= -0.25 && lng <= -0.1) {
      town = 'Osu';
      street = `${Math.floor((lat * 1000) % 100)} Oxford Street`;
    } else if (lat >= 5.6 && lat <= 5.7 && lng >= -0.15 && lng <= -0.05) {
      town = 'East Legon';
      street = `${Math.floor((lat * 1000) % 100)} Legon Road`;
    } else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.2 && lng <= -0.1) {
      town = 'Labone';
      street = `${Math.floor((lat * 1000) % 100)} Labone Road`;
    } else {
      town = 'Accra Central';
      street = `${Math.floor((lat * 1000) % 100)} High Street`;
    }
  }
  // Ashanti region (Kumasi)
  else if (lat >= 6.6 && lat <= 6.8 && lng >= -1.7 && lng <= -1.5) {
    city = 'Kumasi';
    region = 'Ashanti';
    town = 'Kumasi';
    street = `${Math.floor((lat * 1000) % 100)} Kejetia Road`;
  }
  // Western region (Takoradi)
  else if (lat >= 4.8 && lat <= 5.0 && lng >= -1.8 && lng <= -1.6) {
    city = 'Takoradi';
    region = 'Western';
    town = 'Takoradi';
    street = `${Math.floor((lat * 1000) % 100)} Market Circle Road`;
  }
  // Central region (Cape Coast)
  else if (lat >= 5.1 && lat <= 5.3 && lng >= -1.3 && lng <= -1.1) {
    city = 'Cape Coast';
    region = 'Central';
    town = 'Cape Coast';
    street = `${Math.floor((lat * 1000) % 100)} Kotokuraba Road`;
  }
  // Tema
  else if (lat >= 5.65 && lat <= 5.75 && lng >= 0.0 && lng <= 0.1) {
    city = 'Tema';
    region = 'Greater Accra';
    town = 'Tema';
    street = `${Math.floor((lat * 1000) % 100)} Community 1 Road`;
  }
  // Kasoa
  else if (lat >= 5.5 && lat <= 5.6 && lng >= -0.45 && lng <= -0.35) {
    city = 'Kasoa';
    region = 'Central';
    town = 'Kasoa';
    street = `${Math.floor((lat * 1000) % 100)} Kasoa Road`;
  }
  // Default fallback
  else {
    city = 'Accra';
    region = 'Greater Accra';
    town = 'Unknown';
    street = `${Math.floor((lat * 1000) % 100)} Main Street`;
  }

  return {
    latitude: lat,
    longitude: lng,
    street: street || null,
    town: town || null,
    city: city || null,
    region: region.toLowerCase() || null,
    country: country || null,
    formattedAddress: `${street}, ${town}, ${city}, ${region}`,
    placeId: null,
  };
}

/**
 * Geocode an address string to coordinates
 * Converts a human-readable address to latitude/longitude coordinates
 * @param {string} address - Address string (e.g., "HRH2+R22, Al-Waleed bin Talal Highway, Accra, Ghana")
 * @returns {Promise<Object>} { lat, lng, formattedAddress, placeId }
 */
async function geocodeAddress(address) {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error('Google Maps API key not configured');
  }

  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new Error('Valid address string is required');
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: address.trim(),
        key: googleMapsApiKey,
        region: 'gh', // Bias results to Ghana
        language: 'en',
      },
      timeout: 15000,
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;
      
      return {
        lat: location.lat,
        lng: location.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        addressComponents: result.address_components,
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      throw new Error(`No results found for address: ${address}`);
    } else {
      throw new Error(`Geocoding failed: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`Google Maps API error: ${error.response.data?.error_message || error.message}`);
    }
    throw new Error(`Failed to geocode address: ${error.message}`);
  }
}

module.exports = {
  reverseGeocode,
  reverseGeocodeSimple,
  geocodeAddress,
  parseGoogleMapsResponse,
  mockReverseGeocode,
};

