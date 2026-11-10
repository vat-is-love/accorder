import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positions,layout,exportTxt,exportFilename,importChordText} from '../dist/core.js';

test('text-only marker removes all slots and chord spacing but stays in source',()=>{
 const text='Мама\n! Тише\n!G Hm\n!\n\nДома!';
 assert.deepEqual(positions(text).map(p=>p.key),['0:-1','0:1','0:3','0:4','5:-1','5:1','5:3','5:5']);
 const chords={'1:-1':'G','1:3':'Am','1:6':'C'};
 assert.deepEqual(layout('! Тише',1,chords,2),{text:'  Тише',track:'',columns:{},width:8});
 assert.equal(layout('!!Важно',0,{}).text,'!Важно');
 assert.equal(layout(' !Тише',0,{}).text,' !Тише');
 assert.equal(exportTxt({title:'Песня',text,chords}),'Песня\n\nМама\nТише\nG Hm\n\n\nДома!\n');
 assert.equal(text,'Мама\n! Тише\n!G Hm\n!\n\nДома!');
});

test('chord import preserves marked lines and never binds preceding chords to them',()=>{
 const result=importChordText(' G\n! Тише\n!Am G\n Am\nМама');
 assert.equal(result.text,' G\n! Тише\n!Am G\nМама');
 assert.deepEqual(result.chords,{'3:1':'Am'});
 assert.equal(result.retained,1);
 assert.equal(result.imported,1);
});

test('import chord tracks preserves verses and maps columns to valid vowels',()=>{
 const result=importChordText('Куплет:\n Am   F\nМама дома\n\n Cmaj7/G\nYou');
 assert.equal(result.text,'Куплет:\nМама дома\n\nYou');
 assert.deepEqual(result.chords,{'1:1':'Am','1:6':'F','3:1':'Cmaj7/G'});
 assert.equal(result.imported,3);
 assert.equal(result.retained,0);
 const valid=new Set(positions(result.text).map(p=>p.key));
 for(const key of Object.keys(result.chords))assert.ok(valid.has(key));
 assert.match(exportTxt({title:'Песня',...result}),/Cmaj7\/G/);
});

test('import handles boundaries, Unicode columns, CRLF, tabs and nonbreaking spaces',()=>{
 const result=importChordText('Am\tG\r\n  Мама\r\n\r\n\u00a0F\r\n😀а');
 assert.equal(result.text,'  Мама\n\n😀а');
 assert.deepEqual(result.chords,{'0:-1':'Am','0:6':'G','2:1':'F'});
 assert.equal(importChordText('Am\rа').text,'а');
});

test('import retains standalone tracks, headings and unknown text without deletion',()=>{
 const result=importChordText('Am G\n\nПрипев:\n Am\nМама\nF C\nG');
 assert.equal(result.text,'Am G\n\nПрипев:\nМама\nF C\nG');
 assert.deepEqual(result.chords,{'3:1':'Am'});
 assert.equal(result.retained,3);
 const unknown=importChordText('C6/9 ?\n Am\nМама');
 assert.equal(unknown.text,'C6/9 ?\nМама');
});

test('import refuses missing tracks and conflicting positions without returning partial data',()=>{
 for(const source of ['Мама дома','Am G','Am\n\nМама'])assert.throws(()=>importChordText(source),/Не найдены/);
 assert.throws(()=>importChordText('C D\nбаббб'),/Строка 1/);
 assert.throws(()=>importChordText('Am\nжжж'),/не помещаются/);
 assert.throws(()=>importChordText('Am\nМама\nC D\nбаббб'),/Строка 3/);
});

test('H chords import unchanged, transpose as B and work in slash bass',async()=>{
 const {transposeChord}=await import('../dist/core.js');
 const result=importChordText(' Hm   F#/H\nМама дома');
 assert.deepEqual(result.chords,{'0:1':'Hm','0:6':'F#/H'});
 assert.equal(transposeChord('Hm',1),'Cm');
 assert.equal(transposeChord('H7',-1,'flats'),'Bb7');
 assert.equal(transposeChord('F#/H',1),'G/C');
 assert.equal(transposeChord('B',0),'B');
 assert.equal(transposeChord('H',0),'B');
});
test('vowels in both alphabets, case, edges and empty verses',()=>{
 const text='Аё Я\n\nAEy\nритм';
 assert.deepEqual(positions(text).map(p=>p.key),['0:-1','0:0','0:1','0:3','0:4','2:-1','2:0','2:1','2:2','2:3','3:-1','3:1','3:4']);
});
test('adjacent long chords stretch lyrics and preserve exact anchors',()=>{
 const chords={'0:-1':'Amaj7','0:0':'F#madd9','0:1':'Cmaj7/G','0:2':'G7sus4'};
 const result=layout('ао',0,chords);
 assert.equal(result.track,'Amaj7 F#madd9 Cmaj7/G  G7sus4');
 assert.equal(result.text,'      а       о');
 for(const index of [0,1]) assert.equal(result.text[result.columns[index]],Array.from('ао')[index]);
 assert.deepEqual(chords,{'0:-1':'Amaj7','0:0':'F#madd9','0:1':'Cmaj7/G','0:2':'G7sus4'});
});
test('export keeps blank lines and title',()=>{
 assert.equal(exportTxt({title:'Песня',text:'Мама\n\nYou\n',chords:{'0:1':'Am','2:1':'Fmaj7'}}),'Песня\n\n Am\nМама\n\n Fmaj7\nYou\n\n');
});

test('export includes optional author directly below title',()=>{
 assert.equal(exportTxt({title:'Песня',author:'  Автор  ',text:'Мама',chords:{}}),'Песня\nАвтор\n\nМама\n');
 assert.equal(exportTxt({title:'Песня',author:'',text:'Мама',chords:{}}),'Песня\n\nМама\n');
});

