import {test} from 'node:test';
import assert from 'node:assert/strict';
import {remapChords,positions,exportTxt} from '../dist/core.js';

function chordAt(text, word, letter, occurrence=0) {
  const chars=Array.from(text),needle=Array.from(word);
  let found=-1;
  for(let i=0;i<=chars.length-needle.length;i++) {
    if(needle.every((c,k)=>chars[i+k]===c)&&occurrence--===0){found=i;break;}
  }
  assert.notEqual(found,-1,word);
  const at=found+letter, before=chars.slice(0,at).join('').split('\n');
  return `${before.length-1}:${Array.from(before.at(-1)).length}`;
}
const transfer=(oldText,newText,oldWord,newWord,letter,newLetter)=>{
  const chords={[chordAt(oldText,oldWord,letter)]:'Cmaj7/G'};
  assert.deepEqual(remapChords(oldText,newText,chords),{[chordAt(newText,newWord,newLetter)]:'Cmaj7/G'});
  assert.deepEqual(chords,{[chordAt(oldText,oldWord,letter)]:'Cmaj7/G'});
};
test('unchanged text preserves all bindings without mutating the input',()=>{
 const chords={'0:-1':'Am','0:1':'F','0:4':'G'};
 const result=remapChords('Мама','Мама',chords);
 assert.deepEqual(result,chords);assert.notEqual(result,chords);
});
test('marking a line removes vowel and edge chords without changing other lines',()=>{
 const old='Мама\nДома',text='! Мама\nДома';
 const chords={'0:-1':'G','0:1':'Am','0:3':'F','0:4':'C','1:1':'Dm'};
 assert.deepEqual(remapChords(old,text,chords),{'1:1':'Dm'});
 assert.deepEqual(remapChords(text,'Мама\nДома',{'1:1':'Dm'}),{'1:1':'Dm'});
 assert.equal(Object.keys(chords).length,5);
});
test('chords cannot move into or out of marked rows during splits and merges',()=>{
 assert.deepEqual(remapChords('Мама дома','Мама\n! дома',{'0:1':'Am','0:6':'G','0:9':'F'}),{'0:1':'Am'});
 assert.deepEqual(remapChords('! Мама\nДома','Мама Дома',{'0:3':'Am','1:1':'Dm'}),{'0:6':'Dm'});
 assert.deepEqual(remapChords('!Мама\nДома','!Мама\nДома',{'0:2':'Am','1:1':'Dm'}),{'1:1':'Dm'});
});
test('insertions, deletions and typos before a surviving vowel',()=>{
 transfer('Мама дома','Моя Мама дома','дома','дома',1,1);
 transfer('Мама дома','Мама вдома','дома','вдома',1,2);
 transfer('Мама вдома','Мама дома','вдома','дома',2,1);
 transfer('Мама дома','Мама тома','дома','тома',1,1);
});
test('deleting the anchored vowel removes only that chord',()=>{
 const old='Мама дома',next='Мма дома';
 const chords={[chordAt(old,'Мама',1)]:'Am',[chordAt(old,'дома',1)]:'G'};
 assert.deepEqual(remapChords(old,next,chords),{[chordAt(next,'дома',1)]:'G'});
});
test('split, join and blank verses keep vowel anchors and original text',()=>{
 const old='Мама дома\nYou sing';
 const chords={[chordAt(old,'дома',1)]:'Am',[chordAt(old,'You',1)]:'F'};
 for(const next of ['Мама\nдома\nYou sing','Мама дома You sing','\n\nМама дома\n\nYou sing\n']) {
   assert.deepEqual(remapChords(old,next,chords),{[chordAt(next,'дома',1)]:'Am',[chordAt(next,'You',1)]:'F'});
 }
 transfer('Мама дома','Ма\nма дома','Мама','Ма\nма',1,1);
 transfer('Ма\nма дома','Мама дома','ма дома','Мама',1,3);
});
test('editing one line preserves later lines',()=>{
 const old='Тихое море\nДалеко дома\nYou sing',next='Новое поле\nДалеко дома\nYou sing';
 const chords={'0:1':'Am','1:1':'F','2:1':'G'};
 assert.deepEqual(remapChords(old,next,chords),{'1:1':'F','2:1':'G'});
});
test('new words do not inherit accidental matching vowels',()=>{
 assert.deepEqual(remapChords('море','поле',{'0:1':'Am','0:3':'G'}),{});
 assert.deepEqual(remapChords('дорога','корона',{'0:1':'Am','0:3':'G','0:5':'F'}),{});
 assert.deepEqual(remapChords('Светит море вдали','Светит поле вдали',{'0:8':'Am','0:2':'G'}),{'0:2':'G'});
 assert.deepEqual(remapChords('Моя песня','Другая строка',{'0:1':'Am','0:5':'G'}),{});
});
test('repeated words preserve order, ambiguous deletion does not choose a repeat',()=>{
 assert.deepEqual(remapChords('мама мама','мама',{'0:1':'Am','0:6':'G'}),{});
 const old='Куплет первый\nМама дома\nКуплет второй\nМама дома';
 const next='Куплет новый первый\nМама дома\nКуплет второй\nМама дома';
 assert.deepEqual(remapChords(old,next,{'1:1':'Am','3:1':'G'}),{'1:1':'Am','3:1':'G'});
});
test('edges follow the first/last surviving part on split; merged edges disappear',()=>{
 assert.deepEqual(remapChords('Мама дома','Мама\nдома',{'0:-1':'Am','0:9':'G'}),{'0:-1':'Am','1:4':'G'});
 assert.deepEqual(remapChords('Мама\nдома','Мама дома',{'0:-1':'Am','0:4':'F','1:-1':'C','1:4':'G'}),{'0:-1':'Am','0:9':'G'});
 assert.deepEqual(remapChords('Мама дома','дома',{'0:-1':'Am','0:9':'G'}),{'0:4':'G'});
 assert.deepEqual(remapChords('Мама дома!','Мама\nдома!',{'0:-1':'Am','0:10':'G'}),{'0:-1':'Am','1:5':'G'});
});
test('Unicode code points, Cyrillic and combining marks retain valid coordinates',()=>{
 transfer('😀 Ёлка You','😀\nЁлка You','Ёлка','Ёлка',0,0);
 transfer('ё\u0301лка дома','Наша ё\u0301лка дома','ё\u0301лка','ё\u0301лка',0,0);
});
test('result uses existing JSON schema, valid positions and TXT export',()=>{
 const old='Мама дома\nYou sing',text='Мама\n\nдома\nYou sing';
 const chords=remapChords(old,text,{'0:-1':'A','0:6':'F#madd9','1:1':'Cmaj7/G'});
 const valid=new Set(positions(text).map(p=>p.key));
 for(const key of Object.keys(chords))assert.ok(valid.has(key));
 const song={version:1,title:'Песня',text,chords};
 assert.deepEqual(JSON.parse(JSON.stringify(song)),song);
 assert.match(exportTxt(song),/F#madd9/);assert.match(exportTxt(song),/Cmaj7\/G/);
 assert.equal(song.text,text);
});
test('large unique-anchor gaps retain unchanged context with bounded work',()=>{
 const lines=Array.from({length:1500},(_,i)=>`Строка${i} музыка`);
 const old=lines.join('\n');lines[700]='Заменена середина';const next=lines.join('\n');
 assert.deepEqual(remapChords(old,next,{'20:3':'Am','700:3':'F','1400:3':'G'}),{'20:3':'Am','1400:3':'G'});
});
test('large repetitive rewrites safely discard uncertain matches',()=>{
 const old='мама '.repeat(2000),next='мама '.repeat(1000);
 assert.deepEqual(remapChords(old,next,{'0:1':'Am'}),{});
});


test('all trailing chords follow the surviving end of a changed or split line',()=>{
 const chords={'0:9':'Am','0:10':'G','0:11':'F'};
 assert.deepEqual(remapChords('Мама дома','дома',chords),{'0:4':'Am','0:5':'G','0:6':'F'});
 assert.deepEqual(remapChords('Мама дома','Мама\nдома',chords),{'1:4':'Am','1:5':'G','1:6':'F'});
 assert.deepEqual(remapChords('Мама дома','!Мама дома',chords),{});
});
