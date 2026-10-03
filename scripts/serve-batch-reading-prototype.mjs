// Throwaway UI prototype. No extension storage, credentials or Agent requests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = resolve('output/batch-reading-prototype/index.html');
createServer(async (request, response) => {
  if (new URL(request.url, 'http://127.0.0.1').pathname !== '/') {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(await readFile(html));
  } catch {
    response.writeHead(500).end('Prototype HTML is missing.');
  }
}).listen(5194, '127.0.0.1', () => {
  console.log('Batch reading prototype: http://127.0.0.1:5194/');
});
