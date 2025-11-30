const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { analyzeAllZonesDistance } = require('../../services/distanceAnalyzerService');
const { analyzeAllZonesDistanceImproved } = require('../../services/improvedDistanceAnalyzer');
const DistanceRecord = require('../../models/shipping/distanceRecordModel');

/**
 * Analyze distances for all zones
 * GET /api/v1/shipping-analysis/all-zones-distance
 */
exports.analyzeAllZones = catchAsync(async (req, res, next) => {
  try {
    const useImproved = req.query.improved === 'true';
    
    const analysisResults = useImproved 
      ? await analyzeAllZonesDistanceImproved()
      : await analyzeAllZonesDistance();

    res.status(200).json({
      status: 'success',
      message: 'Distance analysis completed',
      data: {
        analysis: analysisResults,
        method: useImproved ? 'improved' : 'standard',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Distance analysis error:', error);
    return next(new AppError(`Distance analysis failed: ${error.message}`, 500));
  }
});

/**
 * Analyze and save distances to database
 * POST /api/v1/shipping-analysis/analyze-and-save
 */
exports.analyzeAndSave = catchAsync(async (req, res, next) => {
  try {
    const useImproved = req.body.improved === true;
    
    const analysisResults = useImproved
      ? await analyzeAllZonesDistanceImproved()
      : await analyzeAllZonesDistance();

    // Save results to database
    const savePromises = [];
    for (const [zone, zoneData] of Object.entries(analysisResults)) {
      for (const townData of zoneData.all) {
        if (townData.distanceKm !== null) {
          savePromises.push(
            DistanceRecord.findOneAndUpdate(
              { zone: townData.zone, town: townData.town },
              {
                zone: townData.zone,
                town: townData.town,
                distanceKm: townData.distanceKm,
                distanceMeters: townData.distanceMeters,
                updatedAt: new Date(),
                error: null,
              },
              { upsert: true, new: true }
            )
          );
        } else if (townData.error) {
          // Save error records too
          savePromises.push(
            DistanceRecord.findOneAndUpdate(
              { zone: townData.zone, town: townData.town },
              {
                zone: townData.zone,
                town: townData.town,
                distanceKm: null,
                distanceMeters: null,
                updatedAt: new Date(),
                error: townData.error,
              },
              { upsert: true, new: true }
            )
          );
        }
      }
    }

    await Promise.all(savePromises);

    res.status(200).json({
      status: 'success',
      message: 'Distance analysis completed and saved to database',
      data: {
        analysis: analysisResults,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Distance analysis and save error:', error);
    return next(new AppError(`Distance analysis and save failed: ${error.message}`, 500));
  }
});

/**
 * Get saved distance records with pagination
 * GET /api/v1/shipping-analysis/records
 * Query params: zone, sortBy, sortOrder, page, limit
 */
exports.getDistanceRecords = catchAsync(async (req, res, next) => {
  const { 
    zone, 
    sortBy = 'distanceKm', 
    sortOrder = 'asc',
    page = 1,
    limit = 10
  } = req.query;

  const filter = {};
  if (zone && ['A', 'B', 'C', 'D', 'E', 'F'].includes(zone)) {
    filter.zone = zone;
  }

  const sort = {};
  if (sortBy === 'distanceKm' || sortBy === 'town' || sortBy === 'zone') {
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
  } else {
    sort.distanceKm = 1; // Default sort
  }

  // Parse pagination parameters
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Get total count for pagination
  const total = await DistanceRecord.countDocuments(filter);

  // Fetch paginated records
  const records = await DistanceRecord.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limitNum)
    .lean();

  // Calculate pagination metadata
  const totalPages = Math.ceil(total / limitNum);
  const hasNextPage = pageNum < totalPages;
  const hasPrevPage = pageNum > 1;

  // Format records
  const formattedRecords = records.map(record => ({
    _id: record._id,
    town: record.town,
    zone: record.zone,
    distanceKm: record.distanceKm,
    distanceMeters: record.distanceMeters,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    error: record.error,
  }));

  res.status(200).json({
    status: 'success',
    results: formattedRecords.length,
    pagination: {
      currentPage: pageNum,
      limit: limitNum,
      totalRecords: total,
      totalPages,
      hasNextPage,
      hasPrevPage,
    },
    data: {
      records: formattedRecords,
    },
  });
});

