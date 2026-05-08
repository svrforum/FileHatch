const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:8080';
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://onlyoffice';
const ONLYOFFICE_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL || '';
const EXTERNAL_URL = process.env.EXTERNAL_URL || '';

// Shared HTTP agent with keep-alive for connection reuse to API backend
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 100, keepAliveMsecs: 30000 });

console.log('Starting server...');
console.log('API_URL:', API_URL);
console.log('ONLYOFFICE_URL:', ONLYOFFICE_URL);
console.log('ONLYOFFICE_PUBLIC_URL:', ONLYOFFICE_PUBLIC_URL || '(not set, will use default)');
console.log('EXTERNAL_URL:', EXTERNAL_URL || '(not set, will use request host)');

// Helper function to get base URL for Location header rewriting
// Priority: EXTERNAL_URL > X-Forwarded headers > request host
function getBaseUrl(req) {
  // 1. Use EXTERNAL_URL if set (highest priority for reverse proxy setups)
  if (EXTERNAL_URL) {
    return EXTERNAL_URL.replace(/\/$/, ''); // Remove trailing slash
  }

  // 2. Build from X-Forwarded headers or request
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : (req.secure ? 'https' : 'http');

  return `${proto}://${host}`;
}

// Helper function to detect protocol from request
function getRequestProtocol(req) {
  // Use EXTERNAL_URL if set
  if (EXTERNAL_URL) {
    try {
      const url = new URL(EXTERNAL_URL);
      return url.protocol.replace(':', '');
    } catch (e) {
      // Invalid EXTERNAL_URL, fall through
    }
  }
  // Check X-Forwarded-Proto header from reverse proxy first
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim();
  }
  // Fallback to connection protocol
  return req.secure ? 'https' : 'http';
}

// Tus upload proxy - needs special handling for Location header
const tusProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  selfHandleResponse: true,
  agent: keepAliveAgent,
  pathRewrite: (path, req) => {
    // Keep the full path including /api/upload
    return '/api/upload' + path;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      const host = req.headers.host || 'localhost:3000';
      const proto = getRequestProtocol(req);
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', proto);
      console.log(`[TusProxy] ${req.method} ${req.originalUrl} -> ${proxyReq.path} (proto: ${proto})`);
    },
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const location = proxyRes.headers['location'];
      if (location) {
        const baseUrl = getBaseUrl(req);
        let fixedLocation = location.replace(/https?:\/\/[^\/]+/, baseUrl);
        if (!fixedLocation.includes('/api/upload/')) {
          fixedLocation = fixedLocation.replace(/^(https?:\/\/[^\/]+)\//, '$1/api/upload/');
        }
        res.setHeader('location', fixedLocation);
        console.log(`[TusProxy] Fixed Location: ${location} -> ${fixedLocation}`);
      }
      return responseBuffer;
    }),
    error: (err, req, res) => {
      console.error('[TusProxy] Error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Proxy error', message: err.message });
      }
    }
  }
});

// WebSocket proxy for real-time file updates
const wsProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  ws: true,
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[WSProxy] ${req.method} ${req.originalUrl}`);
    },
    proxyReqWs: (proxyReq, req, socket, options, head) => {
      console.log('[WSProxy] WebSocket upgrade request');
    },
    error: (err, req, res) => {
      console.error('[WSProxy] Error:', err.message);
    }
  }
});

// General API proxy
const apiProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  agent: keepAliveAgent,
  on: {
    proxyReq: (proxyReq, req, res) => {
      const host = req.headers.host || 'localhost:3000';
      const proto = getRequestProtocol(req);
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', proto);
      console.log(`[Proxy] ${req.method} ${req.originalUrl}`);
    },
    error: (err, req, res) => {
      console.error('[Proxy] Error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Proxy error', message: err.message });
      }
    }
  }
});

// WebDAV proxy - handles all WebDAV methods
// Note: Express strips the mount path, so we need to add it back
const webdavProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  agent: keepAliveAgent,
  proxyTimeout: 600000,
  timeout: 600000,
  pathRewrite: (path, req) => {
    // Ensure path always starts with /webdav/
    let targetPath = req.originalUrl;
    if (targetPath === '/webdav') {
      targetPath = '/webdav/';
    }
    return targetPath;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      const host = req.headers.host || 'localhost:3000';
      const proto = getRequestProtocol(req);
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', proto);
      console.log(`[WebDAV] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    error: (err, req, res) => {
      console.error('[WebDAV] Error:', err.message);
      if (!res.headersSent) {
        res.status(500).send('WebDAV proxy error');
      }
    }
  }
});

// Helper: get the browser-accessible host for OnlyOffice URL generation
// OnlyOffice uses the Host header to generate absolute URLs (e.g., Editor.bin cache URLs)
// We must send the browser's host, not the Docker internal hostname
function getOnlyOfficeHost(req) {
  if (EXTERNAL_URL) {
    try { return new URL(EXTERNAL_URL).host; } catch (e) { /* fall through */ }
  }
  return req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
}

