/**
 * Script de debug para verificar datos en Supabase
 * Ejecutar en la consola del navegador: F12 → Console → Copiar y pegar
 */

async function debugSupabase() {
    console.log('🔍 VERIFICANDO SUPABASE...\n');
    
    const supabase = window.supabaseClient;
    
    if (!supabase || !supabase.client) {
        console.error('❌ Cliente de Supabase no disponible');
        return;
    }
    
    console.log('✅ Cliente de Supabase disponible');
    
    // Verificar tabla codigos_secundarios
    console.log('\n📊 VERIFICANDO TABLA codigos_secundarios:');
    const { data: secundarios, error: errorSec, count } = await supabase.client
        .from('codigos_secundarios')
        .select('*', { count: 'exact' })
        .range(0, 4);
    
    if (errorSec) {
        console.error('❌ Error al consultar codigos_secundarios:', errorSec);
    } else {
        console.log(`  Total códigos secundarios en Supabase: ${count}`);
        console.log(`  Primeros 5 registros:`, secundarios);
    }
    
    // Buscar EAN específico
    console.log('\n🔍 BUSCANDO EAN: 8435200024488 en Supabase');
    const { data: eanData, error: eanError } = await supabase.client
        .from('codigos_secundarios')
        .select('*')
        .eq('codigo_secundario', '8435200024488')
        .single();
    
    if (eanError) {
        console.error('❌ Error al buscar EAN:', eanError);
    } else if (eanData) {
        console.log('  ✅ EAN ENCONTRADO en Supabase:', eanData);
    } else {
        console.log('  ❌ EAN NO ENCONTRADO en Supabase');
    }
    
    // Verificar producto principal
    console.log('\n🔍 VERIFICANDO PRODUCTO: 0131SP01CR en Supabase');
    const { data: producto, error: prodError } = await supabase.client
        .from('productos')
        .select('*')
        .eq('codigo', '0131SP01CR')
        .single();
    
    if (prodError) {
        console.error('❌ Error al buscar producto:', prodError);
    } else if (producto) {
        console.log('  ✅ PRODUCTO ENCONTRADO en Supabase:', producto);
    } else {
        console.log('  ❌ PRODUCTO NO ENCONTRADO en Supabase');
    }
    
    console.log('\n✅ Verificación completada');
}

// Ejecutar
debugSupabase().catch(err => console.error('Error:', err));

