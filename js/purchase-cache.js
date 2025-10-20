/**
 * Purchase History Cache Manager
 * 
 * Purpose: Cache user's purchase history in memory for fast lookups
 * Performance: <1ms for cached data vs 20-500ms for server queries
 * Cache Duration: 15 minutes (configurable)
 */

class PurchaseHistoryCache {
    constructor() {
        // In-memory cache storage
        this.cache = new Map();
        
        // Cache configuration
        this.config = {
            ttl: 15 * 60 * 1000,  // 15 minutes in milliseconds
            maxSize: 100          // Maximum number of cached users
        };
        
        // Statistics for monitoring
        this.stats = {
            hits: 0,
            misses: 0,
            totalQueries: 0
        };
        
        console.log('Purchase History Cache initialized');
    }

    /**
     * Get user's purchase history (cached or fresh)
     * @param {number} userId - User ID
     * @param {string|null} codigo - Optional product code filter
     * @param {string|null} descripcion - Optional description filter
     * @returns {Promise<Array>} - Array of purchased products
     */
    async getUserHistory(userId, codigo = null, descripcion = null) {
        this.stats.totalQueries++;
        
        // Generate cache key (include filters in key)
        const cacheKey = this.generateCacheKey(userId, codigo, descripcion);
        
        // Check if cache exists and is valid
        const cacheEntry = this.cache.get(cacheKey);
        
        if (cacheEntry && this.isCacheValid(cacheEntry)) {
            this.stats.hits++;
            console.log(`✅ Cache HIT for user ${userId} (${this.getCacheHitRate()}% hit rate)`);
            return cacheEntry.data;
        }
        
        // Cache miss - fetch from server
        this.stats.misses++;
        console.log(`📥 Cache MISS for user ${userId} - fetching from server...`);
        
        const startTime = performance.now();
        
        try {
            // Fetch from Supabase using optimized function
            const data = await window.supabaseClient.getUserPurchaseHistoryOptimized(
                userId, 
                codigo, 
                descripcion
            );
            
            const fetchTime = Math.round(performance.now() - startTime);
            console.log(`⏱️ Server fetch took ${fetchTime}ms, caching for ${this.config.ttl / 1000}s`);
            
            // Store in cache
            this.setCache(cacheKey, data);
            
            // Enforce cache size limit
            this.enforceMaxSize();
            
            return data;
            
        } catch (error) {
            console.error('Error fetching purchase history:', error);
            // Return empty array on error
            return [];
        }
    }

    /**
     * Generate unique cache key
     */
    generateCacheKey(userId, codigo, descripcion) {
        const parts = [userId];
        if (codigo) parts.push(`c:${codigo}`);
        if (descripcion) parts.push(`d:${descripcion}`);
        return parts.join('|');
    }

    /**
     * Check if cache entry is still valid
     */
    isCacheValid(cacheEntry) {
        const age = Date.now() - cacheEntry.timestamp;
        return age < this.config.ttl;
    }

    /**
     * Store data in cache
     */
    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    /**
     * Enforce maximum cache size (LRU-like eviction)
     */
    enforceMaxSize() {
        if (this.cache.size > this.config.maxSize) {
            // Remove oldest entry
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            console.log(`🗑️ Cache evicted oldest entry (size: ${this.cache.size})`);
        }
    }

    /**
     * Calculate cache hit rate
     */
    getCacheHitRate() {
        if (this.stats.totalQueries === 0) return 0;
        return Math.round((this.stats.hits / this.stats.totalQueries) * 100);
    }

    /**
     * Invalidate cache for a specific user
     * Call this when user makes a new purchase
     */
    invalidateUser(userId) {
        let deleted = 0;
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${userId}|`)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        if (deleted > 0) {
            console.log(`🔄 Invalidated ${deleted} cache entries for user ${userId}`);
        }
    }

    /**
     * Clear all cache
     * Call this on logout or when switching users
     */
    clearAll() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, totalQueries: 0 };
        console.log(`🗑️ Cache cleared (${size} entries removed)`);
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.stats,
            hitRate: this.getCacheHitRate(),
            cacheSize: this.cache.size,
            maxSize: this.config.maxSize
        };
    }

    /**
     * Preload cache (optional - call after login)
     * Fetches data in background without waiting
     */
    async preload(userId) {
        console.log(`🚀 Preloading purchase history for user ${userId}...`);
        
        // Fire and forget - don't wait for result
        this.getUserHistory(userId, null, null).catch(err => {
            console.error('Error preloading cache:', err);
        });
    }
}

// Create global instance
window.purchaseCache = new PurchaseHistoryCache();
console.log('🛒 Purchase Cache Manager loaded');

