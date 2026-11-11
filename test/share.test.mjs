import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createSongLink,readSongLink,MAX_SHARE_URL} from '../dist/share.js';

const base='https://example.com/accorder/';
const song={version:1,id:'f38c3d3c-7a0d-401a-b556-de9bbfacd548',title:'Песня 🎸',author:'Автор',
 text:'Мама\n\nДома\n!Припев',notes:'Строй\nAm <script>',chords:{'0:-1':'Cmaj7/G','0:1':'Am','2:4':'G'},transposeOffset:-2,
 updatedAt:'2026-11-11T00:00:00.000Z',exportFile:'private.txt'};
const encoded=value=>base+'#song=v1.'+gzipSync(JSON.stringify(value)).toString('base64url');

test('link roundtrip preserves song content, removes storage identity and replaces URL state',async()=>{
 const before=structuredClone(song);
 const link=await createSongLink(song,base+'?old=1#previous');
 assert.ok(link.startsWith(base+'#song=v1.'));assert.ok(link.length<MAX_SHARE_URL);
 const loaded=await readSongLink(link);
 const {id,updatedAt,exportFile,...content}=song;
 assert.deepEqual(loaded,content);assert.deepEqual(song,before);
 assert.equal(loaded.id,undefined);
 assert.equal(await readSongLink(base+'#other'),null);
});

test('invalid and unsupported links are rejected',async()=>{
 await assert.rejects(readSongLink(base+'#song=v2.abc'),/версия/);
 for(const hash of ['#song=v1.','#song=v1.abc!','#song=v1.a','#song=v1.aGVsbG8']){
  await assert.rejects(readSongLink(base+hash),/поврежд|Поврежд/);
 }
 await assert.rejects(readSongLink(encoded({...song,chords:{'0:0':'Am'}})),/поврежд/);
 await assert.rejects(readSongLink(encoded({...song,title:''})),/поврежд/);
 await assert.rejects(readSongLink(base+'#song=v1.'+'a'.repeat(MAX_SHARE_URL)),/длинная/);
});

test('creation validates fields and limits URL size without changing songs',async()=>{
 await assert.rejects(createSongLink({...song,title:''},base),/название/);
 await assert.rejects(createSongLink({...song,notes:'a'.repeat(1024*1024)},base),/большая/);
 // Deterministic varied text is poorly compressible.
 let seed=42;const chars=[];
 for(let i=0;i<60000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;chars.push(String.fromCharCode(33+(seed>>>16)%90));}
 await assert.rejects(createSongLink({...song,notes:chars.join('')},base),/16 000/);
 for(const address of ['http://localhost:3210/','http://127.0.0.1:3210/','http://[::1]/','file:///tmp/index.html']){
  await assert.rejects(createSongLink(song,address),/опубликованный/);
 }
});

test('decompression enforces uncompressed limit even for a small compressed payload',async()=>{
 const bomb=encoded({...song,notes:'a'.repeat(2*1024*1024)});
 assert.ok(bomb.length<MAX_SHARE_URL);
 await assert.rejects(readSongLink(bomb),/лимит/);
});
