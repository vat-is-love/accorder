import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {preparePages} from '../scripts/prepare-pages.mjs';

test('publication includes only site files and resolves the entire versioned module graph', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'accorder-pages-'));
  try {
    const source = path.join(directory, 'dist'), output = path.join(directory, 'output');
    await cp(new URL('../dist/', import.meta.url), source, {recursive: true});
    await writeFile(path.join(source, 'private-song.json'), '{"title":"Не публиковать"}');
    const original = await readFile(path.join(source, 'app.js'), 'utf8');
    await preparePages(source, output);
    const names = await readdir(output);
    assert.equal(names.length, 8);
    assert.ok(names.includes('index.html'));
    for (const name of names) {
      const content = await readFile(path.join(output, name), 'utf8');
      for (const match of content.matchAll(/(?:from\s+|(?:href|src)=)["']\.\/([^"']+\.(?:js|css))["']/g)) {
        assert.ok(names.includes(match[1]), `${name}: missing ${match[1]}`);
        assert.match(match[1], /\.[a-f0-9]{16}\.(js|css)$/);
      }
    }
    assert.equal(await readFile(path.join(source, 'app.js'), 'utf8'), original);
    const again = path.join(directory, 'again');
    await preparePages(source, again);
    assert.deepEqual(await readdir(again), names);
    // A dependency-only edit must also give the entry module and CSS fresh URLs.
    await writeFile(path.join(source, 'core.js'), (await readFile(path.join(source, 'core.js'), 'utf8')) + '\n// changed\n');
    const changed = path.join(directory, 'changed');
    await preparePages(source, changed);
    assert.deepEqual((await readdir(changed)).filter(name => names.includes(name)), ['index.html']);
    await assert.rejects(preparePages(source, output), /пустой/);
    await assert.rejects(preparePages(source, source), /отдельную/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
