const mongoose = require('mongoose');

/**
 * Platform Statistics Model
 * Tracks overall platform revenue, orders, and products sold
 * Single document that gets updated when orders are delivered
 */
const platformStatsSchema = new mongoose.Schema(
  {
    totalRevenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalOrders: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDeliveredOrders: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalProductsSold: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPendingOrders: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Daily revenue tracking for last 30 days
    dailyRevenue: [
      {
        date: {
          type: Date,
          required: true,
        },
        revenue: {
          type: Number,
          default: 0,
          min: 0,
        },
        orders: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one document exists
platformStatsSchema.statics.getStats = async function () {
  let stats = await this.findOne();
  if (!stats) {
    stats = await this.create({});
  }
  return stats;
};

// Update daily revenue
platformStatsSchema.methods.addDailyRevenue = function (date, revenue, orders = 1) {
  const dateStr = new Date(date).toISOString().split('T')[0];
  const existingDay = this.dailyRevenue.find(
    (d) => new Date(d.date).toISOString().split('T')[0] === dateStr
  );

  if (existingDay) {
    existingDay.revenue += revenue;
    existingDay.orders += orders;
  } else {
    this.dailyRevenue.push({
      date: new Date(dateStr),
      revenue,
      orders,
    });
  }

  // Keep only last 30 days
  if (this.dailyRevenue.length > 30) {
    this.dailyRevenue = this.dailyRevenue
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30);
  }
};

const PlatformStats = mongoose.model('PlatformStats', platformStatsSchema);

module.exports = PlatformStats;

