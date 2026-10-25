import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  plugins: [{ name: 'reading-focus-preview', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.split('?')[0] === '/') request.url = '/scripts/reading-focus-preview/index.html';
      next();
    });
  } }],
  server: { host: '127.0.0.1', port: 4193, strictPort: true },
});
await server.listen();
console.log('Reading focus preview: http://127.0.0.1:4193/');
