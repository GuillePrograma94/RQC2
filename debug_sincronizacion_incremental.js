/**
 * Script de diagnóstico para sincronización incremental
 * Ejecutar en la consola del navegador (F12 → Console)
 * 
 * Uso: Copiar y pegar todo este código en la consola
 */

async function diagnosticarSincronizacionIncremental() {
    console.log('🔍 DIAGNÓSTICO DE SINCRONIZACIÓN INCREMENTAL');
    console.log('='.repeat(60));
    
    // 1. Verificar versión local
    console.log('\n1️⃣ VERIFICANDO VERSIÓN LOCAL...');
    const versionLocalHash = localStorage.getItem('version_hash_local');
    if (versionLocalHash) {
        console.log(`✅ Versión local encontrada: ${versionLocalHash.substring(0, 16)}...`);
    } else {
        console.log('❌ NO hay versión local guardada');
        console.log('   → Esto es normal en la primera sincronización');
        console.log('   → Después de la primera sync, debería guardarse automáticamente');
        return;
    }
    
    // 2. Verificar cliente de Supabase
    console.log('\n2️⃣ VERIFICANDO CLIENTE DE SUPABASE...');
    if (!window.supabaseClient || !window.supabaseClient.client) {
        console.log('❌ Cliente de Supabase no disponible');
        console.log('   → Asegúrate de estar en la app y haber iniciado sesión');
        return;
    }
    console.log('✅ Cliente de Supabase disponible');
    
    // 3. Verificar función obtener_estadisticas_cambios
    console.log('\n3️⃣ VERIFICANDO FUNCIÓN obtener_estadisticas_cambios...');
    try {
        const { data, error } = await window.supabaseClient.client.rpc(
            'obtener_estadisticas_cambios',
            { p_version_hash_local: versionLocalHash }
        );
        
        if (error) {
            console.log('❌ ERROR al llamar función:');
            console.log('   Código:', error.code);
            console.log('   Mensaje:', error.message);
            console.log('   Detalles:', error.details);
            console.log('   Hint:', error.hint);
            console.log('\n💡 SOLUCIÓN:');
            console.log('   1. Ve a Supabase → SQL Editor');
            console.log('   2. Ejecuta el script: migration_sincronizacion_incremental.sql');
            console.log('   3. Verifica que no haya errores');
            return;
        }
        
        if (data && data.length > 0) {
            const stats = data[0];
            console.log('✅ Función existe y funciona correctamente');
            console.log('📊 Estadísticas obtenidas:');
            console.log('   - Productos modificados:', stats.productos_modificados);
            console.log('   - Productos nuevos:', stats.productos_nuevos);
            console.log('   - Códigos modificados:', stats.codigos_modificados);
            console.log('   - Códigos nuevos:', stats.codigos_nuevos);
            console.log('   - TOTAL CAMBIOS:', stats.total_cambios);
            
            if (stats.total_cambios === 0) {
                console.log('\n⚠️ ADVERTENCIA: Total cambios = 0');
                console.log('   Posibles causas:');
                console.log('   1. Los triggers no están actualizando fecha_actualizacion');
                console.log('   2. No se han hecho cambios desde la última sincronización');
                console.log('   3. La versión local no coincide con ninguna en version_control');
            } else {
                const th = window.supabaseClient && typeof window.supabaseClient.getCatalogSyncThresholds === 'function'
                    ? window.supabaseClient.getCatalogSyncThresholds()
                    : { productos: 25000, codigos_secundarios: 40000, claves_descuento: 1000 };
                const prodN = (stats.productos_modificados || 0) + (stats.productos_nuevos || 0);
                const codN = (stats.codigos_modificados || 0) + (stats.codigos_nuevos || 0);
                if (prodN > 0 && prodN < th.productos) {
                    console.log(`\nProductos: incremental (${prodN} cambios < umbral ${th.productos})`);
                } else if (prodN >= th.productos) {
                    console.log(`\nProductos: completa (${prodN} cambios >= umbral ${th.productos})`);
                }
                if (codN > 0 && codN < th.codigos_secundarios) {
                    console.log(`Codigos: incremental (${codN} cambios < umbral ${th.codigos_secundarios})`);
                } else if (codN >= th.codigos_secundarios) {
                    console.log(`Codigos: completa (${codN} cambios >= umbral ${th.codigos_secundarios})`);
                }
            }
        } else {
            console.log('⚠️ Función retornó datos vacíos o nulos');
        }
        
    } catch (err) {
        console.log('❌ EXCEPCIÓN al llamar función:', err);
        console.log('   Stack:', err.stack);
    }
    
    // 4. Verificar versión en version_control
    console.log('\n4️⃣ VERIFICANDO VERSIÓN EN version_control...');
    try {
        const { data: versionData, error: versionError } = await window.supabaseClient.client
            .from('version_control')
            .select('*')
            .eq('version_hash', versionLocalHash)
            .order('fecha_actualizacion', { ascending: false })
            .limit(1);
        
        if (versionError) {
            console.log('❌ Error al consultar version_control:', versionError);
        } else if (versionData && versionData.length > 0) {
            const version = versionData[0];
            console.log('✅ Versión encontrada en version_control:');
            console.log('   - Hash:', version.version_hash.substring(0, 16) + '...');
            console.log('   - Fecha:', version.fecha_actualizacion);
            console.log('   - Descripción:', version.descripcion);
        } else {
            console.log('⚠️ Versión local NO encontrada en version_control');
            console.log('   Esto puede pasar si:');
            console.log('   1. La versión fue eliminada manualmente');
            console.log('   2. El hash local está corrupto');
            console.log('   3. Es una versión muy antigua');
        }
    } catch (err) {
        console.log('❌ Error al verificar version_control:', err);
    }
    
    // 5. Verificar triggers
    console.log('\n5️⃣ VERIFICANDO TRIGGERS...');
    try {
        // Intentar actualizar un producto de prueba para ver si el trigger funciona
        // (solo lectura, no modificamos nada real)
        const { data: testProduct, error: testError } = await window.supabaseClient.client
            .from('productos')
            .select('codigo, fecha_creacion, fecha_actualizacion')
            .limit(1)
            .single();
        
        if (testError) {
            console.log('⚠️ No se pudo obtener producto de prueba:', testError);
        } else {
            console.log('✅ Producto de prueba obtenido:');
            console.log('   - Código:', testProduct.codigo);
            console.log('   - Fecha creación:', testProduct.fecha_creacion);
            console.log('   - Fecha actualización:', testProduct.fecha_actualizacion);
            
            if (!testProduct.fecha_creacion || !testProduct.fecha_actualizacion) {
                console.log('⚠️ ADVERTENCIA: Fechas faltantes en producto');
                console.log('   → Los triggers pueden no estar funcionando');
            }
        }
    } catch (err) {
        console.log('❌ Error al verificar triggers:', err);
    }
    
    // 6. Resumen y recomendaciones
    console.log('\n' + '='.repeat(60));
    console.log('📋 RESUMEN Y RECOMENDACIONES');
    console.log('='.repeat(60));
    console.log('\nSi la sincronización incremental no funciona:');
    console.log('1. Ejecuta el script SQL en Supabase (migration_sincronizacion_incremental.sql)');
    console.log('2. Verifica que las funciones existen:');
    console.log('   SELECT proname FROM pg_proc WHERE proname LIKE \'obtener_%modificados%\';');
    console.log('3. Verifica que los triggers existen:');
    console.log('   SELECT trigger_name FROM information_schema.triggers WHERE trigger_name LIKE \'%fecha%\';');
    console.log('4. Recarga la página y prueba de nuevo');
    console.log('\n✅ Diagnóstico completado');
}

// Ejecutar diagnóstico
diagnosticarSincronizacionIncremental().catch(err => {
    console.error('❌ Error en diagnóstico:', err);
});
