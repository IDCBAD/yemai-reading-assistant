import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const prototypeRoot = resolve(workspaceRoot, 'src/sidepanel/prototypes/wordbook');
const publicRoot = resolve(workspaceRoot, 'public');
const port = Number(process.env.WORDBOOK_PROTOTYPE_PORT ?? 4186);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    let path;
    if (['/', '/index.html', '/prototype.css', '/prototype.js'].includes(pathname)) {
      path = resolve(prototypeRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    } else if (pathname === '/icon.svg' || pathname.startsWith('/icons/')) {
      path = resolve(publicRoot, pathname.slice(1));
      if (!path.startsWith(publicRoot + sep)) path = undefined;
    }
    if (!path) { response.writeHead(404).end('Not found'); return; }
    const content = await readFile(path);
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Wordbook prototype: http://127.0.0.1:${port}/?variant=A\n`);
});
