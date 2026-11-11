export const vowels = /[аеёиоуыэюяaeiouy]/iu;
export const isTextOnlyLine = line => line.startsWith('!');
function trailingPositions(line, row, chords) {
  const end = Array.from(line).length, indices = new Set([end]);
  for (const key of Object.keys(chords)) {
    const [r, index] = key.split(':').map(Number);
    if (r === row && Number.isSafeInteger(index) && index >= end && index < Number.MAX_SAFE_INTEGER - 1 && key === `${row}:${index}`) indices.add(index);
  }
  const sorted = [...indices].sort((a,b) => a-b), last = sorted.at(-1);
  if (chords[`${row}:${last}`]) sorted.push(last + 1);
  return sorted;
}
export function positions(text, chords = {}, firstRow = 0) {
  return text.split('\n').flatMap((line, offset) => {
    if (!line.length || isTextOnlyLine(line)) return [];
    const row = firstRow + offset;
    return [-1, ...Array.from(line).flatMap((c, i) => vowels.test(c) ? [i] : []), ...trailingPositions(line, row, chords)]
      .map(index => ({row,index,key:`${row}:${index}`}));
  });
}
export function layout(line, row, chords, lyricIndent = 0) {
  if (isTextOnlyLine(line)) {
    const text = ' '.repeat(lyricIndent) + line.slice(1).replace(/^ /u, '');
    return {text,track:'',columns:{},width:text.length+2};
  }
  const chars = Array.from(line);
  let text = '', track = '', lastEnd = -1;
  const columns = {};
  function put(index, column = text.length) {
    const key = `${row}:${index}`, chord = chords[key] || '';
    if (chord && column <= lastEnd) column = lastEnd + 1;
    if (index < chars.length) text = text.padEnd(column, ' ');
    columns[index] = column;
    if (chord) {
      track = track.padEnd(column, ' ') + chord;
      lastEnd = column + chord.length;
    }
  }
  put(-1);
  if (lyricIndent > 0) text = text.padEnd(Math.max(lyricIndent, lastEnd + 1), ' ');
  chars.forEach((c,i) => { if (vowels.test(c)) put(i); text += c; });
  let column = Math.max(text.length + 2, lastEnd + 2);
  for (const index of trailingPositions(line, row, chords)) {
    put(index, column);
    column += (chords[`${row}:${index}`] || '·').length + 2;
  }
  return {text,track,columns,width:Math.max(text.length,track.length,column-2)+2};
}
export function exportTxt(song) {
  const author = (song.author || '').trim();
  const text = song.text.split('\n').map((line,row) => {
    if (!line) return '';
    const result = layout(line,row,song.chords);
    const track = result.track.trimEnd();
    return track ? track + '\n' + result.text : result.text;
  }).join('\n');
  const notes = song.notes || '';
  return song.title + (author ? '\n' + author : '') + '\n\n' + text + (notes.trim() ? (text ? '\n\n' : '') + notes : '') + '\n';
}
export const dictionary = ['A','B','C','D','E','F','G','H'].flatMap(root => ['', '#', 'b'].flatMap(acc => ['', 'm','7','m7','maj7','sus2','sus4','dim','aug','add9','9','m9','6'].map(type => root+acc+type)));

// Plain-text chord tracks use character columns, before layout adds spacing.
export function importChordText(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(line => {
    let expanded = '', column = 0;
    for (const char of line) {
      const value = char === '\t' ? ' '.repeat(8 - column % 8) : char;
      expanded += value; column += char === '\t' ? value.length : 1;
    }
    return expanded.replace(/\u00a0/g, ' ');
  });
  function track(line) {
    const tokens = Array.from(line.matchAll(/\S+/gu));
    return tokens.length && tokens.every(token => token[0].length <= 40 && transposeChord(token[0], 0) !== null)
      ? tokens.map(token => ({value:token[0], column:Array.from(line.slice(0, token.index)).length})) : null;
  }
  const text = [], chords = {};
  let imported = 0, retained = 0;
  for (let row = 0; row < lines.length; row++) {
    const tokens = track(lines[row]), next = lines[row + 1];
    if (!tokens || !next?.trim() || isTextOnlyLine(next) || track(next) || /^\s*\[[^\]\n]+\]\s*:?\s*$/u.test(next)) {
      text.push(lines[row]);
      if (tokens) retained++;
      continue;
    }
    const chars = Array.from(next), first = chars.findIndex(char => /\S/u.test(char));
    let end = chars.length;
    while (end > 0 && /\s/u.test(chars[end - 1])) end--;
    const anchors = chars.flatMap((char,index) => vowels.test(char) ? [index] : []);
    const used = new Set();
    for (const token of tokens) {
      let index;
      if (token.column < first) index = -1;
      else if (token.column >= end) {
        index = chars.length;
        while (used.has(index)) index++;
      }
      else index = anchors.reduce((best, candidate) => best === null || Math.abs(candidate - token.column) < Math.abs(best - token.column) ? candidate : best, null);
      if (index === null || used.has(index)) throw new Error(`Строка ${row + 1}: аккорды не помещаются в доступные позиции. Исправьте их расположение и повторите импорт.`);
      used.add(index);
      chords[`${text.length}:${index}`] = token.value;
      imported++;
    }
    text.push(next);
    row++;
  }
  if (!imported) throw new Error('Не найдены строки аккордов над текстом. Вставьте аккорды отдельными строками над словами.');
  return {text:text.join('\n'), chords, imported, retained};
}

