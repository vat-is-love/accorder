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

test('transpose offset accumulates, survives spelling changes and applies a new baseline',async()=>{
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const controls=new Map();
 const $=id=>{if(!controls.has(id))controls.set(id,{});return controls.get(id);};
 const song={chords:{'0:1':'C'}};
 const context={song,$,chordSpelling:'sharps',commit:()=>true,setChordSpelling:()=>{},
  transposeChord:(value,step)=>step===0?value:value==='C'?'C#':'C',
  selected:null,closeSuggestions:()=>{},changed:()=>{},render:()=>{},refreshPreview:()=>{},status:()=>{},dirty:false};
 const code=source.slice(source.indexOf('function syncTranspose(){'),source.indexOf('function canLeave(){'));
 runInNewContext(code+'\ntransposeSong(1);',context);
 assert.equal(song.transposeOffset,1);assert.equal($('transpose-offset').textContent,'+1');
 runInNewContext('transposeSong(0,"flats");',context);assert.equal(song.transposeOffset,1);
 runInNewContext('transposeSong(-1);',context);assert.equal(song.transposeOffset,0);assert.equal($('transpose-offset').hidden,true);
 runInNewContext('transposeSong(-1);',context);assert.equal(song.transposeOffset,-1);
 const chords={...song.chords};$('transpose-apply').onclick();
 assert.equal(song.transposeOffset,0);assert.deepEqual(song.chords,chords);assert.equal($('transpose-apply').hidden,true);
});

test('empty chord input lists song chords by frequency; typed input uses dictionary',async()=>{
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function suggestions(){');
 const end=source.indexOf('\nfunction drawSuggestions()',start);
 const input={value:''};
 const context={song:{chords:{'0:1':'G','0:3':'Am','1:1':'G','1:3':'F','2:1':'Am'}},
  selected:{key:'3:1'},closed:false,matches:[],dictionary:['Am','Am7','G'],
  $:()=>input,closeSuggestions(){context.matches=[];},drawSuggestions(){}};
 runInNewContext(source.slice(start,end)+'\nsuggestions();',context);
 assert.deepEqual(Array.from(context.matches),['Am','G','F']);
 input.value='a';runInNewContext('suggestions();',context);
 assert.deepEqual(Array.from(context.matches),['Am','Am7']);
 input.value='';context.song.chords={};runInNewContext('suggestions();',context);
 assert.equal(context.matches.length,0);
});


test('row tools restrict copy sources while allowing paste into unchorded lyrics',async()=>{
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function syncRowTools(){'),end=source.indexOf("\n$('copy-chords').onclick",start);
 const controls=new Map(),$=id=>{if(!controls.has(id))controls.set(id,{});return controls.get(id);};
 const rows=Array.from({length:5},(_,i)=>({dataset:{row:String(i)},
  pick:{setAttribute(){}},querySelector(){return this.pick;},classList:{toggle(){}}}));
 $('score').querySelectorAll=()=>rows;
 const {isTextOnlyLine}=await import('../dist/core.js');
 const context={$,song:{text:'Мама\n\nДома\n!Припев\n   ',chords:{'0:1':'Am'}},rowStart:2,rowEnd:2,copiedRows:null,isTextOnlyLine};
 runInNewContext(source.slice(start,end)+'\nsyncRowTools();',context);
 assert.deepEqual(rows.map(row=>row.pick.disabled),[false,true,true,true,true]);
 assert.equal($('copy-chords').disabled,true);
 context.rowStart=context.rowEnd=0;runInNewContext('syncRowTools();',context);
 assert.equal($('copy-chords').disabled,false);
 context.copiedRows=[[{value:'Am'}]];context.rowStart=context.rowEnd=2;runInNewContext('syncRowTools();',context);
 assert.deepEqual(rows.map(row=>row.pick.disabled),[false,true,false,true,true]);
 assert.equal($('copy-chords').disabled,true);assert.equal($('paste-chords').disabled,false);
});

test('shared song opens as an unsaved preview; errors and concurrent edits keep editor intact',async()=>{
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function openSharedSong(){'),source.lastIndexOf('openSharedSong();'));
 const shared={title:'Песня',text:'Мама',chords:{'0:1':'Am'}};
 const calls=[];
 const context={song:null,dirty:false,location:{href:'https://example.com/#song=v1.abc'},
  readSongLink:async()=>shared,show:value=>calls.push(['show',value]),changed:()=>calls.push(['changed']),
  setTab:name=>calls.push(['tab',name]),status:()=>{},alert:message=>calls.push(['alert',message])};
 await runInNewContext(code+'\nopenSharedSong()',context);
 assert.equal(calls[0][1],shared);assert.deepEqual(calls.slice(1),[['changed'],['tab','preview']]);
 calls.length=0;context.song={title:'Другой черновик'};
 await runInNewContext('openSharedSong()',context);
 assert.equal(calls.length,1);assert.equal(calls[0][0],'alert');
 calls.length=0;context.readSongLink=async()=>{throw new Error('Повреждённая ссылка');};
 await runInNewContext('openSharedSong()',context);
 assert.deepEqual(calls,[['alert','Повреждённая ссылка']]);
});
