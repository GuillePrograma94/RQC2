/**
 * Script de debug para verificar IndexedDB
 * Ejecutar en la consola del navegador: F12 → Console → Copiar y pegar
 */

async function debugIndexedDB() {
    console.log('🔍 VERIFICANDO INDEXEDDB...\n');
    
    // Abrir base de datos
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('ScanAsYouShop', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    
    console.log('✅ Base de datos abierta:', db.name, 'v' + db.version);
    console.log('📦 Object Stores disponibles:', Array.from(db.objectStoreNames));
    
    // Verificar productos
    console.log('\n📊 VERIFICANDO PRODUCTOS:');
    const productos = await new Promise((resolve) => {
        const tx = db.transaction(['products'], 'readonly');
        const store = tx.objectStore('products');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
    });
    console.log(`  Total productos: ${productos.length}`);
    if (productos.length > 0) {
        console.log(`  Primer producto:`, productos[0]);
        console.log(`  Último producto:`, productos[productos.length - 1]);
    }
    
    // Verificar códigos secundarios
    console.log('\n📊 VERIFICANDO CÓDIGOS SECUNDARIOS:');
    const secundarios = await new Promise((resolve) => {
        const tx = db.transaction(['secondary_codes'], 'readonly');
        const store = tx.objectStore('secondary_codes');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
    });
    console.log(`  Total códigos secundarios: ${secundarios.length}`);
    if (secundarios.length > 0) {
        console.log(`  Primeros 5 códigos secundarios:`, secundarios.slice(0, 5));
    }
    
    // Buscar el EAN específico usando el índice
    console.log('\n🔍 BUSCANDO EAN: 8435200024488');
    const eanBuscado = await new Promise((resolve) => {
        const tx = db.transaction(['secondary_codes'], 'readonly');
        const store = tx.objectStore('secondary_codes');
        const index = store.index('codigo_secundario');
        const req = index.get('8435200024488');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
    if (eanBuscado) {
        console.log('  ✅ EAN ENCONTRADO:', eanBuscado);
    } else {
        console.log('  ❌ EAN NO ENCONTRADO en IndexedDB');
        console.log('  🔍 Verificando si existe en los datos descargados...');
        const encontrado = secundarios.find(s => s.codigo_secundario === '8435200024488');
        if (encontrado) {
            console.log('  ⚠️ EXISTE en el array pero NO en el store:', encontrado);
        } else {
            console.log('  ❌ NO EXISTE en los datos descargados');
        }
    }
    
    // Verificar producto principal
    console.log('\n🔍 VERIFICANDO PRODUCTO: 0131SP01CR');
    const productoBuscado = await new Promise((resolve) => {
        const tx = db.transaction(['products'], 'readonly');
        const store = tx.objectStore('products');
        const req = store.get('0131SP01CR');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
    if (productoBuscado) {
        console.log('  ✅ PRODUCTO ENCONTRADO:', productoBuscado);
    } else {
        console.log('  ❌ PRODUCTO NO ENCONTRADO');
    }
    
    db.close();
    console.log('\n✅ Verificación completada');
}

// Ejecutar
debugIndexedDB().catch(err => console.error('Error:', err));

