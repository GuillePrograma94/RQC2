/**
 * Script para FORZAR re-sincronización completa
 * Ejecutar en la consola del navegador: F12 → Console → Copiar y pegar
 */

async function forcedResync() {
    console.log('🔄 FORZANDO RE-SINCRONIZACIÓN COMPLETA...\n');
    
    try {
        // 1. Eliminar hash local para forzar actualización
        console.log('🗑️ Eliminando hash local...');
        localStorage.removeItem('catalog_version_hash');
        localStorage.removeItem('catalog_last_updated');
        console.log('  ✅ Hash eliminado');
        
        // 2. Limpiar IndexedDB
        console.log('\n🗑️ Limpiando IndexedDB...');
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('ScanAsYouShop', 2);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        
        // Limpiar productos
        await new Promise((resolve) => {
            const tx = db.transaction(['products'], 'readwrite');
            const store = tx.objectStore('products');
            store.clear();
            tx.oncomplete = () => {
                console.log('  ✅ Productos eliminados');
                resolve();
            };
        });
        
        // Limpiar códigos secundarios
        await new Promise((resolve) => {
            const tx = db.transaction(['secondary_codes'], 'readwrite');
            const store = tx.objectStore('secondary_codes');
            store.clear();
            tx.oncomplete = () => {
                console.log('  ✅ Códigos secundarios eliminados');
                resolve();
            };
        });
        
        db.close();
        
        // 3. Descargar datos nuevamente
        console.log('\n📥 Descargando datos desde Supabase...');
        
        const onProgress = (progress) => {
            if (progress.table && progress.total) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                console.log(`  📊 ${progress.table}: ${progress.loaded}/${progress.total} (${percent}%)`);
            }
        };
        
        const { productos, codigosSecundarios } = await window.supabaseClient.downloadProducts(onProgress);
        
        console.log(`\n✅ Descarga completada:`);
        console.log(`  Productos: ${productos.length}`);
        console.log(`  Códigos secundarios: ${codigosSecundarios.length}`);
        
        // 4. Guardar en IndexedDB
        console.log('\n💾 Guardando en IndexedDB...');
        await window.cartManager.saveProductsToStorage(productos);
        await window.cartManager.saveSecondaryCodesToStorage(codigosSecundarios);
        
        // 5. Actualizar hash
        const versionCheck = await window.supabaseClient.verificarActualizacionNecesaria();
        if (versionCheck.versionRemota) {
            await window.supabaseClient.actualizarVersionLocal(versionCheck.versionRemota);
        }
        
        console.log('\n✅ RE-SINCRONIZACIÓN COMPLETADA');
        console.log('🔍 Ejecuta ahora: debugIndexedDB() para verificar');
        
    } catch (error) {
        console.error('❌ Error en re-sincronización:', error);
    }
}

// Ejecutar
forcedResync().catch(err => console.error('Error:', err));

