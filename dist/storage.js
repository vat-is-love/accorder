import {positions, exportTxt, exportFilename} from './core.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeSong(value, {newId = () => crypto.randomUUID(), now = () => new Date().toISOString()} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный файл песни.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024) throw new Error('Песня слишком большая (максимум 1 МБ).');
  if (value.version !== undefined && value.version !== 1) throw new Error('Неподдерживаемая версия файла песни.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || typeof value.text !== 'string') throw new Error('Проверьте название и текст песни.');
  if (value.author !== undefined && (typeof value.author !== 'string' || value.author.length > 200 || /[\x00-\x1f\x7f]/u.test(value.author))) throw new Error('Проверьте автора песни (максимум 200 символов, одна строка).');
  if (value.notes !== undefined && typeof value.notes !== 'string') throw new Error('Примечания должны быть текстом.');
  if (!value.chords || typeof value.chords !== 'object' || Array.isArray(value.chords)) throw new Error('Некорректная разметка аккордов.');
  if (value.id !== undefined && !uuid.test(value.id)) throw new Error('Некорректный идентификатор песни.');
  const valid = new Set(positions(value.text).map(p => p.key)), chords = {};
  for (const [key, chord] of Object.entries(value.chords)) {
    if (!valid.has(key) || typeof chord !== 'string' || !chord || chord.length > 40 || /[\s\x00-\x1f\x7f]/u.test(chord)) throw new Error('Некорректная позиция или обозначение аккорда.');
    chords[key] = chord;
  }
  return {version:1, id:value.id || newId(), title:value.title.trim(), author:(value.author || '').trim(), text:value.text, notes:value.notes || '', chords,
    updatedAt:typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) ? new Date(value.updatedAt).toISOString() : now()};
}

export function parseImport(value) {
  let songs;
  if (value?.format === 'accorder-library') {
    if (value.version !== 1 || !Array.isArray(value.songs)) throw new Error('Неподдерживаемый формат библиотеки.');
    songs = value.songs;
  } else if (Array.isArray(value)) songs = value;
  else songs = [value];
  const normalized = songs.map(song => normalizeSong(song)), ids = new Set();
  for (const song of normalized) {
    if (ids.has(song.id)) throw new Error('В импортируемых файлах повторяются идентификаторы песен.');
    ids.add(song.id);
  }
  return normalized;
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('В хранилище браузера недостаточно места. Выгрузите библиотеку в JSON.');
  return new Error('Не удалось прочитать или сохранить библиотеку в браузере. Проверьте доступ к данным сайта.');
}

export class BrowserLibrary {
  constructor({factory = globalThis.indexedDB, name = 'accorder'} = {}) {this.factory = factory; this.name = name; this.opening = null;}
  open() {
    if (!this.factory) return Promise.reject(new Error('IndexedDB недоступна. Разрешите хранение данных сайта в браузере.'));
    if (!this.opening) {
      this.opening = new Promise((resolve, reject) => {
        let settled = false;
        const fail = error => {if (!settled) {settled = true; this.opening = null; reject(error);}};
        let request;
        try {request = this.factory.open(this.name, 1);} catch(error) {fail(storageError(error)); return;}
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('songs', {keyPath:'id'});
          db.createObjectStore('exports', {keyPath:'id'});
        };
        request.onerror = () => fail(storageError(request.error));
        request.onblocked = () => fail(new Error('Закройте другие вкладки accorder и повторите действие.'));
        request.onsuccess = () => {
          const db = request.result;
          if (settled) {db.close(); return;}
          settled = true;
          db.onversionchange = () => {db.close(); this.opening = null;};
          resolve(db);
        };
      }).catch(error => {this.opening = null; throw error;});
    }
    return this.opening;
  }
  async transaction(stores, mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try {
        tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || storageError(tx.error));
        tx.onerror = event => {failure ||= storageError(event.target.error || tx.error);};
        work(tx, value => {result = value;}, error => {failure = error; tx.abort();});
      } catch(error) {
        if (tx) {failure = error; tx.abort();} else reject(storageError(error));
      }
    });
  }
  async all() {
    return this.transaction(['songs'], 'readonly', (tx, done) => {
      const request = tx.objectStore('songs').getAll(); request.onsuccess = () => done(request.result);
    });
  }
  async list() {return (await this.all()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));}
  async get(id) {
    const song = await this.transaction(['songs'], 'readonly', (tx, done) => {
      const request = tx.objectStore('songs').get(id); request.onsuccess = () => done(request.result);
    });
    if (!song) throw new Error('Песня не найдена.');
    return song;
  }
  async putMany(values, {preserveDates = false, overwrite = false} = {}) {
    const songs = values.map(value => normalizeSong(value));
    const ids = new Set(songs.map(song => song.id));
    if (ids.size !== songs.length) throw new Error('Повторяются идентификаторы песен.');
    if (!preserveDates) for (const song of songs) song.updatedAt = new Date().toISOString();
    return this.transaction(['songs','exports'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('songs'), exports = tx.objectStore('exports');
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const existing = request.result;
          if (preserveDates && !overwrite && existing.some(song => ids.has(song.id))) {fail(new Error('Есть песни с такими идентификаторами. Подтвердите замену.')); return;}
          const occupied = existing.filter(song => !ids.has(song.id)).map(song => song.exportFile).filter(Boolean);
          for (const song of songs) {
            song.exportFile = exportFilename(song.title, occupied); occupied.push(song.exportFile);
            store.put(song);
            exports.put({id:song.id, filename:song.exportFile, text:exportTxt(song)});
          }
          done(songs);
        } catch(error) {fail(error);}
      };
    });
  }
  async save(value) {return (await this.putMany([value]))[0];}
  async remove(id) {
    return this.transaction(['songs','exports'], 'readwrite', tx => {
      tx.objectStore('songs').delete(id);
      tx.objectStore('exports').delete(id);
    });
  }
  async importSongs(values, options = {}) {return this.putMany(values, {...options, preserveDates:true});}
  async backup() {return {format:'accorder-library', version:1, songs:await this.all()};}
  async exportFiles() {
    return this.transaction(['exports'], 'readonly', (tx, done) => {
      const request = tx.objectStore('exports').getAll(); request.onsuccess = () => done(request.result);
    });
  }
  async close() {if (this.opening) (await this.opening).close(); this.opening = null;}
}

export class FileLibrary {
  async request(path, method = 'GET', data) {
    const response = await fetch(path, {method, headers:data ? {'Content-Type':'application/json'} : {}, body:data ? JSON.stringify(data) : undefined});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ошибка сервера');
    return result;
  }
  list() {return this.request('/api/songs');}
  get(id) {return this.request('/api/songs/' + id);}
  remove(id) {return this.request('/api/songs/' + id, 'DELETE');}
  save(song) {return this.request('/api/songs' + (song.id ? '/' + song.id : ''), song.id ? 'PUT' : 'POST', song);}
}
