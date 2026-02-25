/**
 * Build script para Vercel.
 * 1. Reemplaza __SW_VERSION__ en sw.js con el SHA del commit de Git.
 * 2. Genera la carpeta public/ con solo los archivos estaticos de la PWA.
 *    Asi api/ queda en la raiz y Vercel ejecuta las serverless en lugar de servir su codigo como estatico.
 *
 * Vercel expone automaticamente:
 *   VERCEL_GIT_COMMIT_SHA, VERCEL_DEPLOYMENT_ID
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SW_FILE = path.join(ROOT, 'sw.js');
const PLACEHOLDER = '__SW_VERSION__';
const PUBLIC_DIR = path.join(ROOT, 'public');

// --- 1. Inyectar version en sw.js ---
const rawVersion =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    Date.now().toString(36);
const version = rawVersion.substring(0, 8);

let content = fs.readFileSync(SW_FILE, 'utf8');
if (!content.includes(PLACEHOLDER)) {
    console.warn('build.js: No se encontro ' + PLACEHOLDER + ' en sw.js.');
    process.exit(0);
}
content = content.replace(new RegExp(PLACEHOLDER, 'g'), version);
fs.writeFileSync(SW_FILE, content, 'utf8');
console.log('build.js: sw.js actualizado con version = ' + version);

// --- 2. Crear public/ y copiar solo estaticos (api/ se queda en raiz) ---
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

const staticFiles = [
    'index.html',
    'sw.js',
    'config.js',
    'styles.css',
    'manifest.json'
];

staticFiles.forEach(function (name) {
    const src = path.join(ROOT, name);
    const dest = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('build.js: copiado ' + name);
    }
});

// Iconos PWA (opcionales)
['icon-192.png', 'icon-512.png'].forEach(function (name) {
    const src = path.join(ROOT, name);
    const dest = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('build.js: copiado ' + name);
    }
});

// Carpeta js/
const jsSrc = path.join(ROOT, 'js');
const jsDest = path.join(PUBLIC_DIR, 'js');
if (fs.existsSync(jsSrc)) {
    fs.mkdirSync(jsDest, { recursive: true });
    const entries = fs.readdirSync(jsSrc, { withFileTypes: true });
    entries.forEach(function (e) {
        const s = path.join(jsSrc, e.name);
        const d = path.join(jsDest, e.name);
        if (e.isFile()) {
            fs.copyFileSync(s, d);
        } else if (e.isDirectory()) {
            fs.cpSync(s, d, { recursive: true });
        }
    });
    console.log('build.js: copiado js/');
}

console.log('build.js: public/ listo. api/ permanece en raiz para serverless.');
