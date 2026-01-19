const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Neighborhood = require('../../models/shipping/neighborhoodModel');
const logger = require('../../utils/logger');
const { geocodeAddress } = require('../../services/googleMapsService');
const { getDistanceKm } = require('../../services/distanceService');
const { classifyZone } = require('../../services/zoneClassificationService');
const { WAREHOUSE_LOCATION } = require('../../config/warehouseConfig');

/**
 * Create a new neighborhood
 * POST /api/v1/admin/neighborhoods
 */
exports.createNeighborhood = catchAsync(async (req, res, next) => {
  const { name, city, municipality, lat, lng } = req.body;

  if (!name || !city || !municipality) {
    return next(new AppError('Name, city, and municipality are required', 400));
  }

  if (!['Accra', 'Tema'].includes(city)) {
    return next(new AppError('City must be Accra or Tema', 400));
  }

  // Check if neighborhood already exists
  const existing = await Neighborhood.findOne({ name, city });
  if (existing) {
    return next(new AppError('Neighborhood already exists', 400));
  }

  let finalLat = lat;
  let finalLng = lng;
  let formattedAddress = null;
  let placeId = null;
  let distanceFromHQ = null;
  let assignedZone = null;

  // If coordinates not provided, geocode the address
  if (!finalLat || !finalLng) {
    const address = `${name}, ${municipality}, ${city}, Ghana`;
    try {
      const geocodeResult = await geocodeAddress(address);
      if (geocodeResult && geocodeResult.lat && geocodeResult.lng) {
        finalLat = geocodeResult.lat;
        finalLng = geocodeResult.lng;
        formattedAddress = geocodeResult.formattedAddress;
        placeId = geocodeResult.placeId;
      }
    } catch (error) {
      logger.error('Geocoding error:', error.message);
    }
  }

  // Calculate distance and zone if coordinates exist
  if (finalLat && finalLng) {
    try {
      const distanceResult = await getDistanceKm(
        WAREHOUSE_LOCATION.lat,
        WAREHOUSE_LOCATION.lng,
        finalLat,
        finalLng
      );
      distanceFromHQ = Math.round(distanceResult.distanceKm * 100) / 100;
      assignedZone = classifyZone(distanceFromHQ);
    } catch (error) {
      logger.error('Distance calculation error:', error.message);
    }
  }

  const neighborhood = await Neighborhood.create({
    name,
    city,
    municipality,
    lat: finalLat,
    lng: finalLng,
    formattedAddress,
    googlePlaceId: placeId,
    distanceFromHQ,
    assignedZone,
    isActive: true,
  });

  res.status(201).json({
    status: 'success',
    message: 'Neighborhood created successfully',
    data: {
      neighborhood,
    },
  });
});

/**
 * Get all neighborhoods (admin view with pagination)
 * GET /api/v1/admin/neighborhoods
 */
exports.getAllNeighborhoods = catchAsync(async (req, res, next) => {
  const { city, municipality, isActive, search, zone, page = 1, limit = 50, sortBy = 'name', sortOrder = 'asc' } = req.query;

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
  
  if (zone) {
    filter.assignedZone = zone;
  }
  
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { municipality: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const sort = {};
  if (['name', 'city', 'municipality', 'distanceFromHQ', 'assignedZone'].includes(sortBy)) {
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
  } else {
    sort.name = 1;
  }

  const neighborhoods = await Neighborhood.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Neighborhood.countDocuments(filter);
  const totalPages = Math.ceil(total / limitNum);

  res.status(200).json({
    status: 'success',
    results: neighborhoods.length,
    pagination: {
      currentPage: pageNum,
      limit: limitNum,
      totalRecords: total,
      totalPages,
      hasPrevPage: pageNum > 1,
      hasNextPage: pageNum < totalPages,
    },
    data: {
      neighborhoods,
    },
  });
});

/**
 * Get a single neighborhood
 * GET /api/v1/admin/neighborhoods/:id
 */
exports.getNeighborhood = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const neighborhood = await Neighborhood.findById(id);

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
 * Update a neighborhood
 * PATCH /api/v1/admin/neighborhoods/:id
 */
exports.updateNeighborhood = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { name, city, municipality, lat, lng, isActive } = req.body;

  const neighborhood = await Neighborhood.findById(id);
  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  // Update fields
  if (name) neighborhood.name = name;
  if (city && ['Accra', 'Tema'].includes(city)) neighborhood.city = city;
  if (municipality) neighborhood.municipality = municipality;
  if (isActive !== undefined) neighborhood.isActive = isActive;

  // If coordinates are updated, recalculate distance and zone
  if (lat !== undefined || lng !== undefined) {
    const newLat = lat !== undefined ? lat : neighborhood.lat;
    const newLng = lng !== undefined ? lng : neighborhood.lng;
    
    if (newLat && newLng) {
      neighborhood.lat = newLat;
      neighborhood.lng = newLng;
      
      try {
        const distanceResult = await getDistanceKm(
          WAREHOUSE_LOCATION.lat,
          WAREHOUSE_LOCATION.lng,
          newLat,
          newLng
        );
        neighborhood.distanceFromHQ = Math.round(distanceResult.distanceKm * 100) / 100;
        neighborhood.assignedZone = classifyZone(neighborhood.distanceFromHQ);
      } catch (error) {
        logger.error('Distance calculation error:', error.message);
      }
    }
  }

  await neighborhood.save();

  res.status(200).json({
    status: 'success',
    message: 'Neighborhood updated successfully',
    data: {
      neighborhood,
    },
  });
});

