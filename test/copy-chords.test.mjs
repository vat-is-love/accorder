import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyChordRows,planChordPaste,positions} from '../dist/core.js';

test('copy uses Unicode vowel ordinals and preserves both edges and line gaps',()=>{
 const text='😀Мама\n\nДома\nЯ иду\n\nЛето';
 const chords={'0:-1':'Am','0:4':'G','0:5':'F','0:6':'C','2:1':'Dm','3:0':'Em'};
 const copy=copyChordRows(text,chords,0,2);
 const plan=planChordPaste(text,chords,copy,3);
 assert.deepEqual(plan.additions,{'3:-1':'Am','3:2':'G','3:5':'F','3:6':'C','5:1':'Dm'});
 assert.equal(plan.replacements,0);assert.deepEqual(plan.issues,[]);
 const merged={...chords,...plan.additions},valid=new Set(positions(text,merged).map(p=>p.key));
 for(const key of Object.keys(merged))assert.ok(valid.has(key),key);
 assert.equal(merged['3:0'],'Em');
});
test('paste reports missing vowels, blocked rows, end of text and replacements without mutation',()=>{
 const copied=copyChordRows('Мама\nМама\nМама\nМама',{'0:1':'Am','0:3':'G','1:1':'F','2:1':'C','3:1':'Dm'},0,3);
 const chords={'0:0':'Em'},before={...chords};
 const plan=planChordPaste('Я\n!Припев\n',chords,copied,0);
 assert.deepEqual(plan.additions,{'0:0':'Am'});
 assert.equal(plan.replacements,1);assert.equal(plan.issues.length,4);
 assert.deepEqual(chords,before);
});
