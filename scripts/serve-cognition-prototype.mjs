import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const prototypeRoot = join(workspaceRoot, 'src', 'sidepanel', 'prototypes', 'cognition-loop');
const publicRoot = join(workspaceRoot, 'public');
const port = Number(process.env.COGNITION_PROTOTYPE_PORT ?? 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function resolveRequestPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return join(prototypeRoot, 'index.html');
  }
  if (pathname === '/prototype.css' || pathname === '/prototype.js') {
    return join(prototypeRoot, pathname.slice(1));
  }
  if (pathname === '/icon.svg') {
    return join(publicRoot, 'icon.svg');
  }
  if (pathname.startsWith('/icons/')) {
    const relativePath = normalize(pathname.slice(1));
    const resolvedPath = join(publicRoot, relativePath);
    return resolvedPath.startsWith(publicRoot) ? resolvedPath : null;
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const filePath = resolveRequestPath(decodeURIComponent(requestUrl.pathname));
    if (!filePath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Prototype server failed');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Cognition loop prototype: http://127.0.0.1:${port}/?variant=A\n`);
});
