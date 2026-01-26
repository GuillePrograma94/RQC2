"""
Script para verificar si la función RPC upsert_productos_masivo_con_fecha
está disponible y funcionando correctamente en Supabase.

Ejecuta este script después de subir datos para verificar que todo esté bien.
"""

import os
import sys
from supabase import create_client, Client

# Configuración de Supabase (ajusta según tu proyecto)
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')

def verificar_funcion_rpc():
    """Verifica si la función RPC existe y funciona correctamente"""
    try:
        # Crear cliente de Supabase
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        print("=" * 60)
        print("VERIFICACIÓN DE FUNCIÓN RPC")
        print("=" * 60)
        print()
        
        # 1. Verificar que la función existe
        print("1. Verificando si la función RPC existe...")
        try:
            # Intentar llamar a la función con datos de prueba
            test_data = [{
                'codigo': 'TEST001',
                'descripcion': 'Producto de prueba',
                'pvp': 10.50
            }]
            
            result = supabase.rpc(
                'upsert_productos_masivo_con_fecha',
                {'productos_json': test_data}
            ).execute()
            
            print("   ✅ Función RPC existe y funciona correctamente")
            print(f"   Resultado: {result.data}")
            
        except Exception as e:
            error_msg = str(e)
            if 'function' in error_msg.lower() and 'does not exist' in error_msg.lower():
                print("   ❌ ERROR: La función RPC NO existe en Supabase")
                print("   💡 SOLUCIÓN:")
                print("      1. Ve a Supabase → SQL Editor")
                print("      2. Ejecuta el script: migration_sincronizacion_incremental.sql")
                print("      3. Verifica que no haya errores")
                return False
            else:
                print(f"   ⚠️ Error al llamar función: {e}")
                return False
        
        print()
        
        # 2. Verificar que fecha_actualizacion se actualiza
        print("2. Verificando que fecha_actualizacion se actualiza...")
        try:
            # Obtener un producto de prueba
            producto_test = supabase.table('productos').select('*').eq('codigo', 'TEST001').execute()
            
            if producto_test.data:
                fecha_original = producto_test.data[0].get('fecha_actualizacion')
                print(f"   Fecha original: {fecha_original}")
                
                # Actualizar el producto (mismo dato)
                test_data = [{
                    'codigo': 'TEST001',
                    'descripcion': 'Producto de prueba (actualizado)',
                    'pvp': 10.50
                }]
                
                result = supabase.rpc(
                    'upsert_productos_masivo_con_fecha',
                    {'productos_json': test_data}
                ).execute()
                
                # Verificar que fecha_actualizacion cambió
                producto_actualizado = supabase.table('productos').select('*').eq('codigo', 'TEST001').execute()
                fecha_nueva = producto_actualizado.data[0].get('fecha_actualizacion')
                print(f"   Fecha nueva: {fecha_nueva}")
                
                if fecha_nueva != fecha_original:
                    print("   ✅ fecha_actualizacion se actualiza correctamente")
                else:
                    print("   ⚠️ ADVERTENCIA: fecha_actualizacion NO cambió")
                    print("   Esto causará que total_cambios = 0 en sincronización incremental")
                    
        except Exception as e:
            print(f"   ⚠️ Error al verificar fecha_actualizacion: {e}")
        
        print()
        
        # 3. Verificar versión más reciente
        print("3. Verificando versión más reciente...")
        try:
            version = supabase.table('version_control').select('*').order('fecha_actualizacion', desc=True).limit(1).execute()
            
            if version.data:
                v = version.data[0]
                print(f"   Hash: {v.get('version_hash', 'N/A')[:16]}...")
                print(f"   Fecha: {v.get('fecha_actualizacion', 'N/A')}")
                print(f"   Descripción: {v.get('descripcion', 'N/A')}")
            else:
                print("   ⚠️ No hay versiones en version_control")
                
        except Exception as e:
            print(f"   ⚠️ Error al verificar versión: {e}")
        
        print()
        print("=" * 60)
        print("VERIFICACIÓN COMPLETADA")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"❌ Error general: {e}")
        return False

if __name__ == '__main__':
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ ERROR: Configura SUPABASE_URL y SUPABASE_KEY")
        print("   Ejemplo:")
        print("   export SUPABASE_URL='https://tu-proyecto.supabase.co'")
        print("   export SUPABASE_KEY='tu-api-key'")
        sys.exit(1)
    
    verificar_funcion_rpc()
