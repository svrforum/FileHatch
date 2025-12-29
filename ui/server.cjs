const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:8080';
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://onlyoffice';
const ONLYOFFICE_PUBLIC_URL = process.env.ONLYOFFICE_PUBLIC_URL || '';

console.log('Starting server...');
console.log('API_URL:', API_URL);
console.log('ONLYOFFICE_URL:', ONLYOFFICE_URL);
console.log('ONLYOFFICE_PUBLIC_URL:', ONLYOFFICE_PUBLIC_URL || '(not set, will use default)');

// Tus upload proxy - needs special handling for Location header
const tusProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  selfHandleResponse: true,
  pathRewrite: (path, req) => {
    // Keep the full path including /api/upload
    return '/api/upload' + path;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      const host = req.headers.host || 'localhost:3000';
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', 'http');
      console.log(`[TusProxy] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const location = proxyRes.headers['location'];
      if (location) {
        const host = req.headers.host || 'localhost:3000';
        let fixedLocation = location.replace(/http:\/\/[^\/]+/, `http://${host}`);
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
  on: {
    proxyReq: (proxyReq, req, res) => {
      const host = req.headers.host || 'localhost:3000';
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', 'http');
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
      proxyReq.setHeader('X-Forwarded-Host', host);
      proxyReq.setHeader('X-Forwarded-Proto', 'http');
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

// OnlyOffice proxy (optional service) - with WebSocket support
const onlyofficeProxy = createProxyMiddleware({
  target: ONLYOFFICE_URL,
  changeOrigin: true,
  ws: true,
  pathRewrite: {
    '^/onlyoffice': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      console.log(`[OnlyOffice] ${req.method} ${req.originalUrl}`);
    },
    proxyReqWs: (proxyReq, req, socket, options, head) => {
      console.log('[OnlyOffice] WebSocket upgrade request');
    },
    error: (err, req, res) => {
      console.error('[OnlyOffice] Error:', err.message);
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

// Route /api/upload to Tus proxy (needs Location header fix)
app.use('/api/upload', tusProxy);

// Route WebSocket connections to WS proxy
app.use('/api/ws', wsProxy);

// Route WebDAV requests - use all() for exact path matching
app.all('/webdav', webdavProxy);
app.use('/webdav/', webdavProxy);

// Route other /api and /health paths to general proxy
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return apiProxy(req, res, next);
  }
  next();
});

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
