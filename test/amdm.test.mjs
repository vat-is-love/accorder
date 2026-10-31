import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAmdmHtml} from '../dist/amdm.js';
import {positions, exportTxt} from '../dist/core.js';
import {normalizeSong} from '../dist/storage.js';

// Synthetic song: retain AMDM's HTML structure without storing anyone's lyrics.
const page = `<html><head><title>Лишний заголовок</title></head><body>
<nav>Меню сайта</nav>
<h1><a href="/akkordi/author/"><span itemprop="name">Автор &amp; группа</span></a> - <span itemprop="name">Название…</span>, аккорды</h1>
<pre>Не песня</pre><pre class="lyrics" itemprop="chordsBlock">[Куплет]:
 <b>Hm</b>   <b>F#7/H</b>
Мама дома

[Проигрыш]:
<b>H</b> <b>F#</b>
[Куплет]:
 <b>H7</b>
Мама
</pre><footer>Лишние ссылки</footer></body></html>`;

test('AMDM HTML imports metadata and spaced chord tracks, preserving standalone parts',()=>{
  const result = parseAmdmHtml(page);
  assert.equal(result.title, 'Название…');
  assert.equal(result.author, 'Автор & группа');
  assert.equal(result.text, '[Куплет]:\nМама дома\n\n[Проигрыш]:\nH F#\n[Куплет]:\nМама');
  assert.deepEqual(result.chords, {'1:1':'Hm', '1:6':'F#7/H', '6:1':'H7'});
  assert.equal(result.imported, 3);
  assert.equal(result.retained, 1);
  const valid = new Set(positions(result.text).map(p=>p.key));
  for (const key of Object.keys(result.chords)) assert.ok(valid.has(key));
  const song = normalizeSong(result, {newId:()=> 'a89eab18-3f8d-4eb3-85b1-de3da90b022a'});
  assert.match(exportTxt(song), /Автор & группа/);
  assert.match(exportTxt(song), /F#7\/H/);
});

test('saved AMDM keyword blocks separate headings from inline chord divs',()=>{
  const chord = value => `<div class="podbor__chord" data-chord="${value}"><span>${value}</span></div>`;
  const html = `<h1><span class="fa fa-check-circle tooltip" aria-hidden="true"></span>
    <span itemprop="byArtist">Автор</span> - <span itemprop="name">Песня</span>, аккорды</h1>
    <pre itemprop="chordsBlock" class="field__podbor_new podbor__text"><div class="podbor__keyword hidden">[Куплет]:</div> ${chord('Hm')}   ${chord('F#')}
Мама дома

<div class="podbor__keyword hidden">[Проигрыш]:</div>${chord('H')} ${chord('F#')}

<div class='hidden podbor__keyword'>[Куплет]:</div> ${chord('H7')}   ${chord('Em')}
Мама дома
</pre>`;
  const result = parseAmdmHtml(html);
  assert.equal(result.author, 'Автор');
  assert.equal(result.title, 'Песня');
  assert.equal(result.text, '[Куплет]:\nМама дома\n\n[Проигрыш]:\nH F#\n\n[Куплет]:\nМама дома');
  assert.deepEqual(result.chords, {'1:1':'Hm', '1:6':'F#', '7:1':'H7', '7:6':'Em'});
  assert.equal(result.imported, 4);
  assert.equal(result.retained, 1);
  // An existing newline after a block must not add a blank verse line.
  const separated = html.replace('</div> '+chord('Hm'), '</div>\n '+chord('Hm'));
  assert.deepEqual(parseAmdmHtml(separated), result);
});

test('HTML entities, inline formatting, br and alternate quoting preserve text columns',()=>{
  const html = `<h1><a itemprop='name'>А&#1074;тор</a> - <span itemprop=name>Название &quot;А&quot;</span>, аккорды</h1><pre itemprop='chordsBlock'> <b>H</b><br>М&#x430;ма &lt;текст&gt;<br><br>&nbsp;<b>G</b><br>Дома</pre>`;
  const result = parseAmdmHtml(html);
  assert.equal(result.author, 'Автор');
  assert.equal(result.title, 'Название "А"');
  assert.equal(result.text, 'Мама <текст>\n\nДома');
  assert.deepEqual(result.chords, {'0:1':'H', '2:1':'G'});
});

test('flat headings work and active HTML is never imported or executed',()=>{
  const result = parseAmdmHtml(`<script><h1>Поддельный заголовок</h1></script><!-- <pre itemprop="chordsBlock">Пусто</pre> --><h1>Автор - Название, аккорды</h1><pre itemprop="chordsBlock"> <b onclick="alert(1)">H</b>\nМама<script>throw Error('bad')</script></pre>`);
  assert.equal(result.author, 'Автор');
  assert.equal(result.title, 'Название');
  assert.equal(result.text, 'Мама');
  assert.deepEqual(result.chords, {'0:1':'H'});
});

test('unrecognized, oversized and conflicting pages fail before applying any song fields',()=>{
  for (const html of ['', '<h1>Защита сайта</h1>', '<h1>Автор - Песня</h1><pre>Текст</pre>']) assert.throws(()=>parseAmdmHtml(html), /не найдены/);
  assert.throws(()=>parseAmdmHtml('я'.repeat(1024*1024+1)), /слишком большая/);
  assert.throws(()=>parseAmdmHtml('<h1>Автор - Песня</h1><pre itemprop="chordsBlock">C D\nбаббб</pre>'), /не помещаются/);
});
