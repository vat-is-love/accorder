import {importChordText} from './core.js';

function decode(value) {
  const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', hellip:'…', ndash:'–', mdash:'—', laquo:'«', raquo:'»', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”'};
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return entities[name] ?? entity;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '�';
  });
}
function plain(html) {
  return decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<br\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''));
}
function property(attributes, name) {
  const match = attributes.match(/\bitemprop\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').split(/\s+/).includes(name);
}

function songText(html) {
  // AMDM displays section keywords as blocks, but chord divs stay inline.
  // Saved HTML need not contain a newline between a keyword and its track.
  const separated = html.replace(/<div\b([^>]*)>([\s\S]*?)<\/div\s*>/gi, (element, attributes, content, offset) => {
    const match = attributes.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const classes = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').split(/\s+/);
    if (!classes.includes('podbor__keyword')) return element;
    const before = offset > 0 && html[offset - 1] !== '\n' ? '\n' : '';
    const after = /^[\r\n]/u.test(html.slice(offset + element.length)) ? '' : '\n';
    return before + content + after;
  });
  return plain(separated).replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\n$/, '');
}

// Extract only the song block. Never insert remote HTML into the editor DOM.
export function parseAmdmHtml(html) {
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > 2 * 1024 * 1024) throw new Error('Страница AMDM слишком большая (максимум 2 МиБ).');
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const block = Array.from(clean.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi)).find(match => property(match[1], 'chordsBlock') || property(match[1], 'chords'));
  const heading = clean.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1];
  if (!block || !heading) throw new Error('На странице не найдены название и текст песни AMDM. Возможно, сайт вернул защиту от загрузки.');
  const names = Array.from(heading.matchAll(/<(span|a)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)).filter(match => property(match[2], 'name')).map(match => plain(match[3]).replace(/\s+/g, ' ').trim());
  const label = plain(heading).replace(/\s+/g, ' ').trim().replace(/,\s*аккорды(?:\s+песни.*)?$/iu, '');
  const separator = label.indexOf(' - ');
  const artist = names.length >= 2 ? names[0] : separator >= 0 ? label.slice(0, separator) : '';
  const title = names.length >= 2 ? names.at(-1) : separator >= 0 ? label.slice(separator + 3) : '';
  if (!title || !artist || title.length > 200 || artist.length > 200) throw new Error('Не удалось определить автора и название песни AMDM.');
  const source = songText(block[2]);
  const result = importChordText(source);
  return {...result, title, author:artist};
}
