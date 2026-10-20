// Vite builds only the renderer. base './' so the packaged app can load
// index.html from file://. A strict CSP is injected for production builds only,
// because the dev server needs inline scripts for React Fast Refresh.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const csp: Plugin = {
  name: 'monolith-csp',
  transformIndexHtml(html, ctx) {
    const policy = ctx.server
      ? ''
      : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'" />`;
    return html.replace('<!--CSP-->', policy);
  },
};

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome120' },
  server: { port: 5173, strictPort: true },
});
