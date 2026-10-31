import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('changing networking code invalidates the entrypoint, stylesheet and module imports together', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'word-meet-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'index.html': '<link rel="stylesheet" href="./src/style.css"><script type="module" src="./src/main.js"></script>',
    'src/main.js': "import { value } from './room.js';\nconsole.log(value);",
    'src/room.js': 'export const value = 1;',
    'src/style.css': 'body{color:black}',
    'public/favicon.svg': '<svg/>',
    'node_modules/peerjs/dist/peerjs.min.js': '/* old build fixture */',
    'node_modules/peerjs/LICENSE': 'test fixture',
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  await mkdir(path.join(root, 'scripts'));
  await cp(new URL('../scripts/build.mjs', import.meta.url), path.join(root, 'scripts/build.mjs'));
  function build() { execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' }); }
  build();
  const before = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  const moduleBefore = await readFile(path.join(root, 'dist/src/main.js'), 'utf8');
  await writeFile(path.join(root, 'src/room.js'), 'export const value = 2;');
  build();
  const after = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  const moduleAfter = await readFile(path.join(root, 'dist/src/main.js'), 'utf8');
  assert.notEqual(before, after, 'a cached old entrypoint must not survive a transport update');
  assert.notEqual(moduleBefore, moduleAfter, 'the new entrypoint must request the new room module');
  const cssVersion = /style\.css\?v=([^"']+)/.exec(after)?.[1];
  const scriptVersion = /main\.js\?v=([^"']+)/.exec(after)?.[1];
  const importVersion = /room\.js\?v=([^"']+)/.exec(moduleAfter)?.[1];
  assert.ok(cssVersion);
  assert.equal(scriptVersion, cssVersion);
  assert.equal(importVersion, cssVersion);
});
