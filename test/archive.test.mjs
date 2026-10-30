import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipTxtFiles} from '../dist/archive.js';
test('ZIP stores all named UTF-8 TXT files and matching central directory offsets',async()=>{
 const files=[{filename:'Песня.txt',text:'Песня\nАвтор\n\nAm\nМама\n'},{filename:'Песня (2).txt',text:'Примечания\n'}];
 const bytes=new Uint8Array(await zipTxtFiles(files).arrayBuffer()),view=new DataView(bytes.buffer),decode=new TextDecoder();
 let offset=0;const offsets=[];
 for(const file of files){
  offsets.push(offset);assert.equal(view.getUint32(offset,true),0x04034b50);assert.equal(view.getUint16(offset+6,true),0x0800);
  const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true);
  assert.equal(decode.decode(bytes.slice(offset+30,offset+30+nameLength)),'exports/'+file.filename);
  assert.equal(decode.decode(bytes.slice(offset+30+nameLength,offset+30+nameLength+size)),file.text);
  offset+=30+nameLength+size;
 }
 for(const localOffset of offsets){assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(offset+42,true),localOffset);offset+=46+view.getUint16(offset+28,true);}
 assert.equal(view.getUint32(offset,true),0x06054b50);assert.equal(view.getUint16(offset+8,true),files.length);
});
