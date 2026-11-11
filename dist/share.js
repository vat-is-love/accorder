import {normalizeSong} from './storage.js';

export const MAX_SHARE_URL = 16000;
const MAX_SONG_BYTES = 1024 * 1024;
const prefix = '#song=v1.';

function portableSong(value) {
  const {title,author,text,notes,chords,transposeOffset} = normalizeSong({
    version:1,title:value.title,author:value.author,text:value.text,notes:value.notes,
    chords:value.chords,transposeOffset:value.transposeOffset
  });
  return {version:1,title,author,text,notes,chords,transposeOffset};
}

export async function createSongLink(song, address) {
  if (typeof CompressionStream === 'undefined') throw new Error('Браузер не поддерживает сжатие ссылок. Используйте экспорт JSON.');
  const url = new URL(address);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Откройте опубликованный сайт, чтобы поделиться песней.');
  if (/^(localhost|127\..*|\[::1\])$/i.test(url.hostname)) throw new Error('Локальная ссылка недоступна другим пользователям. Откройте опубликованный сайт или используйте JSON.');
  const json = JSON.stringify(portableSong(song));
  const compressed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const bytes = new Uint8Array(compressed);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  url.search = '';
  url.hash = prefix + btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  if (url.href.length > MAX_SHARE_URL) throw new Error('Песня слишком большая для ссылки (лимит 16 000 символов). Используйте экспорт JSON.');
  return url.href;
}

export async function readSongLink(address) {
  const url = new URL(address);
  if (!url.hash.startsWith('#song=')) return null;
  if (url.href.length > MAX_SHARE_URL) throw new Error('Ссылка на песню слишком длинная. Попросите отправить JSON.');
  if (!url.hash.startsWith(prefix)) throw new Error('Неподдерживаемая версия ссылки на песню.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не поддерживает распаковку ссылок. Используйте импорт JSON.');
  const encoded = url.hash.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Повреждённая ссылка на песню.');
  let reader;
  try {
    const binary = atob(encoded.replaceAll('-','+').replaceAll('_','/'));
    const bytes = Uint8Array.from(binary, c=>c.charCodeAt(0));
    reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];let size = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SONG_BYTES) throw new Error('Песня слишком большая.');
      chunks.push(value);
    }
    const json = await new Blob(chunks).text();
    return portableSong(JSON.parse(json));
  } catch {
    throw new Error('Не удалось открыть песню: ссылка повреждена или превышен лимит 1 МиБ.');
  } finally {
    if (reader) await reader.cancel().catch(()=>{});
  }
}
