import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'vendor'), { recursive: true });
for (const file of ['index.html', 'src', 'public']) {
  await cp(path.join(root, file), file === 'public' ? output : path.join(output, file), { recursive: true });
}
await cp(path.join(root, 'node_modules/peerjs/dist/peerjs.min.js'), path.join(output, 'vendor/peerjs.min.js'));
const notices = await readFile(path.join(root, 'node_modules/peerjs/LICENSE'), 'utf8');
await writeFile(path.join(output, 'vendor/PEERJS-LICENSE.txt'), notices);
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Built dist/ — ready for GitHub Pages.');