test('export appends multiline notes without chord tracks or changing song data',()=>{
 const song={title:'Песня',author:'Автор',text:'Мама\nдома',chords:{'0:1':'Am'},notes:'Тише\n\nПовторить дважды'};
 const snapshot=JSON.stringify(song);
 assert.equal(exportTxt(song),'Песня\nАвтор\n\n Am\nМама\nдома\n\nТише\n\nПовторить дважды\n');
 assert.equal(JSON.stringify(song),snapshot);
 assert.equal(exportTxt({...song,notes:''}),exportTxt({...song,notes:undefined}));
 assert.equal(exportTxt({...song,notes:'  \n'}),exportTxt({...song,notes:undefined}));
 assert.equal(exportTxt({title:'Песня',text:'',chords:{},notes:'Примечание'}),'Песня\n\nПримечание\n');
});

test('export filenames use safe titles and distinguish duplicate names',()=>{
 assert.equal(exportFilename('Моя песня'),'Моя песня.txt');
 assert.equal(exportFilename('Моя песня',['Моя песня.txt']),'Моя песня (2).txt');
 assert.equal(exportFilename('моя песня',['Моя песня.txt','моя песня (2).txt']),'моя песня (3).txt');
 assert.equal(exportFilename('../Песня: тест?'),'.._Песня_ тест_.txt');
 assert.equal(exportFilename('CON'),'_CON.txt');
 assert.equal(exportFilename('...'),'Песня.txt');
 assert.ok(Buffer.byteLength(exportFilename('🎵'.repeat(100)))<255);
});


test('transpose roots, accidentals, extensions and slash bass while preserving unknown labels', async () => {
 const {transposeChord,dictionary}=await import('../dist/core.js');
 for(const [value,steps,expected] of [['B',1,'C'],['C',-1,'B'],['F#madd9',1,'Gmadd9'],['Cmaj7/G',-1,'Bmaj7/F#'],['Bb7/Db',1,'B7/D'],['C♯m',1,'Dm'],['G7(b9)',1,'G#7(b9)'],['C6/9',1,null],['Intro',1,null],['Chorus',-1,null]])assert.equal(transposeChord(value,steps),expected,value);
 for(const chord of dictionary)assert.notEqual(transposeChord(chord,1),null,chord);
});


test('spelling choice consistently controls roots and bass without altering extensions or pitch',async()=>{
 const {transposeChord}=await import('../dist/core.js');
 assert.deepEqual(['C','F','G','Am'].map(chord=>transposeChord(chord,1,'flats')),['Db','Gb','Ab','Bbm']);
 assert.deepEqual(['C','F','G','Am'].map(chord=>transposeChord(chord,1,'sharps')),['C#','F#','G#','A#m']);
 assert.equal(transposeChord('C#m/G#',0,'flats'),'Dbm/Ab');
 assert.equal(transposeChord('Dbm/Ab',0,'sharps'),'C#m/G#');
 assert.equal(transposeChord('Bb7/Db',0,'sharps'),'A#7/C#');
 assert.equal(transposeChord('Cmaj7/G',-1,'flats'),'Bmaj7/Gb');
 assert.equal(transposeChord('G#7(b9)',0,'flats'),'Ab7(b9)');
 assert.equal(transposeChord('F♯m/C♯',0,'flats'),'Gbm/Db');
 assert.equal(transposeChord('Am',0,'flats'),'Am');
 assert.equal(transposeChord('Intro',0,'flats'),null);
 const roots=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
 for(const spelling of ['flats','sharps'])for(const root of roots)for(const step of [-1,1]){
   const shifted=transposeChord(root+'m/'+root,step,spelling);
   assert.equal(transposeChord(shifted,-step,'sharps'),root+'m/'+root);
 }
});


test('trailing chords add a new slot and keep two spaces after lyrics and chords',()=>{
 const chords={'0:4':'Am','0:5':'G7','0:6':'F'};
 assert.deepEqual(positions('Мама',chords).map(p=>p.index),[-1,1,3,4,5,6,7]);
 const result=layout('Мама',0,chords,2);
 assert.equal(result.text,'  Мама');
 assert.equal(result.track,'        Am  G7  F');
 assert.equal(result.columns[7],19);
 assert.equal(exportTxt({title:'Песня',text:'Мама',chords}),'Песня\n\n      Am  G7  F\nМама\n');
 const remaining={'0:4':'Am','0:6':'F'};
 assert.deepEqual(positions('Мама',remaining).map(p=>p.index),[-1,1,3,4,6,7]);
 assert.equal(layout('Мама',0,remaining).track,'      Am  F');
 assert.deepEqual(importChordText('      Am  G7  F\nМама').chords,chords);
});

test('two-column preview balances rows, retains chord pairs and aligns separator', async()=>{
  const {twoColumnTxt}=await import('../dist/core.js');
  const song={title:'Песня',author:'Автор',text:'Мама\nДома\nРама\nЛама',chords:{'0:1':'Am'},notes:'Примечание'};
  const result=twoColumnTxt(song,2);
  const rows=result.split('\n').filter(line=>line.includes('|'));
  assert.equal(rows.length,3);
  assert.ok(rows[0].includes('Am'));
  assert.ok(rows[1].includes('Мама'));
  assert.ok(rows.every(line=>line.indexOf('|')===rows[0].indexOf('|')));
  assert.ok(rows.every(line=>line.includes('  |  ')));
  assert.ok(result.startsWith('Песня\nАвтор\n\n'));
  assert.ok(result.endsWith('\n\nПримечание\n'));
  assert.ok(twoColumnTxt(song,0).includes(' | '));
});
