import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {BrowserLibrary,normalizeSong,parseImport} from '../dist/storage.js';
import {exportTxt} from '../dist/core.js';
const draft={title:'Песня',author:'Автор',text:'Мама\n\nYou',notes:'Тише\nПовторить',chords:{'0:1':'Am','2:1':'F'}};
const make=()=>new BrowserLibrary({factory:new IDBFactory()});

test('text-only lines roundtrip with markers and export without markers or chords',async()=>{
 const store=make();
 const saved=await store.save({...draft,text:'! Тише\nМама',chords:{'1:1':'Am'}});
 assert.equal((await store.get(saved.id)).text,'! Тише\nМама');
 assert.equal((await store.backup()).songs[0].text,'! Тише\nМама');
 assert.match((await store.exportFiles())[0].text,/\nТише\n Am\nМама/);
 assert.throws(()=>normalizeSong({...saved,chords:{'0:3':'G'}}),/позиция/);
 await store.close();
});

test('save, close, reopen and read every song field with matching TXT',async()=>{
 const factory=new IDBFactory(), first=new BrowserLibrary({factory});
 const saved=await first.save(draft);
 assert.match(saved.id,/^[\da-f-]{36}$/);assert.equal(saved.notes,draft.notes);
 await first.close();
 const reopened=new BrowserLibrary({factory});
 assert.deepEqual(await reopened.get(saved.id),saved);
 assert.equal((await reopened.list()).length,1);
 const [txt]=await reopened.exportFiles();
 assert.equal(txt.filename,'Песня.txt');assert.equal(txt.text,exportTxt(saved));
 await reopened.close();
});
test('overwriting and renaming keep one current song and one current TXT',async()=>{
 const store=make();const saved=await store.save(draft);
 const updated=await store.save({...saved,title:'Новое название',author:'Другой автор',notes:'Другие примечания'});
 assert.equal(updated.id,saved.id);assert.equal((await store.all()).length,1);
 const files=await store.exportFiles();assert.equal(files.length,1);
 assert.equal(files[0].filename,'Новое название.txt');assert.match(files[0].text,/Другие примечания/);
 await store.close();
});
test('same titles do not overwrite another song or its TXT',async()=>{
 const store=make();const first=await store.save(draft),second=await store.save({...draft,notes:'Вторая песня'});
 assert.notEqual(first.id,second.id);assert.equal(second.exportFile,'Песня (2).txt');
 assert.equal((await store.exportFiles()).length,2);
 assert.equal((await store.get(first.id)).notes,draft.notes);await store.close();
});
test('backup and restore preserve IDs, Unicode, all fields and timestamps',async()=>{
 const source=make();const saved=await source.save(draft);
 const backup=JSON.parse(JSON.stringify(await source.backup()));
 const destination=make();await destination.importSongs(parseImport(backup));
 assert.deepEqual(await destination.get(saved.id),saved);
 assert.equal((await destination.exportFiles())[0].text,exportTxt(saved));
 await source.close();await destination.close();
});
test('legacy JSON without author, notes, ID or date imports',async()=>{
 const [legacy]=parseImport({title:'Старая песня',text:'Аё',chords:{'0:0':'G'}});
 assert.equal(legacy.author,'');assert.equal(legacy.notes,'');
 const store=make();await store.importSongs([legacy]);assert.equal((await store.list()).length,1);await store.close();
});
test('import conflict requires explicit replacement; entire batch remains intact on failure',async()=>{
 const store=make();const existing=await store.save(draft), fresh=normalizeSong({...draft,title:'Новая'});
 await assert.rejects(store.importSongs([fresh,{...existing,notes:'Замена'}]),/Подтвердите/);
 assert.equal((await store.all()).length,1);assert.equal((await store.get(existing.id)).notes,draft.notes);
 await store.importSongs([{...existing,notes:'Замена'}],{overwrite:true});
 assert.equal((await store.get(existing.id)).notes,'Замена');await store.close();
});
test('invalid imported bindings and unsupported backups cannot partially change storage',async()=>{
 const store=make();await store.save(draft);
 await assert.rejects(store.importSongs([draft,{...draft,chords:{'0:999':'C'}}]),/позиция/);
 assert.equal((await store.all()).length,1);
 assert.throws(()=>parseImport({format:'accorder-library',version:99,songs:[]}),/формат/);
 assert.throws(()=>parseImport(null),/файл/);
 const existing=(await store.all())[0];assert.throws(()=>parseImport([existing,existing]),/повторяются/);
 assert.throws(()=>normalizeSong({...draft,notes:123}),/Примечания/);
 assert.throws(()=>normalizeSong({...draft,author:'Автор\nСтрока'}),/автора/);
 await store.close();
});
test('aborted transaction rolls back song and TXT together',async()=>{
 const store=make();const saved=await store.save(draft);
 await assert.rejects(store.transaction(['songs','exports'],'readwrite',(tx,done,fail)=>{
   tx.objectStore('songs').put({...saved,notes:'Не записывать'});
   tx.objectStore('exports').put({id:saved.id,filename:'Нет.txt',text:'Нет'});
   fail(new Error('Отмена записи'));
 }),/Отмена записи/);
 assert.equal((await store.get(saved.id)).notes,draft.notes);
 assert.equal((await store.exportFiles())[0].text,exportTxt(saved));await store.close();
});
test('unavailable IndexedDB fails explicitly without pretending to save',async()=>{
 const store=new BrowserLibrary({factory:null});await assert.rejects(store.save(draft),/IndexedDB недоступна/);
});
test('saving snapshots input before asynchronous database work',async()=>{
 const store=make(),value=structuredClone(draft);const operation=store.save(value);
 value.notes='Поздняя правка';value.chords['0:1']='G';
 const saved=await operation;assert.equal(saved.notes,draft.notes);assert.equal(saved.chords['0:1'],'Am');await store.close();
});

test('simultaneous saves from two tabs serialize TXT filename assignment',async()=>{
 const factory=new IDBFactory(),left=new BrowserLibrary({factory}),right=new BrowserLibrary({factory});
 const [first,second]=await Promise.all([left.save(draft),right.save(draft)]);
 assert.notEqual(first.id,second.id);assert.notEqual(first.exportFile,second.exportFile);
 assert.equal((await left.all()).length,2);assert.equal((await right.exportFiles()).length,2);
 await left.close();await right.close();
});


test('copy has independent ID and TXT; deletion removes only the selected song and export',async()=>{
 const store=make(),original=await store.save(draft);
 const {id,updatedAt,exportFile,...copy}=await store.get(original.id);
 const saved=await store.save({...copy,title:copy.title+' (копия)'});
 assert.notEqual(saved.id,original.id);assert.deepEqual(saved.chords,original.chords);
 assert.equal(saved.notes,original.notes);assert.equal(saved.author,original.author);
 await store.remove(original.id);
 await assert.rejects(store.get(original.id),/не найдена/);
 assert.deepEqual(await store.all(),[saved]);
 assert.deepEqual((await store.exportFiles()).map(file=>file.id),[saved.id]);
 assert.deepEqual((await store.backup()).songs,[saved]);await store.close();
});
