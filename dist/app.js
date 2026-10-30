import {positions,layout,exportTxt,exportFilename,dictionary,remapChords} from './core.js';
import {BrowserLibrary,FileLibrary,parseImport} from './storage.js';
import {zipTxtFiles} from './archive.js';
const $=id=>document.getElementById(id);
const browserMode=document.documentElement.dataset.storage!=='files';
const storage=browserMode?new BrowserLibrary({name:'accorder:'+new URL('.',location.href).pathname}):new FileLibrary();
$('browser-tools').hidden=!browserMode;
$('storage-note').textContent=browserMode?'Песни хранятся в этом браузере':'Песни хранятся в папке songs/';
let song=null, selected=null, dirty=false, matches=[], choice=-1, closed=false;
const status=message=>{$('status').textContent=message;};
function changed(){dirty=true;status('Есть несохранённые изменения');}
async function library(){
  const list=await storage.list(); $('count').textContent=list.length; $('library').replaceChildren();
  if(!list.length){const p=document.createElement('p');p.className='empty-library';p.textContent='Нет сохранённых песен';$('library').append(p);}
  for(const item of list){
    const button=document.createElement('button');button.textContent=item.title;
    const small=document.createElement('small');small.textContent=new Date(item.updatedAt).toLocaleDateString('ru-RU');button.append(small);
    button.classList.toggle('active',song?.id===item.id);
    button.onclick=async()=>{if(!canLeave())return;try{show(await storage.get(item.id));await library();}catch(e){status(e.message);}};
    $('library').append(button);
  }
}
function canLeave(){if(!commit())return false;return !dirty||confirm('Есть несохранённые изменения. Перейти без сохранения?');}
function show(value){
  song=value;selected=null;dirty=false;$('welcome').hidden=true;$('editor').hidden=false;
  $('title').value=song.title;$('author').value=song.author||'';$('notes').value=song.notes||'';$('source').value=song.text;$('source-panel').open=!song.text;
  $('chord-editor').hidden=true;closeSuggestions();render();status(song.id?'Песня открыта':'Новая песня · ещё не сохранена');
}
function fresh(){if(canLeave()){show({title:'',author:'',text:'',notes:'',chords:{}});$('title').focus();library().catch(e=>status(e.message));}}
$('new').onclick=fresh;$('first').onclick=fresh;
function render(){
  // Keep the one real input alive when rebuilding the score.
  $('editor').append($('chord-editor'));
  $('score').replaceChildren();
  if(!song.text){$('score').textContent='Добавьте текст песни выше и нажмите «Применить текст».';renderNotes();return;}
  const all=positions(song.text);
  song.text.split('\n').forEach((line,row)=>{
    const wrapper=document.createElement('div');wrapper.className=line?'song-line':'blank';wrapper.dataset.row=row;
    if(line){
      const result=layout(line,row,song.chords,2);wrapper.style.width=`${result.width}ch`;
      const lyric=document.createElement('div');lyric.className='lyric';lyric.textContent=result.text;wrapper.append(lyric);
      for(const pos of all.filter(p=>p.row===row)){
        const button=document.createElement('button');const chord=song.chords[pos.key];
        button.className='slot '+(chord?'filled':'empty')+(selected?.key===pos.key?' selected':'');
        button.textContent=chord||'·';button.style.left=`${result.columns[pos.index]}ch`;
        button.dataset.position=pos.key;
        const place=pos.index===-1?'перед строкой':pos.index===Array.from(line).length?'после строки':`буква «${Array.from(line)[pos.index]}», позиция ${pos.index+1}`;
        button.setAttribute('aria-label',`Строка ${row+1}, ${place}${chord?', аккорд '+chord:', добавить аккорд'}`);
        button.onclick=()=>select(pos);wrapper.append(button);
      }
    }
    $('score').append(wrapper);
  });
  renderNotes();placeEditor();
}
function renderNotes(){
  let notes=$('score').querySelector('.score-notes');
  const text=song.notes||'';
  if(!text.trim()){notes?.remove();return;}
  if(!notes){notes=document.createElement('div');notes.className='score-notes';$('score').append(notes);}
  notes.textContent=text;
}
function placeEditor(){
  if(!selected)return;
  const row=$('score').querySelector(`[data-row="${selected.row}"]`);
  if(!row)return;
  if($('chord-editor').parentElement!==row)row.append($('chord-editor'));
  updateLine();
}
function updateLine(){
  if(!selected)return;
  const row=$('score').querySelector(`[data-row="${selected.row}"]`);
  if(!row)return;
  const draft={...song.chords};
  const value=$('chord').value.trim();
  if(value)draft[selected.key]=value;else delete draft[selected.key];
  const result=layout(song.text.split('\n')[selected.row],selected.row,draft,2);
  row.style.width=`${result.width}ch`;
  row.querySelector('.lyric').textContent=result.text;
  for(const slot of row.querySelectorAll('.slot')){
    const key=slot.dataset.position;
    slot.style.left=`${result.columns[Number(key.split(':')[1])]}ch`;
    slot.classList.toggle('selected',key===selected.key);
    slot.style.visibility=key===selected.key?'hidden':'';
    const chord=song.chords[key];
    slot.textContent=chord||'·';
    slot.setAttribute('aria-label',slot.getAttribute('aria-label').replace(/, (?:аккорд .*|добавить аккорд)$/,chord?', аккорд '+chord:', добавить аккорд'));
    slot.classList.toggle('filled',!!chord);slot.classList.toggle('empty',!chord);
  }
  $('chord-editor').style.left=`${result.columns[selected.index]}ch`;
  $('chord').style.width=`${Math.max(3,Array.from($('chord').value).length+1)}ch`;
  positionSuggestions();
}
function positionSuggestions(){
  if(!selected||$('chord-editor').hidden||$('suggestions').hidden)return;
  const input=$('chord').getBoundingClientRect();
  const lyric=$('score').querySelector(`[data-row="${selected.row}"] .lyric`).getBoundingClientRect();
  const popup=$('suggestions');
  // Fixed positioning keeps suggestions outside the score's overflow clipping.
  popup.style.left=`${Math.max(8,Math.min(input.left,window.innerWidth-popup.offsetWidth-8))}px`;
  const below=lyric.bottom+6;
  popup.style.top=`${below+popup.offsetHeight<=window.innerHeight-8?below:Math.max(8,input.top-popup.offsetHeight-6)}px`;
  popup.style.visibility=input.bottom<0||input.top>window.innerHeight?'hidden':'';
}
window.addEventListener('scroll',positionSuggestions,true);
window.addEventListener('resize',positionSuggestions);
function revealPosition(){
  const row=$('chord-editor').parentElement;
  const input=$('chord').getBoundingClientRect(), lyric=row.querySelector('.lyric').getBoundingClientRect();
  const score=$('score'), bounds=score.getBoundingClientRect();
  if(input.left<bounds.left+8)score.scrollLeft-=bounds.left+8-input.left;
  else if(input.right>bounds.right-8)score.scrollLeft+=input.right-bounds.right+8;
  if(input.top<0)window.scrollBy(0,input.top-8);
  else if(lyric.bottom>window.innerHeight)window.scrollBy(0,lyric.bottom-window.innerHeight+8);
}
function select(pos){
  if(!commit())return;
  const previous=selected;
  selected=pos;$('chord-editor').hidden=false;$('chord').value=song.chords[pos.key]||'';
  $('position-label').textContent=`строка ${pos.row+1} · ${pos.index===-1?'начало':pos.index===Array.from(song.text.split('\n')[pos.row]).length?'конец':'буква '+(pos.index+1)}`;
  $('chord').setAttribute('aria-label','Аккорд, '+$('position-label').textContent);
  if(previous){
    const slot=$('score').querySelector(`[data-position="${previous.key}"]`);
    if(slot){slot.style.visibility='';slot.classList.remove('selected');}
  }
  closed=true;closeSuggestions();placeEditor();
  $('chord').focus({preventScroll:true});$('chord').select();revealPosition();positionSuggestions();
}
function finishEditing(){
  if(!commit())return;
  const key=selected?.key;selected=null;$('chord-editor').hidden=true;render();
  if(key)$('score').querySelector(`[data-position="${key}"]`)?.focus({preventScroll:true});
}
function commit(){
  if(!song||!selected)return true;
  const value=$('chord').value.trim();
  if(/[\s\x00-\x1f\x7f]/u.test(value)){status('Обозначение аккорда должно быть без пробелов.');return false;}
  if(value!==(song.chords[selected.key]||'')){
    if(value)song.chords[selected.key]=value;else delete song.chords[selected.key];changed();updateLine();
  }
  return true;
}
function closeSuggestions(){matches=[];choice=-1;$('suggestions').hidden=true;$('chord').setAttribute('aria-expanded','false');$('chord').removeAttribute('aria-activedescendant');positionSuggestions();}
function suggestions(){
  closeSuggestions();const value=$('chord').value;
  if(!value||closed)return;
  matches=dictionary.filter(c=>c.toLowerCase().startsWith(value.toLowerCase())).slice(0,10);
  if(matches.length)drawSuggestions();
}
function drawSuggestions(){
  $('suggestions').replaceChildren();$('suggestions').hidden=false;$('chord').setAttribute('aria-expanded','true');
  matches.forEach((chord,index)=>{
    const item=document.createElement('li');item.id='suggestion-'+index;item.setAttribute('role','option');item.setAttribute('aria-selected',index===choice);item.textContent=chord;
    item.onmousedown=e=>e.preventDefault();item.onclick=()=>accept(index);$('suggestions').append(item);
  });
  positionSuggestions();
  if(choice>=0){
    $('chord').setAttribute('aria-activedescendant','suggestion-'+choice);
    const list=$('suggestions'),item=$('suggestion-'+choice);
    // Scroll only the list, never the song or the page.
    if(item.offsetTop<list.scrollTop)list.scrollTop=item.offsetTop;
    else if(item.offsetTop+item.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=item.offsetTop+item.offsetHeight-list.clientHeight;
  }
}
function accept(index){if(matches[index])$('chord').value=matches[index];closeSuggestions();closed=true;commit();updateLine();$('chord').focus({preventScroll:true});}
$('chord').oninput=()=>{closed=false;changed();updateLine();suggestions();};
$('chord').onblur=()=>{commit();closeSuggestions();};
$('chord').onkeydown=e=>{
  if(e.key==='Escape'){e.preventDefault();if(!$('suggestions').hidden){closed=true;closeSuggestions();}else finishEditing();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();if(!matches.length){closed=false;suggestions();}
    if(matches.length){choice=(choice+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;drawSuggestions();}return;
  }
  if(e.key==='Enter'){
    e.preventDefault();
    if(choice>=0&&matches[choice])$('chord').value=matches[choice];
    finishEditing();return;
  }
  if(e.key==='Tab'){
    if(!commit()){e.preventDefault();return;}
    closeSuggestions();const all=positions(song.text);const next=all.findIndex(p=>p.key===selected.key)+(e.shiftKey?-1:1);
    if(next>=0&&next<all.length){e.preventDefault();select(all[next]);}
    else {e.preventDefault();selected=null;$('chord-editor').hidden=true;render();(e.shiftKey?$('apply'):$('save')).focus({preventScroll:true});}
  }
};
$('title').oninput=()=>{song.title=$('title').value;changed();};
$('author').oninput=()=>{song.author=$('author').value;changed();};
$('notes').oninput=()=>{song.notes=$('notes').value;changed();renderNotes();};
$('source').oninput=changed;
function applyText(){
  if($('source').value===song.text)return true;
  const text=$('source').value;
  song.chords=remapChords(song.text,text,song.chords);
  song.text=text;selected=null;$('chord-editor').hidden=true;changed();render();$('source-panel').open=false;return true;
}
$('apply').onclick=()=>{if(commit())applyText();};
$('save').onclick=async()=>{
  if(!commit())return;
  if($('source').value!==song.text){status('Сначала примените изменения текста или верните исходный текст.');$('source-panel').open=true;$('apply').focus();return;}
  if(!song.title.trim()){status('Добавьте название песни.');$('title').focus();return;}
  $('save').disabled=true;
  const target=song, snapshot=JSON.stringify(song);
  try{
    const saved=await storage.save(song);
    if(song!==target){await library();return;}
    if(JSON.stringify(song)===snapshot){song=saved;dirty=false;status(browserMode?'Сохранено в браузере':'Сохранено на компьютере');}else{song.id=saved.id;status('Сохранено · есть новые изменения');}
    await library();
  }catch(e){status(e.message);}finally{$('save').disabled=false;}
};
$('export').onclick=()=>{
  if(!commit())return;
  if($('source').value!==song.text){status('Сначала примените изменения текста.');$('source-panel').open=true;return;}
  download(new Blob([exportTxt({...song,title:song.title||'Без названия'})],{type:'text/plain;charset=utf-8'}),exportFilename(song.title||'Песня'));
  status('TXT экспортирован · используйте моноширинный шрифт');
};
function download(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('backup').onclick=async()=>{
  try{download(new Blob([JSON.stringify(await storage.backup(),null,2)+'\n'],{type:'application/json;charset=utf-8'}),'accorder-library.json');status('JSON библиотеки экспортирован');}
  catch(error){status(error.message);}
};
$('all-txt').onclick=async()=>{
  try{
    const files=await storage.exportFiles();
    if(!files.length){status('Нет сохранённых песен');return;}
    download(zipTxtFiles(files),'accorder-exports.zip');status('TXT библиотеки экспортированы');
  }catch(error){status(error.message);}
};
$('import').onclick=()=>{if(canLeave())$('import-files').click();};
$('import-files').onchange=async()=>{
  const files=Array.from($('import-files').files);$('import-files').value='';
  if(!files.length)return;
  try{
    if(files.reduce((size,file)=>size+file.size,0)>10*1024*1024)throw new Error('Импорт слишком большой (максимум 10 МБ за один раз).');
    let imported=[];
    for(const file of files)imported.push(...parseImport(JSON.parse(await file.text())));
    imported=parseImport(imported);
    const existing=await storage.list(),ids=new Set(existing.map(song=>song.id));
    const overlaps=imported.filter(song=>ids.has(song.id)).length;
    if(overlaps&&!confirm(`Заменить сохранённые песни с совпадающими идентификаторами (${overlaps})?`))return;
    const saved=await storage.importSongs(imported,{overwrite:!!overlaps});
    // Keep any edits made while reading the selected files.
    if(!dirty&&saved.length)show(saved[0]);
    await library();status(`Импортировано песен: ${saved.length}`);
  }catch(error){status(error instanceof SyntaxError?'Некорректный JSON.':error.message);}
};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&song){event.preventDefault();$('save').click();}});
library().catch(e=>status(e.message));
