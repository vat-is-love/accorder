import {positions,layout,exportTxt,exportFilename,dictionary,remapChords,transposeChord,importChordText} from './core.js';
import {BrowserLibrary,FileLibrary,parseImport} from './storage.js';
import {zipTxtFiles} from './archive.js';
const $=id=>document.getElementById(id);
const browserMode=document.documentElement.dataset.storage!=='files';
const storage=browserMode?new BrowserLibrary({name:'accorder:'+new URL('.',location.href).pathname}):new FileLibrary();
$('browser-tools').hidden=!browserMode;
$('storage-note').textContent=browserMode?'Песни хранятся в этом браузере':'Песни хранятся в папке songs/';
let song=null, selected=null, dirty=false, matches=[], choice=-1, closed=false, activeTab='text', libraryBusy=false, chordSpelling='sharps';
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
    const row=document.createElement('div');row.className='library-row';
    const menu=document.createElement('details');menu.className='song-menu';
    const toggle=document.createElement('summary');toggle.textContent='⋯';toggle.setAttribute('aria-label','Действия: '+item.title);
    const actions=document.createElement('div');actions.className='song-actions';
    for(const [label,action] of [['Сделать копию',()=>copySong(item)],['Удалить',()=>deleteSong(item)]]){
      const control=document.createElement('button');control.textContent=label;control.onclick=()=>{menu.open=false;action();};actions.append(control);
    }
    menu.append(toggle,actions);menu.ontoggle=()=>{if(menu.open)for(const other of $('library').querySelectorAll('details'))if(other!==menu)other.open=false;};
    row.append(button,menu);$('library').append(row);
  }
}
async function copySong(item){
  if(libraryBusy||$('save').disabled)return;
  libraryBusy=true;
  try{
    const original=await storage.get(item.id);
    const {id,exportFile,updatedAt,...copy}=original;
    copy.title=original.title.slice(0,190).replace(/[\uD800-\uDBFF]$/u,'')+' (копия)';
    // Copy the saved version, without replacing any editor draft.
    await storage.save(copy);await library();status('Копия сохранена');
  }catch(error){status(error.message);}finally{libraryBusy=false;}
}
async function deleteSong(item){
  if(libraryBusy||$('save').disabled)return;
  if(!confirm(`Удалить песню «${item.title}» из хранилища?`))return;
  if(song?.id===item.id&&!canLeave())return;
  libraryBusy=true;
  const target=song, snapshot=JSON.stringify(song), source=$('source').value;
  try{
    await storage.remove(item.id);
    if(song?.id===item.id){
      if(song===target&&JSON.stringify(song)===snapshot&&$('source').value===source){
        song=null;selected=null;dirty=false;$('editor').hidden=true;$('welcome').hidden=false;
        $('chord-editor').hidden=true;closeSuggestions();
      }else{delete song.id;delete song.exportFile;changed();}
    }
    await library();status(dirty?'Песня удалена · есть несохранённые изменения':'Песня удалена');
  }catch(error){status(error.message);}finally{libraryBusy=false;}
}
function syncSourceState(){
  const pending=!!song&&$('source').value!==song.text;
  for(const name of ['chords','preview']){
    const tab=$('tab-'+name);
    tab.disabled=pending;
    if(pending)tab.setAttribute('aria-describedby','source-hint');
    else tab.removeAttribute('aria-describedby');
  }
  $('apply').classList.toggle('primary',pending);
  $('source-hint').hidden=!pending;
}
function setTab(name){
  activeTab=name;
  for(const tab of ['text','chords','preview']){
    $('panel-'+tab).hidden=tab!==name;
    $('tab-'+tab).setAttribute('aria-selected',String(tab===name));
    $('tab-'+tab).tabIndex=tab===name?0:-1;
  }
  syncSourceState();
  $('export').disabled=name!=='preview';
  if(name==='preview')$('preview').textContent=exportTxt({...song,title:song.title||'Без названия'});
}
function switchTab(name){
  if(!commit())return;
  if(name!=='text'&&$('source').value!==song.text){status('Сначала примените изменения текста.');setTab('text');$('apply').focus();return;}
  selected=null;$('chord-editor').hidden=true;closeSuggestions();render();setTab(name);
}
const tabs=['text','chords','preview'];
for(const name of tabs){
  $('tab-'+name).onclick=()=>switchTab(name);
  $('tab-'+name).onkeydown=event=>{
    const enabled=tabs.filter(tab=>!$('tab-'+tab).disabled),current=enabled.indexOf(name);
    const next=event.key==='ArrowRight'?(current+1)%enabled.length:event.key==='ArrowLeft'?(current+enabled.length-1)%enabled.length:event.key==='Home'?0:event.key==='End'?enabled.length-1:null;
    if(next===null)return;
    event.preventDefault();switchTab(enabled[next]);$('tab-'+activeTab).focus();
  };
}
function refreshPreview(){if(activeTab==='preview')$('preview').textContent=exportTxt({...song,title:song.title||'Без названия'});}
function setChordSpelling(spelling){
  chordSpelling=spelling;
  for(const value of ['sharps','flats'])$('spelling-'+value).setAttribute('aria-pressed',String(value===spelling));
}
function transposeSong(step,spelling=chordSpelling){
  if(!commit())return;
  setChordSpelling(spelling);
  let skipped=0,modified=false;
  for(const [key,value] of Object.entries(song.chords)){
    const transposed=transposeChord(value,step,spelling);
    if(transposed===null){skipped++;continue;}
    if(transposed!==value){song.chords[key]=transposed;modified=true;}
  }
  selected=null;$('chord-editor').hidden=true;closeSuggestions();
  if(modified)changed();render();refreshPreview();
  if(skipped)status(`Нераспознанных обозначений без изменений: ${skipped}${dirty?' · есть несохранённые изменения':''}`);
}
for(const [id,step] of [['transpose-down',-1],['transpose-up',1]])$(id).onclick=()=>transposeSong(step);
for(const spelling of ['sharps','flats'])$('spelling-'+spelling).onclick=()=>transposeSong(0,spelling);
function canLeave(){if(!commit())return false;return !dirty||confirm('Есть несохранённые изменения. Перейти без сохранения?');}
function show(value){
  song=value;selected=null;dirty=false;
  setChordSpelling(Object.values(song.chords).some(chord=>/^[A-G][b♭]|\/[A-G][b♭]$/u.test(chord))?'flats':'sharps');$('welcome').hidden=true;$('editor').hidden=false;
  $('title').value=song.title;$('author').value=song.author||'';$('notes').value=song.notes||'';$('source').value=song.text;setTab(song.text?'chords':'text');
  $('chord-editor').hidden=true;closeSuggestions();render();status(song.id?'Песня открыта':'Новая песня · ещё не сохранена');
}
function fresh(){if(canLeave()){show({title:'',author:'',text:'',notes:'',chords:{}});$('title').focus();library().catch(e=>status(e.message));}}
$('new').onclick=fresh;$('first').onclick=fresh;
function render(){
  // Keep the one real input alive when rebuilding the score.
  $('panel-chords').append($('chord-editor'));
  $('score').replaceChildren();
  if(!song.text){$('score').textContent='Добавьте текст песни на вкладке «Текст» и нажмите «Применить текст».';renderNotes();return;}
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
    else {e.preventDefault();selected=null;$('chord-editor').hidden=true;render();(e.shiftKey?$('transpose-up'):$('save')).focus({preventScroll:true});}
  }
};
$('title').oninput=()=>{song.title=$('title').value;changed();refreshPreview();};
$('author').oninput=()=>{song.author=$('author').value;changed();refreshPreview();};
$('notes').oninput=()=>{song.notes=$('notes').value;changed();renderNotes();};
$('source').oninput=()=>{changed();syncSourceState();};
function applyText(){
  if($('source').value===song.text)return true;
  const text=$('source').value;
  song.chords=remapChords(song.text,text,song.chords);
  song.text=text;selected=null;$('chord-editor').hidden=true;changed();render();syncSourceState();return true;
}
$('apply').onclick=()=>{if(commit())applyText();};
$('apply-chords').onclick=()=>{
  if(!commit())return;
  try{
    const result=importChordText($('source').value);
    song.chords={...remapChords(song.text,result.text,song.chords),...result.chords};
    song.text=result.text;$('source').value=result.text;
    selected=null;$('chord-editor').hidden=true;closeSuggestions();
    setChordSpelling(Object.values(song.chords).some(chord=>/^[A-G][b♭]|\/[A-G][b♭]$/u.test(chord))?'flats':'sharps');
    changed();render();setTab('chords');
    status(`Импортировано аккордов: ${result.imported}${result.retained?` · строк аккордов без слов оставлено в тексте: ${result.retained}`:''} · есть несохранённые изменения`);
  }catch(error){status(error.message);}
};
$('save').onclick=async()=>{
  if(libraryBusy){status('Дождитесь завершения операции с библиотекой.');return;}
  if(!commit())return;
  if($('source').value!==song.text){status('Сначала примените изменения текста или верните исходный текст.');setTab('text');$('apply').focus();return;}
  if(!song.title.trim()){status('Добавьте название песни.');$('title').focus();return;}
  $('save').disabled=true;
  const target=song, snapshot=JSON.stringify(song);
  try{
    const saved=await storage.save(song);
    if(song!==target){await library();return;}
    if(JSON.stringify(song)===snapshot){song=saved;dirty=false;refreshPreview();status(browserMode?'Сохранено в браузере':'Сохранено на компьютере');}else{song.id=saved.id;status('Сохранено · есть новые изменения');}
    await library();
  }catch(e){status(e.message);}finally{$('save').disabled=false;}
};
$('export').onclick=()=>{
  if(activeTab!=='preview'||!commit())return;
  if($('source').value!==song.text){status('Сначала примените изменения текста.');setTab('text');return;}
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
