const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  // 1. Copy src/renderer to dist/desktop-app/src/renderer
  const srcRenderer = path.join(__dirname, '../src/renderer');
  const destRenderer = path.join(__dirname, '../dist/desktop-app/src/renderer');
  if (fs.existsSync(srcRenderer)) {
    copyDirSync(srcRenderer, destRenderer);
    console.log('[BUILD] Renderer assets copied successfully.');
  }

  // 2. Ensure assets/ folder in dist exists and copy icon
  const destAssets = path.join(__dirname, '../dist/desktop-app/assets');
  fs.mkdirSync(destAssets, { recursive: true });
  const iconSrc = path.join(__dirname, '../assets/icon.png');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(destAssets, 'icon.png'));
    fs.copyFileSync(iconSrc, path.join(destRenderer, 'icon.png'));
    console.log('[BUILD] Icon assets copied successfully.');
  }

  // 3. Clean assets/pwa and copy mobile-pwa/dist
  const destPwa = path.join(__dirname, '../assets/pwa');
  if (fs.existsSync(destPwa)) {
    fs.rmSync(destPwa, { recursive: true, force: true });
  }
  const srcPwa = path.join(__dirname, '../../mobile-pwa/dist');
  if (fs.existsSync(srcPwa)) {
    copyDirSync(srcPwa, destPwa);
    console.log('[BUILD] PWA assets copied successfully.');
  } else {
    console.warn('[BUILD] WARNING: PWA dist folder not found at:', srcPwa);
  }
} catch (err) {
  console.error('[BUILD] Error preparing build assets:', err.message);
  process.exit(1);
}
