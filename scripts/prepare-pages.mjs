import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const assets = ['app.js', 'core.js', 'storage.js', 'archive.js', 'style.css'];

// Version the whole module graph together, including imports between modules.
export async function preparePages(source, destination) {
  if (!destination || path.resolve(source) === path.resolve(destination)) throw new Error('Укажите отдельную пустую папку публикации.');
  const files = await Promise.all(['index.html', ...assets].map(async name => [name, await readFile(path.join(source, name), 'utf8')]));
  const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  const names = new Map(assets.map(name => [name, name.replace(/\.(js|css)$/, `.${version}.$1`)]));
  await mkdir(destination, {recursive: true});
  if ((await readdir(destination)).length) throw new Error('Папка публикации должна быть пустой.');
  for (const [name, original] of files) {
    let content = original;
    for (const [asset, versioned] of names) content = content.replaceAll('./' + asset, './' + versioned);
    await writeFile(path.join(destination, names.get(name) || name), content);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePages(fileURLToPath(new URL('../dist/', import.meta.url)), process.argv[2]);
}
