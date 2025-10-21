# Quick Deployment Guide - Purchase History Optimization

## ⚡ Quick Start (5 Minutes)

### Step 1: Database (Phase 1)

```bash
# 1. Open Supabase Dashboard
https://supabase.com/dashboard/project/YOUR_PROJECT

# 2. Go to SQL Editor
# 3. Copy and paste contents of:
scan_client_mobile/migration_optimize_historial.sql

# 4. Click "Run"
# 5. Verify success message appears
```

**Expected Output:**
```
✅ Table historial_compras_usuario exists
✅ Optimization Complete!
```

---

### Step 2: Frontend (Phase 2)

```bash
# Files already modified - just deploy to Vercel:

git add scan_client_mobile/
git commit -m "Phase 1 & 2: Purchase history optimization with caching"
git push origin main

# Vercel will auto-deploy
```

**New/Modified Files:**
- ✅ `js/purchase-cache.js` (NEW)
- ✅ `migration_optimize_historial.sql` (NEW)
- ✅ `index.html` (added script tag)
- ✅ `js/supabase.js` (added optimized function)
- ✅ `js/app.js` (cache integration)
- ✅ `js/scanner.js` (cache invalidation)

---

### Step 3: Verify

```javascript
// 1. Open app in browser
// 2. Open Console (F12)
// 3. Login as user
// 4. Should see:
"🚀 Precargando historial de compras..."

// 5. Search with "Only purchased" filter twice
// First: "📥 Cache MISS..."
// Second: "✅ Cache HIT (100% hit rate)"

// 6. Check stats:
window.purchaseCache.getStats()
// Should show hits/misses and hit rate
```

---

## 📊 Expected Performance

| Metric | Before | After |
|--------|--------|-------|
| First search | 200-500ms | 50-100ms |
| Cached search | 200-500ms | <1ms |
| Server load | 100% | 5-10% |

---

## ❓ Issues?

### Cache not loading
```javascript
// Check if cache exists:
console.log(window.purchaseCache)
// Should show: PurchaseHistoryCache {...}

// If undefined, check browser console for errors
// Force refresh: Ctrl+Shift+R
```

### Database function not found
```sql
-- Check if function exists:
SELECT proname FROM pg_proc 
WHERE proname = 'buscar_productos_historial_usuario_optimizado';

-- Should return 1 row
-- If empty, re-run migration script
```

### Still slow queries
```sql
-- Check indexes:
SELECT indexname FROM pg_indexes 
WHERE tablename = 'historial_compras_usuario';

-- Should show at least 4 indexes including:
-- idx_historial_usuario_codigo_fecha
```

---

## 🎯 Success Criteria

✅ No errors in Supabase migration  
✅ Frontend deploys successfully  
✅ Console shows "Precargando historial..."  
✅ Second search shows "Cache HIT"  
✅ Cache hit rate >90% after 1 hour  
✅ Searches feel instant on second try  

---

## 📞 Support

See full documentation:
- `README_PURCHASE_HISTORY_OPTIMIZATION.md`

For issues, check:
1. Browser console (F12 → Console)
2. Supabase logs (Dashboard → Logs)
3. Network tab (F12 → Network)