// Match whole words first; only small edits within a matched word use character
// alignment. This prevents a rewritten word from inheriting a coincidental vowel.
export function remapChords(oldText, newText, chords) {
  if (oldText === newText) {
    const lines = newText.split('\n');
    return Object.fromEntries(Object.entries(chords).filter(([key]) => !isTextOnlyLine(lines[Number(key.split(':')[0])] || '')));
  }
  const oldChars = Array.from(oldText), newChars = Array.from(newText);
  const wordChar = /[\p{L}\p{M}\p{N}]/u;
  function words(chars) {
    const result = [];
    for (let i = 0; i < chars.length;) {
      if (!wordChar.test(chars[i])) {i++; continue;}
      const start = i;
      while (i < chars.length && wordChar.test(chars[i])) i++;
      result.push({start, end:i, value:chars.slice(start,i).join('')});
    }
    return result;
  }
  const oldWords = words(oldChars), newWords = words(newChars);
  const charMap = new Map(), pairs = [];
  let budget = 2000000;
  // Return only matches present in every optimal alignment. Repeated words or
  // letters with several equally good destinations are deliberately left out.
  function certainMatches(a, b) {
    const n=a.length, m=b.length, cells=(n+1)*(m+1);
    if (cells > 300000 || cells > budget) return null;
    budget -= cells;
    const before=new Uint32Array(cells), after=new Uint32Array(cells), stride=m+1;
    for(let i=0;i<n;i++)for(let j=0;j<m;j++)
      before[(i+1)*stride+j+1]=a[i]===b[j]?before[i*stride+j]+1:Math.max(before[i*stride+j+1],before[(i+1)*stride+j]);
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
      after[i*stride+j]=a[i]===b[j]?after[(i+1)*stride+j+1]+1:Math.max(after[(i+1)*stride+j],after[i*stride+j+1]);
    const length=after[0], result=[];
    for(let i=0;i<n;i++) {
      let target=-1, ambiguous=false, removable=false;
      for(let j=0;j<=m;j++) {
        if(before[i*stride+j]+after[(i+1)*stride+j]===length)removable=true;
        if(j<m&&a[i]===b[j]&&before[i*stride+j]+1+after[(i+1)*stride+j+1]===length) {
          if(target!==-1)ambiguous=true;
          target=j;
        }
      }
      if(target!==-1&&!ambiguous&&!removable)result.push([i,target]);
    }
    return result;
  }
  function align(a0,a1,b0,b1,depth=0) {
    if(a0===a1||b0===b1)return;
    const exact=certainMatches(oldWords.slice(a0,a1).map(w=>w.value),newWords.slice(b0,b1).map(w=>w.value));
    if(exact) {for(const [i,j] of exact)pairs.push([a0+i,b0+j]);return;}
    if(depth>=16)return;
    // Large gaps use unique words in order as anchors, then bounded local LCS.
    // No whole-song quadratic matrix, and no guessing when the budget runs out.
    const occurrences=(list,start,end)=>{
      const map=new Map();
      for(let i=start;i<end;i++)map.set(list[i].value,map.has(list[i].value)?-1:i);
      return map;
    };
    const left=occurrences(oldWords,a0,a1),right=occurrences(newWords,b0,b1), candidates=[];
    for(const [word,i] of left)if(i>=0&&Array.from(word).length>=3&&right.get(word)>=0)candidates.push([i,right.get(word)]);
    const tails=[], previous=new Int32Array(candidates.length).fill(-1);
    for(let k=0;k<candidates.length;k++) {
      let lo=0,hi=tails.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(candidates[tails[mid]][1]<candidates[k][1])lo=mid+1;else hi=mid;}
      if(lo)previous[k]=tails[lo-1];tails[lo]=k;
    }
    const anchors=[];
    for(let k=tails.at(-1);k!==undefined&&k>=0;k=previous[k])anchors.push(candidates[k]);
    anchors.reverse();
    let ai=a0,bi=b0;
    for(const [i,j] of anchors){align(ai,i,bi,j,depth+1);pairs.push([i,j]);ai=i+1;bi=j+1;}
    if(anchors.length)align(ai,a1,bi,b1,depth+1);
  }
  align(0,oldWords.length,0,newWords.length);
  pairs.sort((a,b)=>a[0]-b[0]);
  function mapWord(i,j) {
    const a=oldWords[i],b=newWords[j];
    for(let k=0;k<a.end-a.start;k++)charMap.set(a.start+k,b.start+k);
  }
  for(const [i,j] of pairs)mapWord(i,j);
  function mapGap(a0,a1,b0,b1) {
    const a=oldWords.slice(a0,a1),b=newWords.slice(b0,b1);
    if(!a.length||!b.length||a.length>4||b.length>4)return;
    const av=a.map(w=>w.value).join(''),bv=b.map(w=>w.value).join('');
    const ac=Array.from(av),bc=Array.from(bv);
    if(Math.max(ac.length,bc.length)>200)return;
    const offsets=ws=>ws.flatMap(w=>Array.from({length:w.end-w.start},(_,k)=>w.start+k));
    const ao=offsets(a),bo=offsets(b);
    if(av===bv) {
      // Only whitespace/line-boundary changes between these words.
      for(let k=0;k<ao.length;k++)charMap.set(ao[k],bo[k]);
    } else if(a.length===1&&b.length===1) {
      const matched=certainMatches(ac,bc);
      if(!matched)return;
      // At most one changed character, and at least two thirds of each word
      // unchanged. Short replacements and ambiguous repeated letters lose chords.
      const unchanged=matched.length;
      if(Math.min(ac.length,bc.length)<3||unchanged*3<Math.max(ac.length,bc.length)*2||Math.max(ac.length,bc.length)-unchanged>1)return;
      for(const [i,j] of matched)charMap.set(ao[i],bo[j]);
    }
  }
  let ai=0,bi=0;
  for(const [i,j] of pairs){mapGap(ai,i,bi,j);ai=i+1;bi=j+1;}
  mapGap(ai,oldWords.length,bi,newWords.length);
  function rows(chars) {
    const result=[],locations=[];
    let row=0,index=0,start=0;
    for(let i=0;i<=chars.length;i++) {
      if(i===chars.length||chars[i]==='\n') {
        const letters=[];
        for(let k=start;k<i;k++)if(wordChar.test(chars[k]))letters.push(k);
        result.push({start,length:i-start,first:letters[0],last:letters.at(-1),textOnly:chars[start]==='!'});
        row++;index=0;start=i+1;
      } else {locations[i]={row,index};index++;}
    }
    return {lines:result,locations};
  }
  const oldRows=rows(oldChars),newRows=rows(newChars),result={},collisions=new Set();
  for(const [key,chord] of Object.entries(chords)) {
    const [row,index]=key.split(':').map(Number),line=oldRows.lines[row];
    if(!line||line.textOnly)continue;
    let target;
    if(index===-1||index>=line.length) {
      const at=index===-1?line.first:line.last;
      const mapped=charMap.get(at),place=newRows.locations[mapped];
      if(!place)continue;
      const next=newRows.lines[place.row];
      if(next.textOnly)continue;
      if(mapped!==(index===-1?next.first:next.last))continue;
      target=`${place.row}:${index===-1?-1:next.length+index-line.length}`;
    } else {
      if(index<0||index>=line.length||!vowels.test(oldChars[line.start+index]))continue;
      const mapped=charMap.get(line.start+index),place=newRows.locations[mapped];
      if(!place||newRows.lines[place.row].textOnly||!vowels.test(newChars[mapped]))continue;
      target=`${place.row}:${place.index}`;
    }
    if(Object.hasOwn(result,target)){delete result[target];collisions.add(target);}
    else if(!collisions.has(target))result[target]=chord;
  }
  return result;
}

