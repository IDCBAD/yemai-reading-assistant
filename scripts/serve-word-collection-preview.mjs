import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const server = await createServer({
  configFile: false,
  plugins: [react(), {
    name: 'word-collection-preview-route',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.split('?')[0] === '/') request.url = '/scripts/word-collection-preview/index.html';
        next();
      });
    },
  }],
  resolve: { alias: { 'wxt/browser': fileURLToPath(new URL('./word-collection-preview/browser.ts', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4187, strictPort: true },
});
await server.listen();
console.log('Word collection preview: http://127.0.0.1:4187/');
