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
 const code=source.slice(source.indexOf('function syncTranspose(){'),source.indexOf('async function canLeave(){'));
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

async function autosaveEditor(){
 const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
 const controls=new Map(),timers=new Map(),writes=[],events={};let timerId=0;
 const $=id=>{if(!controls.has(id))controls.set(id,{value:'',hidden:true});return controls.get(id);};
 const {remapChords}=await import('../dist/core.js');
 const context={$,song:{title:'Песня',text:'Мама',chords:{'0:1':'Am'}},selected:null,dirty:false,libraryBusy:false,
  setTimeout(fn,delay){assert.equal(delay,1000);timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
  document:{addEventListener(name,fn){events[name]=fn;}},
  storage:{async save(value){writes.push(value);return {...value,id:'same-id',exportFile:'song.txt',updatedAt:'now'};}},
  status(message){context.message=message;},library:async()=>{},refreshPreview(){},updateLine(){},
  resetRowSelection(){},render(){},syncSourceState(){},remapChords};
 $('source').value=context.song.text;
 const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 runInNewContext(block('let saveTimer=', 'async function library()')+
  block('async function canLeave(){','function show(')+
  block('function commit(){','function closeSuggestions()')+
  block('function applyText(){',"$('apply').onclick")+
  block('async function saveSong(){',"$('save').onclick"),context);
 return {context,$,writes,timers,events,run:code=>runInNewContext(code,context)};
}

test('autosave debounces input, applies text and remaps chords before writing',async()=>{
 const e=await autosaveEditor();
 e.$('source').value='О, Мама';
 e.run('changed();changed();');assert.equal(e.timers.size,1);assert.equal(e.writes.length,0);
 [...e.timers.values()][0]();await e.run('saveSong()');
 assert.equal(e.writes.length,1);assert.equal(e.writes[0].text,'О, Мама');
 assert.equal(e.writes[0].chords['0:4'],'Am');assert.equal(e.context.dirty,false);
 assert.equal(e.$('save-state').textContent,'Сохранено');assert.equal(e.$('save').hidden,true);
});

test('edits and navigation during a pending write wait for the next write with the same id',async()=>{
 const e=await autosaveEditor();let finish;
 const save=e.context.storage.save;
 e.context.storage.save=async value=>{if(!e.writes.length){e.writes.push(value);return new Promise(resolve=>{finish=()=>resolve({...value,id:'same-id'});});}return save(value);};
 e.run('changed()');const pending=e.run('saveSong()');await Promise.resolve();
 e.context.song.notes='новое';e.$('source').value='Мама дома';e.run('changed()');
 let left=false;const navigation=e.run('canLeave()').then(result=>{left=result;});
 await Promise.resolve();assert.equal(left,false);assert.equal(e.writes.length,1);
 finish();await pending;await navigation;
 assert.equal(left,true);assert.equal(e.writes.length,2);
 assert.equal(e.writes[1].id,'same-id');assert.equal(e.writes[1].notes,'новое');assert.equal(e.writes[1].text,'Мама дома');
 assert.equal(e.context.dirty,false);assert.equal(e.timers.size,0);
});

test('save failure blocks navigation, keeps edits and offers a working retry',async()=>{
 const e=await autosaveEditor(),save=e.context.storage.save;
 e.context.storage.save=async()=>{throw new Error('Нет места');};e.run('changed()');
 assert.equal(await e.run('canLeave()'),false);assert.equal(e.context.dirty,true);
 assert.equal(e.context.message,'Нет места');assert.equal(e.$('save').hidden,false);assert.equal(e.timers.size,0);
 e.context.storage.save=save;assert.equal(await e.run('saveSong()'),true);
 assert.equal(e.context.dirty,false);assert.equal(e.$('save').hidden,true);
});

test('untitled songs wait for a title and IME input waits for composition to end',async()=>{
 const e=await autosaveEditor();e.context.song.title='';e.run('changed()');
 assert.equal(await e.run('saveSong()'),false);assert.equal(e.writes.length,0);assert.equal(e.context.dirty,true);
 e.context.song.title='Название';e.events.compositionstart();e.run('changed()');
 assert.equal(e.timers.size,0);assert.equal(await e.run('saveSong()'),false);
 e.events.compositionend();assert.equal(e.timers.size,1);await e.run('saveSong()');assert.equal(e.writes.length,1);
});

test('autosave commits active chord input and preserves invalid input for correction',async()=>{
 const e=await autosaveEditor();e.context.selected={key:'0:1'};e.$('chord').value='G';e.run('changed()');
 await e.run('saveSong()');assert.equal(e.writes[0].chords['0:1'],'G');
 e.$('chord').value='G m';e.run('changed()');assert.equal(await e.run('canLeave()'),false);
 assert.equal(e.writes.length,1);assert.equal(e.context.dirty,true);assert.equal(e.$('chord').value,'G m');
});
