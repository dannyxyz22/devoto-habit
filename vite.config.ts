import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use root base for native builds (CAP_NATIVE=1), otherwise GitHub Pages base
  base: process.env.CAP_NATIVE ? "/" : "/",//"/devoto-habit/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    // Lightweight dev proxy to fetch cross-origin EPUBs (e.g., Gutenberg) and serve them locally
    {
      name: 'epub-proxy',
      apply: 'serve',
      configureServer(server) {
        const handler = async (req: any, res: any) => {
          try {
            const urlObj = new URL(req.url, 'http://localhost');
            const target = urlObj.searchParams.get('url');
            if (!target) {
              res.statusCode = 400;
              res.end('Missing url');
              return;
            }
            const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!upstream.ok || !upstream.body) {
              res.statusCode = upstream.status || 502;
              res.end('Upstream error');
              return;
            }
            const ct = upstream.headers.get('content-type') || 'application/epub+zip';
            res.setHeader('Content-Type', ct);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            // Simple buffer piping for compatibility
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.end(buf);
          } catch (err) {
            res.statusCode = 500;
            res.end('Proxy failure');
          }
        };
        const base = process.env.CAP_NATIVE ? '/' : '/devoto-habit/';
        server.middlewares.use('/proxy', handler);
        server.middlewares.use(base + 'proxy', handler);
      }
    } as Plugin,
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
