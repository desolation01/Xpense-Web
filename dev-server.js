const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load .env
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx > 0) {
        process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
  }
}
loadEnv();

const PORT = 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function buildCacheControl(filePath, reqUrl) {
  const ext = path.extname(filePath).toLowerCase();
  const parsed = url.parse(reqUrl, true);
  const hasVersionQuery = Object.prototype.hasOwnProperty.call(parsed.query || {}, 'v');
  const baseName = path.basename(filePath).toLowerCase();

  if (ext === '.html') return 'no-store, must-revalidate';
  if (baseName === 'sw.js') return 'no-store, must-revalidate';
  if (baseName === 'manifest.json') return 'no-cache, must-revalidate';
  if (hasVersionQuery) return 'public, max-age=31536000, immutable';
  if (ext === '.css' || ext === '.js') return 'no-cache, must-revalidate';
  return 'public, max-age=3600';
}

// Load API handler once
let apiHandler = null;
try {
  apiHandler = require('./api/api.js');
  console.log('API handler loaded');
} catch (err) {
  console.error('Failed to load API handler:', err.message);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // API Routes
  if (pathname.startsWith('/api/api') && apiHandler) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const vercelReq = {
          method: req.method,
          url: pathname + (parsed.search || ''),
          headers: req.headers,
          query: parsed.query,
          body: body ? (() => { try { return JSON.parse(body); } catch (e) { return {}; } })() : {},
          ip: req.socket?.remoteAddress,
          socket: req.socket,
        };

        const vercelRes = {
          statusCode: 200,
          _headers: {},
          setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
          writeHead(code, headers) {
            this.statusCode = code;
            Object.assign(this._headers, headers || {});
          },
          status(code) { this.statusCode = code; return this; },
          json(data) { this.end(JSON.stringify(data)); },
          end(data) {
            const headers = { ...this._headers };
            if (!headers['content-type']) headers['content-type'] = 'application/json';
            setSecurityHeaders(res);
            res.writeHead(this.statusCode, headers);
            if (typeof data === 'object') data = JSON.stringify(data);
            res.end(data || '');
          }
        };

        const handler = apiHandler.default || apiHandler;
        await handler(vercelReq, vercelRes);
      } catch (err) {
        console.error('API Error:', err.message);
        setSecurityHeaders(res);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // Static files with path traversal protection
  let normalizedPath = '';
  try {
    const decodedPath = decodeURIComponent(pathname);
    normalizedPath = path.normalize(decodedPath).replace(/^([/\\])+/, '');
  } catch {
    setSecurityHeaders(res);
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>400 Bad Request</h1>');
    return;
  }

  let filePath = path.join(__dirname, normalizedPath || 'index.html');
  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) filePath += '.html';
    else if (fs.existsSync(path.join(filePath, 'index.html'))) filePath = path.join(filePath, 'index.html');
  }

  const resolvedPath = path.resolve(filePath);
  const rootPath = path.resolve(__dirname);
  if (resolvedPath !== rootPath && !resolvedPath.startsWith(rootPath + path.sep)) {
    setSecurityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>');
    return;
  }

  if (!fs.existsSync(filePath)) {
    setSecurityHeaders(res);
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const cacheControl = buildCacheControl(filePath, req.url);
  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`\nServer running at http://localhost:${PORT}`);
  console.log(`   Login:      http://localhost:${PORT}/tracker-login.html`);
  console.log(`   Tracker:    http://localhost:${PORT}/expense-tracker.html`);
  console.log(`   Portfolio:  http://localhost:${PORT}/`);
  console.log('Press Ctrl+C to stop\n');
});
