const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Neighborhood = require('../../models/shipping/neighborhoodModel');

/**
 * Get all neighborhoods with optional filtering
 * GET /api/v1/neighborhoods
 */
exports.getAllNeighborhoods = catchAsync(async (req, res, next) => {
  const { city, municipality, isActive, search, page = 1, limit = 50 } = req.query;

  const filter = {};
  
  if (city) {
    filter.city = city;
  }
  
  if (municipality) {
    filter.municipality = { $regex: municipality, $options: 'i' };
  }
  
  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }
  
  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const neighborhoods = await Neighborhood.find(filter)
    .sort({ city: 1, name: 1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Neighborhood.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: neighborhoods.length,
    pagination: {
      currentPage: pageNum,
      limit: limitNum,
      totalRecords: total,
      totalPages: Math.ceil(total / limitNum),
    },
    data: {
      neighborhoods,
    },
  });
});

/**
 * Get a single neighborhood by ID or name
 * GET /api/v1/neighborhoods/:id
 * GET /api/v1/locations/neighborhoods/:name
 */
exports.getNeighborhood = catchAsync(async (req, res, next) => {
  const { id, name } = req.params;

  let neighborhood;
  
  // Try to find by ID first (MongoDB ObjectId)
  if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
    neighborhood = await Neighborhood.findById(id);
  } else if (name) {
    // Find by name
    neighborhood = await Neighborhood.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      isActive: true 
    });
  } else if (id) {
    // Try to find by name if not a valid ObjectId
    neighborhood = await Neighborhood.findOne({ 
      name: { $regex: new RegExp(`^${id}$`, 'i') },
      isActive: true 
    });
  }

  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      neighborhood,
    },
  });
});

/**
 * Search neighborhoods by name (autocomplete)
 * Also searches by municipality if no direct name matches are found
 * GET /api/v1/neighborhoods/search?q=...
 */
exports.searchNeighborhoods = catchAsync(async (req, res, next) => {
  const { q, city, limit = 10 } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        neighborhoods: [],
      },
    });
  }

  const searchQuery = q.trim();
  const searchLimit = parseInt(limit, 10);

  // First, try searching by neighborhood name
  const nameFilter = {
    name: { $regex: searchQuery, $options: 'i' },
    isActive: true,
  };

  if (city) {
    nameFilter.city = city;
  }

  let neighborhoods = await Neighborhood.find(nameFilter)
    .sort({ name: 1 })
    .limit(searchLimit)
    .select('name city municipality lat lng assignedZone')
    .lean();

  // If no results by name, try searching by municipality
  // This handles cases where the search term is a municipality (e.g., "Ayawaso")
  if (neighborhoods.length === 0) {
    const municipalityFilter = {
      municipality: { $regex: searchQuery, $options: 'i' },
      isActive: true,
    };

    if (city) {
      municipalityFilter.city = city;
    }

    neighborhoods = await Neighborhood.find(municipalityFilter)
      .sort({ name: 1 })
      .limit(searchLimit)
      .select('name city municipality lat lng assignedZone')
      .lean();
  }

  res.status(200).json({
    status: 'success',
    results: neighborhoods.length,
    data: {
      neighborhoods,
    },
  });
});

/**
 * Get neighborhoods by city
 * GET /api/v1/neighborhoods/city/:city
 */
exports.getNeighborhoodsByCity = catchAsync(async (req, res, next) => {
  const { city } = req.params;

  if (!['Accra', 'Tema'].includes(city)) {
    return next(new AppError('Invalid city. Must be Accra or Tema', 400));
  }

  const neighborhoods = await Neighborhood.find({
    city,
    isActive: true,
  })
    .sort({ name: 1 })
    .select('name municipality lat lng assignedZone distanceFromHQ')
    .lean();

  res.status(200).json({
    status: 'success',
    results: neighborhoods.length,
    data: {
      neighborhoods,
    },
  });
});

/**
 * Get Google Maps embed URL for route from HQ to neighborhood
 * GET /api/v1/neighborhoods/:id/map-url
 */
exports.getMapUrl = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { getWarehouseLocation } = require('../../config/warehouseConfig');

  const neighborhood = await Neighborhood.findById(id);
  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  if (!neighborhood.lat || !neighborhood.lng) {
    return next(new AppError('Neighborhood coordinates are missing', 400));
  }

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleMapsApiKey) {
    return next(new AppError('Google Maps API key not configured', 500));
  }

  // Get warehouse location (async)
  const warehouseLocation = await getWarehouseLocation();
  
  // Generate Google Maps Embed URL with directions
  // Use the specific address string for origin to ensure correct location (Nima) is shown
  // Using address ensures Google Maps shows "HRH2+R22, Al-Waleed bin Talal Highway, Accra, Ghana" instead of geocoding coordinates to wrong location
  const originAddress = warehouseLocation.address || 'HRH2+R22, Al-Waleed bin Talal Highway, Accra, Ghana';
  const destination = `${neighborhood.lat},${neighborhood.lng}`;
  
  // Use directions mode with address string for origin - this shows both origin (red marker) and destination (blue marker)
  // Using address string ensures the correct location (Nima) is displayed, not Cantonments
  const mapUrl = `https://www.google.com/maps/embed/v1/directions?key=${googleMapsApiKey}&origin=${encodeURIComponent(originAddress)}&destination=${destination}&zoom=13&maptype=roadmap`;

  res.status(200).json({
    status: 'success',
    data: {
      mapUrl,
      origin: {
        lat: warehouseLocation.lat,
        lng: warehouseLocation.lng,
        address: warehouseLocation.address,
      },
      destination: {
        lat: neighborhood.lat,
        lng: neighborhood.lng,
        name: neighborhood.name,
        address: neighborhood.formattedAddress,
      },
      distance: neighborhood.distanceFromHQ || neighborhood.distanceKm,
      zone: neighborhood.assignedZone || neighborhood.zone,
    },
  });
});
