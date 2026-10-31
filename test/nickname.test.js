import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName } from '../src/room.js';

test('nickname validation rejects blank, multiline and overlong names', () => {
  assert.equal(cleanName(' 小橘子 '), '小橘子');
  for (const invalid of ['', ' ', 'a\nb', '词'.repeat(13), {}]) assert.throws(() => cleanName(invalid));
});
