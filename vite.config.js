import { defineConfig } from 'vite';
import http from 'node:http';
import https from 'node:https';

/**
 * Dev-only CORS proxy middleware.
 * Browser fetches /lw-proxy/<path> with X-LW-Target header → Vite server forwards to target (no CORS).
 */
const lwProxyPlugin = {
  name: 'lw-proxy',
  configureServer(server) {
    server.middlewares.use('/lw-proxy', (req, res) => {
      const target = req.headers['x-lw-target'];
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing X-LW-Target header' }));
        return;
      }

      let targetUrl;
      try {
        // req.url is the path AFTER /lw-proxy (Connect strips the mount point)
        targetUrl = new URL(req.url ?? '/', target);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid target URL' }));
        return;
      }

      const httpModule = targetUrl.protocol === 'https:' ? https : http;

      // Forward headers, stripping browser/CORS-related ones
      const fwdHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const kl = k.toLowerCase();
        if (kl === 'x-lw-target' || kl === 'host' || kl === 'origin' || kl === 'referer') continue;
        fwdHeaders[k] = v;
      }
      fwdHeaders['host'] = targetUrl.host;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + (targetUrl.search || ''),
        method: req.method,
        headers: fwdHeaders,
      };

      const proxyReq = httpModule.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res); // stream response directly (supports SSE)
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: err.message }));
      });

      req.pipe(proxyReq); // forward request body (needed for POST /v1/chat/completions)
    });
  },
};

export default defineConfig({
  plugins: [lwProxyPlugin],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('highlight.js')) return 'hljs';
          if (id.includes('marked')) return 'marked';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  },
});
