import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positions,layout,exportTxt,exportFilename} from '../dist/core.js';
test('vowels in both alphabets, case, edges and empty verses',()=>{
 const text='Аё Я\n\nAEy\nритм';
 assert.deepEqual(positions(text).map(p=>p.key),['0:-1','0:0','0:1','0:3','0:4','2:-1','2:0','2:1','2:2','2:3','3:-1','3:1','3:4']);
});
test('adjacent long chords stretch lyrics and preserve exact anchors',()=>{
 const chords={'0:-1':'Amaj7','0:0':'F#madd9','0:1':'Cmaj7/G','0:2':'G7sus4'};
 const result=layout('ао',0,chords);
 assert.equal(result.track,'Amaj7 F#madd9 Cmaj7/G G7sus4');
 assert.equal(result.text,'      а       о       ');
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