/**
 * Delete a neighborhood
 * DELETE /api/v1/admin/neighborhoods/:id
 */
exports.deleteNeighborhood = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const neighborhood = await Neighborhood.findByIdAndDelete(id);
  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Neighborhood deleted successfully',
  });
});

/**
 * Re-fetch coordinates for a neighborhood
 * POST /api/v1/admin/neighborhoods/:id/refresh-coordinates
 */
exports.refreshCoordinates = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const neighborhood = await Neighborhood.findById(id);
  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  const address = `${neighborhood.name}, ${neighborhood.municipality}, ${neighborhood.city}, Ghana`;
  
  try {
    const geocodeResult = await geocodeAddress(address);
    
    if (geocodeResult && geocodeResult.latitude && geocodeResult.longitude) {
      neighborhood.lat = geocodeResult.latitude;
      neighborhood.lng = geocodeResult.longitude;
      neighborhood.formattedAddress = geocodeResult.formattedAddress;
      neighborhood.googlePlaceId = geocodeResult.placeId;

      // Recalculate distance and zone using Haversine
      const { haversineDistance } = require('../../utils/haversine');
      const distanceKm = haversineDistance(
        WAREHOUSE_LOCATION.lat,
        WAREHOUSE_LOCATION.lng,
        geocodeResult.latitude,
        geocodeResult.longitude
      );
      neighborhood.distanceFromHQ = distanceKm;
      neighborhood.distanceKm = distanceKm;
      neighborhood.assignedZone = classifyZone(distanceKm);
      neighborhood.zone = classifyZone(distanceKm);

      await neighborhood.save();

      res.status(200).json({
        status: 'success',
        message: 'Coordinates refreshed successfully',
        data: {
          neighborhood,
        },
      });
    } else {
      return next(new AppError('Failed to geocode neighborhood address', 400));
    }
  } catch (error) {
    return next(new AppError(`Failed to refresh coordinates: ${error.message}`, 500));
  }
});

/**
 * Recalculate distance and zone for a neighborhood
 * PATCH /api/v1/admin/neighborhoods/:id/recalculate
 */
exports.recalculateNeighborhood = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError('Invalid neighborhood ID format', 400));
  }

  const neighborhood = await Neighborhood.findById(id);
  if (!neighborhood) {
    return next(new AppError('Neighborhood not found', 404));
  }

  // Check if coordinates exist
  if (!neighborhood.lat || !neighborhood.lng) {
    return next(new AppError('Neighborhood coordinates are missing. Please fetch coordinates first.', 400));
  }

  try {
    // Recalculate distance and zone using Haversine
    const { haversineDistance } = require('../../utils/haversine');
    const distanceKm = haversineDistance(
      WAREHOUSE_LOCATION.lat,
      WAREHOUSE_LOCATION.lng,
      neighborhood.lat,
      neighborhood.lng
    );
    
    const zone = classifyZone(distanceKm);
    
    neighborhood.distanceFromHQ = distanceKm;
    neighborhood.distanceKm = distanceKm;
    neighborhood.assignedZone = zone;
    neighborhood.zone = zone;

    await neighborhood.save();

    res.status(200).json({
      status: 'success',
      message: 'Neighborhood recalculated successfully',
      data: {
        neighborhood,
      },
    });
  } catch (error) {
    return next(new AppError(`Failed to recalculate neighborhood: ${error.message}`, 500));
  }
});

/**
 * Get neighborhood statistics
 * GET /api/v1/admin/neighborhoods/statistics
 */
exports.getNeighborhoodStatistics = catchAsync(async (req, res, next) => {
  const stats = await Neighborhood.aggregate([
    {
      $group: {
        _id: '$city',
        total: { $sum: 1 },
        active: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
        },
        withCoordinates: {
          $sum: { $cond: [{ $and: [{ $ne: ['$lat', null] }, { $ne: ['$lng', null] }] }, 1, 0] },
        },
      },
    },
  ]);

  // Get zone statistics with count and average distance
  const zoneStats = await Neighborhood.aggregate([
    {
      $match: {
        assignedZone: { $in: ['A', 'B', 'C', 'D', 'E', 'F'] },
        isActive: true,
      },
    },
    {
      $group: {
        _id: '$assignedZone',
        count: { $sum: 1 },
        averageDistance: {
          $avg: {
            $cond: [
              { $and: [{ $ne: ['$distanceFromHQ', null] }, { $ne: ['$distanceFromHQ', undefined] }] },
              '$distanceFromHQ',
              null,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Format zone stats for frontend
  const statistics = {};
  zoneStats.forEach((zone) => {
    statistics[`zone${zone._id}`] = {
      count: zone.count,
      averageDistance: zone.averageDistance ? Math.round(zone.averageDistance * 100) / 100 : 0,
    };
  });

  // Ensure all zones are represented
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach((zone) => {
    if (!statistics[`zone${zone}`]) {
      statistics[`zone${zone}`] = { count: 0, averageDistance: 0 };
    }
  });

  res.status(200).json({
    status: 'success',
    data: {
      statistics,
      byCity: stats,
      byZone: zoneStats,
      total: await Neighborhood.countDocuments(),
      active: await Neighborhood.countDocuments({ isActive: true }),
      withCoordinates: await Neighborhood.countDocuments({ lat: { $ne: null }, lng: { $ne: null } }),
    },
  });
});

