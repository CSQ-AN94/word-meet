import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = process.argv.includes('--dist') ? path.join(project, 'dist') : project;
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let name = decodeURIComponent(url.pathname);
    if (name === '/') name = '/index.html';
    if (root === project && name === '/vendor/peerjs.min.js') name = '/node_modules/peerjs/dist/peerjs.min.js';
    if (root === project && name === '/favicon.svg') name = '/public/favicon.svg';
    const target = path.resolve(root, '.' + name);
    const relative = path.relative(root, target);
    const allowed = root !== project || name === '/index.html' || name === '/public/favicon.svg' ||
      name.startsWith('/src/') || name === '/node_modules/peerjs/dist/peerjs.min.js';
    if (relative.startsWith('..') || path.isAbsolute(relative) || !allowed) {
      response.writeHead(404).end('Not found');
      return;
    }
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
