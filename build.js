/**
 * Build script para Vercel.
 * Reemplaza __SW_VERSION__ en sw.js con el SHA del commit de Git (o un timestamp
 * si no estamos en Vercel), garantizando un CACHE_NAME unico por deployment.
 *
 * Vercel expone automaticamente estas variables de entorno:
 *   VERCEL_GIT_COMMIT_SHA  -> hash completo del commit (40 chars)
 *   VERCEL_DEPLOYMENT_ID   -> ID unico del deployment
 */

const fs = require('fs');
const path = require('path');

const SW_FILE = path.join(__dirname, 'sw.js');
const PLACEHOLDER = '__SW_VERSION__';

// Prioridad: SHA del commit (primeros 8 chars) > deployment ID > timestamp local
const rawVersion =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    Date.now().toString(36);

const version = rawVersion.substring(0, 8);

let content = fs.readFileSync(SW_FILE, 'utf8');

if (!content.includes(PLACEHOLDER)) {
    console.warn('build.js: No se encontro el placeholder ' + PLACEHOLDER + ' en sw.js. Verifica que sw.js use CACHE_NAME con ese placeholder.');
    process.exit(0);
}

content = content.replace(new RegExp(PLACEHOLDER, 'g'), version);
fs.writeFileSync(SW_FILE, content, 'utf8');

console.log('build.js: sw.js actualizado con version = ' + version);
