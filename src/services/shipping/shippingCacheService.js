const ShippingZone = require('../../models/shipping/shippingZoneModel');
const ShippingTier = require('../../models/shipping/shippingTierModel');
const logger = require('../../utils/logger');

class ShippingCacheService {
    constructor() {
        this.zonesCache = new Map();
        this.tiersCache = new Map();
        this.lastZoneFetch = 0;
        this.lastTierFetch = 0;
        this.TTL = 5 * 60 * 1000; // 5 minutes TTL
    }

    async _refreshZones() {
        const now = Date.now();
        if (now - this.lastZoneFetch < this.TTL && this.zonesCache.size > 0) {
            return;
        }
        try {
            const activeZones = await ShippingZone.find({ isActive: true });
            this.zonesCache.clear();
            activeZones.forEach((z) => {
                this.zonesCache.set(z.name, z); // e.g., 'A', 'B'
                this.zonesCache.set(z._id.toString(), z); // fallback by ID
            });
            this.lastZoneFetch = now;
            logger.info(`[ShippingCacheService] Refreshed ${activeZones.length} shipping zones into cache.`);
        } catch (error) {
            logger.error('[ShippingCacheService] Error refreshing zones:', error);
        }
    }

    async _refreshTiers() {
        const now = Date.now();
        if (now - this.lastTierFetch < this.TTL && this.tiersCache.size > 0) {
            return;
        }
        try {
            const activeTiers = await ShippingTier.find({ isActive: true });
            this.tiersCache.clear();
            activeTiers.forEach((t) => {
                this.tiersCache.set(t._id.toString(), t);
            });
            // Set default tier as a fallback (highest threshold or default)
            const defaultTier = activeTiers.find((t) => t.name.includes('Tier 2')) || activeTiers[0];
            if (defaultTier) {
                this.tiersCache.set('DEFAULT', defaultTier);
            }
            this.lastTierFetch = now;
            logger.info(`[ShippingCacheService] Refreshed ${activeTiers.length} shipping tiers into cache.`);
        } catch (error) {
            logger.error('[ShippingCacheService] Error refreshing tiers:', error);
        }
    }

    async getZone(zoneIdentifier) {
        if (!zoneIdentifier) return null;
        await this._refreshZones();
        // Identifier could be "A" or an ObjectId string
        return this.zonesCache.get(zoneIdentifier.toString().toUpperCase()) || this.zonesCache.get(zoneIdentifier.toString());
    }

    async getAllZones() {
        await this._refreshZones();
        // Return unique zones by ID
        const uniqueZonesMap = new Map();
        for (const [key, zone] of this.zonesCache.entries()) {
            if (!uniqueZonesMap.has(zone._id.toString())) {
                uniqueZonesMap.set(zone._id.toString(), zone);
            }
        }
        return Array.from(uniqueZonesMap.values());
    }

    async getTier(tierId) {
        await this._refreshTiers();
        if (!tierId) {
            return this.tiersCache.get('DEFAULT');
        }
        return this.tiersCache.get(tierId.toString()) || this.tiersCache.get('DEFAULT');
    }

    async getDefaultTier() {
        await this._refreshTiers();
        return this.tiersCache.get('DEFAULT');
    }

    // Force invalidation
    invalidate() {
        this.lastZoneFetch = 0;
        this.lastTierFetch = 0;
        this.zonesCache.clear();
        this.tiersCache.clear();
        logger.info('[ShippingCacheService] Cache invalidated manually.');
    }
}

// Export a singleton instance
module.exports = new ShippingCacheService();
