import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'src', 'public']) {
  await cp(path.join(root, file), file === 'public' ? output : path.join(output, file), { recursive: true });
}
const files = (await readdir(path.join(root, 'src'))).filter((name) => /\.(js|css)$/.test(name)).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(path.join(root, 'src', file)));
const version = hash.digest('hex').slice(0, 12);
// Invalidate the complete module graph, so an old networking module cannot survive an update.
for (const file of files.filter((name) => name.endsWith('.js'))) {
  const target = path.join(output, 'src', file);
  const code = (await readFile(target, 'utf8')).replace(/(\bfrom\s*['"])(\.\/[^'"]+\.js)(?:\?[^'"]*)?(['"])/g, `$1$2?v=${version}$3`);
  await writeFile(target, code);
}
const html = (await readFile(path.join(output, 'index.html'), 'utf8')).replace(/(["'])\.\/src\/([^"']+\.(?:css|js))(?:\?[^"']*)?\1/g, `$1./src/$2?v=${version}$1`);
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Built dist/ — ready for GitHub Pages.');