export function exportFilename(title, occupied = []) {
  let stem = title.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim() || 'Песня';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  const chars = Array.from(stem);
  while (new TextEncoder().encode(chars.join('')).length > 180) chars.pop();
  stem = chars.join('');
  const used = new Set(occupied.map(name => name.normalize('NFC').toLowerCase()));
  let filename = stem + '.txt', suffix = 2;
  while (used.has(filename.toLowerCase())) filename = `${stem} (${suffix++}).txt`;
  return filename;
}

// Only recognized chord syntax is transposed; arbitrary user labels stay intact.
export function transposeChord(chord, steps, spelling = 'sharps') {
  const match = chord.match(/^([A-H])([#b♯♭]?)(?:(m|maj|min|dim|aug|sus|add|M|Δ|ø|°|\+|-)?([0-9]*(?:(?:maj|sus|add|[#b♯♭])[0-9]+)*(?:\([0-9,#b♯♭+\-]+\))?))(?:\/([A-H])([#b♯♭]?))?$/u);
  if (!match) return null;
  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const flats = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const shift = (root, accidental) => {
    const index = {C:0,D:2,E:4,F:5,G:7,A:9,B:11,H:11}[root] + (/[#♯]/u.test(accidental) ? 1 : /[b♭]/u.test(accidental) ? -1 : 0);
    return (spelling === 'flats' ? flats : notes)[((index + steps) % 12 + 12) % 12];
  };
  return shift(match[1], match[2]) + (match[3] || '') + match[4] + (match[5] ? '/' + shift(match[5], match[6]) : '');
}

// Typed fragments keep chord styling separate from lyrics, including in two columns.
export function previewRows(song, columns = false, gap = 1, separator = false) {
  const blocks = song.text.split('\n').map((line,row) => {
    if (!line) return [{text:'',chord:false}];
    const result = layout(line,row,song.chords),track=result.track.trimEnd();
    return [...(track ? [{text:track,chord:true}] : []),{text:result.text,chord:false}];
  });
  let rows=blocks.flat().map(part=>[part]);
  if(columns){
    const total=blocks.reduce((sum,block)=>sum+block.length,0);
    let split=0,height=0;
    while(split<blocks.length && Math.abs(total-2*(height+blocks[split].length))<=Math.abs(total-2*height))height+=blocks[split++].length;
    const left=blocks.slice(0,split).flat(),right=blocks.slice(split).flat();
    const width=blocks.flat().reduce((max,part)=>Math.max(max,Array.from(part.text).length),0);
    const spaces=' '.repeat(Math.max(1,Math.floor(gap)||1));
    rows=Array.from({length:Math.max(left.length,right.length)},(_,i)=>{
      const part=left[i]||{text:'',chord:false};
      return [part,{text:' '.repeat(width-Array.from(part.text).length)+spaces+(separator?'|':'')+spaces,chord:false},right[i]||{text:'',chord:false}];
    });
  }
  const plain=text=>[{text,chord:false}],author=(song.author||'').trim(),notes=song.notes||'';
  if(!columns&&!song.text&&notes.trim())rows=[];
  return [plain(song.title),...(author?[plain(author)]:[]),plain(''),...rows,
    ...(notes.trim()?[...(columns||song.text?[plain('')]:[]),...notes.split('\n').map(plain)]:[]),plain('')];
}

// Balance rendered rows without separating a chord track from its lyric.
export function twoColumnTxt(song, gap = 1, separator = false) {
  return previewRows(song,true,gap,separator).map(row=>row.map(part=>part.text).join('')).join('\n');
}

// Copy anchors by vowel ordinal, preserving line offsets and edge positions.
export function copyChordRows(text, chords, start, end) {
  const lines=text.split('\n');
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=lines.length) throw new Error('Выберите строки.');
  return lines.slice(start,end+1).map((line,offset)=>{
    const chars=Array.from(line), anchors=chars.flatMap((c,i)=>vowels.test(c)?[i]:[]);
    return Object.entries(chords).filter(([key])=>Number(key.split(':')[0])===start+offset).map(([key,value])=>{
      const index=Number(key.split(':')[1]);
      return {value,edge:index===-1?'before':index>=chars.length?'after':null,position:index>=chars.length?index-chars.length:anchors.indexOf(index)};
    });
  });
}
export function planChordPaste(text, chords, copied, start) {
  const lines=text.split('\n'), additions={}, issues=[];
  let replacements=0;
  copied.forEach((entries,offset)=>{
    const row=start+offset,line=lines[row];
    if(line===undefined||!line.length||isTextOnlyLine(line)){
      if(entries.length)issues.push(`Строка ${row+1}: ${line===undefined?'за концом текста':'нет позиций для аккордов'} (${entries.length}).`);
      return;
    }
    const chars=Array.from(line),anchors=chars.flatMap((c,i)=>vowels.test(c)?[i]:[]);
    for(const entry of entries){
      const index=entry.edge==='before'?-1:entry.edge==='after'?chars.length+entry.position:anchors[entry.position];
      if(index===undefined){issues.push(`Строка ${row+1}: нет гласной №${entry.position+1} для ${entry.value}.`);continue;}
      const key=`${row}:${index}`;
      additions[key]=entry.value;
      if(chords[key]&&chords[key]!==entry.value)replacements++;
    }
  });
  return {additions,issues,replacements};
}
