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
            ttl: 24 * 60 * 60 * 1000,  // 24 hours in milliseconds
            maxSize: 100,               // Maximum number of cached users
            autoRefresh: true           // Enable automatic refresh
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
     * Get user's purchase history with LOCAL search (no server queries for filtering)
     * @param {number} userId - User ID
     * @param {string|null} codigo - Optional product code filter
     * @param {string|null} descripcion - Optional description filter
     * @returns {Promise<Array>} - Array of purchased products
     */
    async getUserHistory(userId, codigo = null, descripcion = null) {
        this.stats.totalQueries++;
        
        // Check if we have the full user history cached (without filters)
        const fullHistoryKey = `user_${userId}_full`;
        const fullHistoryEntry = this.cache.get(fullHistoryKey);
        
        if (fullHistoryEntry && this.isCacheValid(fullHistoryEntry)) {
            // We have the full history cached - do LOCAL search
            this.stats.hits++;
            console.log(`✅ Cache HIT for user ${userId} - doing LOCAL search (${this.getCacheHitRate()}% hit rate)`);
            
            // Check if cache needs refresh (24 hours old)
            if (this.needsRefresh(fullHistoryEntry)) {
                const ageHours = Math.round((Date.now() - fullHistoryEntry.timestamp) / (1000 * 60 * 60));
                console.log(`🔄 Cache is ${ageHours} hours old, refreshing in background for user ${userId}`);
                this.refreshInBackground(userId);
            }
            
            return this.searchLocally(fullHistoryEntry.data, codigo, descripcion);
        }
        
        // Cache miss - fetch FULL history from server (no filters)
        this.stats.misses++;
        console.log(`📥 Cache MISS for user ${userId} - fetching FULL history from server...`);
        
        const startTime = performance.now();
        
        try {
            // Fetch FULL history from Supabase (no filters - get everything)
            const data = await window.supabaseClient.getUserPurchaseHistoryOptimized(
                userId, 
                null,  // No code filter
                null   // No description filter
            );
            
            const fetchTime = Math.round(performance.now() - startTime);
            console.log(`⏱️ Server fetch took ${fetchTime}ms, caching FULL history for ${this.config.ttl / 1000}s`);
            
            // Store FULL history in cache
            this.setCache(fullHistoryKey, data);
            
            // Enforce cache size limit
            this.enforceMaxSize();
            
            // Do LOCAL search on the full data
            return this.searchLocally(data, codigo, descripcion);
            
        } catch (error) {
            console.error('Error fetching purchase history:', error);
            // Return empty array on error
            return [];
        }
    }

    /**
     * Search locally in user's purchase history (same logic as product search)
     * @param {Array} fullHistory - Complete user purchase history
     * @param {string|null} codigo - Optional product code filter
     * @param {string|null} descripcion - Optional description filter
     * @returns {Array} - Filtered results
     */
    searchLocally(fullHistory, codigo = null, descripcion = null) {
        let results = [...fullHistory]; // Start with all products
        
        // Filter by code if provided
        if (codigo) {
            const codeUpper = codigo.toUpperCase().trim();
            results = results.filter(item => 
                item.codigo.toUpperCase().includes(codeUpper)
            );
        }
        
        // Filter by description if provided (same logic as searchByDescriptionAllWords)
        if (descripcion) {
            const words = descripcion
                .toLowerCase()
                .trim()
                .split(/\s+/)
                .filter(w => w.length > 0);
            
            if (words.length > 0) {
                results = results.filter(item => {
                    const descLower = item.descripcion.toLowerCase();
                    return words.every(word => descLower.includes(word));
                });
            }
        }
        
        console.log(`🔍 Local search: ${fullHistory.length} total → ${results.length} filtered`);
        return results;
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
     * Check if cache entry needs refresh (24 hours old)
     */
    needsRefresh(cacheEntry) {
        const age = Date.now() - cacheEntry.timestamp;
        const refreshThreshold = 24 * 60 * 60 * 1000; // 24 hours
        return age > refreshThreshold;
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
            if (key.startsWith(`user_${userId}_`) || key.startsWith(`${userId}|`)) {
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
     * Refresh cache in background (24+ hours old)
     * Updates cache without blocking current search
     */
    async refreshInBackground(userId) {
        console.log(`🔄 Background refresh for user ${userId}...`);
        
        try {
            // Fetch fresh data from server
            const data = await window.supabaseClient.getUserPurchaseHistoryOptimized(
                userId, 
                null,  // No code filter
                null   // No description filter
            );
            
            // Update cache with fresh data
            const fullHistoryKey = `user_${userId}_full`;
            this.setCache(fullHistoryKey, data);
            
            console.log(`✅ Background refresh completed for user ${userId} (${data.length} products)`);
            
        } catch (error) {
            console.error('Error refreshing cache in background:', error);
        }
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

