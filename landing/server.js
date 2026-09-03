const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = __dirname;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon',
  // Without an explicit font MIME type browsers refuse to apply @font-face
  // sources served as application/octet-stream.
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webp': 'image/webp', '.avif': 'image/avif', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

// Immutable for content-addressed assets, short for documents.
function cacheFor(ext) {
  if (ext === '.woff2' || ext === '.woff' || ext === '.png' || ext === '.jpg' ||
      ext === '.webp' || ext === '.avif' || ext === '.svg' || ext === '.css' ||
      ext === '.ico') {
    return 'public, max-age=31536000, immutable';
  }
  if (ext === '.js') return 'public, max-age=604800, must-revalidate';
  if (ext === '.xml' || ext === '.txt') return 'public, max-age=3600, must-revalidate';
  return 'public, max-age=0, must-revalidate';
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.txt', '.svg', '.webmanifest']);
// woff2 is already compressed; gzipping it wastes CPU and can corrupt delivery.

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.join(DIR, url.pathname === '/' ? 'index.html' : url.pathname);

  // Never let a request escape the landing directory.
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Cache-Control': cacheFor(ext),
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding'
  };

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (COMPRESSIBLE.has(ext) && acceptsGzip) {
    const body = zlib.gzipSync(fs.readFileSync(filePath));
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
    return;
  }

  headers['Content-Length'] = fs.statSync(filePath).size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(3000, () => {
  console.log('Landing page: http://localhost:3000');
});

