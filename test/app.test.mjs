import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {positions,layout} from '../dist/core.js';

test('slot buttons render labels and select positions on each song row',async()=>{
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function slotButton(');
 const end=source.indexOf('\nfunction ',start+1);
 const song={text:'Мама\n\nДома',chords:{'0:4':'Am','2:4':'G','2:5':'F'}};
 let clicked;
 const slotButton=runInNewContext(source.slice(start,end)+'\nslotButton',{
  song,selected:null,select:pos=>{clicked=pos;},
  document:{createElement:()=>({style:{},dataset:{},setAttribute(name,value){this[name]=value;}})}
 });
 const lines=song.text.split('\n');
 for(const pos of positions(song.text,song.chords)){
  const button=slotButton(pos,lines[pos.row],layout(lines[pos.row],pos.row,song.chords,2));
  assert.ok(button['aria-label'].startsWith(`Строка ${pos.row+1}, `));
  assert.equal(button.dataset.position,pos.key);
  assert.equal(button.textContent,song.chords[pos.key]||'·');
  if(pos.index>=Array.from(lines[pos.row]).length)assert.match(button['aria-label'],/после строки, позиция/);
  button.onclick();assert.equal(clicked,pos);
 }
});
