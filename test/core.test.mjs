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