// OnlyOffice proxy (optional service) - with WebSocket support
// IMPORTANT: changeOrigin must be false so the Host header reflects the browser's host.
// Otherwise OnlyOffice generates absolute URLs with the Docker internal hostname (e.g., http://onlyoffice/cache/...)
// which the browser cannot resolve (ERR_NAME_NOT_RESOLVED).
const onlyofficeProxy = createProxyMiddleware({
  target: ONLYOFFICE_URL,
  changeOrigin: false,
  ws: true,
  pathRewrite: {
    '^/onlyoffice': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Set Host to browser-accessible host so OnlyOffice generates correct URLs
      const host = getOnlyOfficeHost(req);
      const proto = getRequestProtocol(req);
      proxyReq.setHeader('Host', host);
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', proto);
      console.log(`[OnlyOffice] ${req.method} ${req.originalUrl} (Host: ${host})`);
    },
    proxyReqWs: (proxyReq, req, socket, options, head) => {
      const host = getOnlyOfficeHost(req);
      proxyReq.setHeader('Host', host);
      console.log(`[OnlyOffice] WebSocket upgrade request (Host: ${host})`);
    },
    error: (err, req, res) => {
      console.error('[OnlyOffice] Error:', err.message);
      if (!res.headersSent && res.status) {
        res.status(503).json({ error: 'OnlyOffice not available', message: err.message });
      }
    }
  }
});

// OnlyOffice cache proxy - handles server-generated absolute URLs for cached document content
// When OnlyOffice processes a document, it generates absolute URLs like http://host/cache/files/...
// for the browser to download the rendered content (Editor.bin). These requests need to be
// proxied back to the OnlyOffice server.
// Note: app.use('/cache', ...) strips the mount prefix, so we need pathRewrite to restore it
const onlyofficeCacheProxy = createProxyMiddleware({
  target: ONLYOFFICE_URL,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // Express strips the mount prefix '/cache', so we need to add it back
    return '/cache' + path;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[OnlyOffice Cache] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    error: (err, req, res) => {
      console.error('[OnlyOffice Cache] Error:', err.message);
      if (!res.headersSent && res.status) {
        res.status(503).json({ error: 'OnlyOffice not available', message: err.message });
      }
    }
  }
});

// OnlyOffice status check endpoint
app.get('/api/onlyoffice/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${ONLYOFFICE_URL}/healthcheck`, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      res.json({
        available: true,
        publicUrl: ONLYOFFICE_PUBLIC_URL || null
      });
    } else {
      res.json({ available: false, publicUrl: null });
    }
  } catch (err) {
    res.json({ available: false, publicUrl: null });
  }
});

// Route OnlyOffice requests
app.use('/onlyoffice', onlyofficeProxy);

// Route OnlyOffice cache requests (Editor.bin and other cached document content)
// These are absolute URLs generated by OnlyOffice server using the browser's host
app.use('/cache', onlyofficeCacheProxy);

// Route /api/upload to Tus proxy (needs Location header fix)
app.use('/api/upload', tusProxy);

// Route WebSocket connections to WS proxy
app.use('/api/ws', wsProxy);

// Route WebDAV requests - use all() for exact path matching
app.all('/webdav', webdavProxy);
app.use('/webdav/', webdavProxy);

// Route Swagger documentation
const swaggerProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    return '/swagger' + path;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[Swagger] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    error: (err, req, res) => {
      console.error('[Swagger] Error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Swagger proxy error', message: err.message });
      }
    }
  }
});
app.use('/swagger', swaggerProxy);

// Route other /api and /health paths to general proxy
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return apiProxy(req, res, next);
  }
  next();
});

// Serve self-hosted rhwp-studio assets (GitHub Pages mirror — same-origin to avoid
// Chrome Private Network Access blocking and WASM init race in iframe embed)
const fs = require('fs');
const rhwpStudioDir = path.join(__dirname, 'rhwp-studio');
if (fs.existsSync(rhwpStudioDir)) {
  app.use('/rhwp', express.static(rhwpStudioDir, {
    maxAge: '7d',
    etag: true,
    fallthrough: false,
  }));
  // Catch fallthrough errors from express.static (e.g., missing wasm) and return
  // a clean 404 instead of letting them propagate to the SPA index.html catch-all.
  // Without this, browsers receive HTML where they expect WASM/JS and produce
  // confusing "expected magic word" / "MIME type" errors.
  app.use('/rhwp', (err, req, res, next) => {
    if (err && err.status === 404) {
      res.status(404).type('text/plain').send('rhwp-studio asset not found');
      return;
    }
    next(err);
  });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'dist'), {
  maxAge: '1d',
  etag: true,
}));

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/api/ws')) {
    console.log('[WSProxy] Handling WebSocket upgrade');
    wsProxy.upgrade(req, socket, head);
  } else if (req.url && req.url.startsWith('/onlyoffice')) {
    console.log('[OnlyOffice] Handling WebSocket upgrade');
    onlyofficeProxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API proxy: ${API_URL}`);
  console.log('WebSocket proxy enabled');
  console.log('WebDAV available at /webdav');
});
