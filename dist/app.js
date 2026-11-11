import {copyChordRows,planChordPaste,positions,layout,exportTxt,exportFilename,dictionary,remapChords,transposeChord,importChordText,isTextOnlyLine,previewRows} from './core.js';
import {BrowserLibrary,FileLibrary,parseImport} from './storage.js';
import {zipTxtFiles} from './archive.js';
import {createSongLink,readSongLink} from './share.js';
import {parseAmdmHtml} from './amdm.js';
const $=id=>document.getElementById(id);
const browserMode=document.documentElement.dataset.storage!=='files';
const storage=browserMode?new BrowserLibrary({name:'accorder:'+new URL('.',location.href).pathname}):new FileLibrary();
$('browser-tools').hidden=!browserMode;
$('storage-note').textContent=browserMode?'Песни хранятся в этом браузере':'Песни хранятся в папке songs/';
let song=null, selected=null, dirty=false, matches=[], choice=-1, closed=false, activeTab='text', libraryBusy=false, chordSpelling='sharps';
const status=message=>{$('status').textContent=message;};
document.addEventListener('click',event=>{
  for(const menu of document.querySelectorAll('.song-menu[open]'))if(!menu.contains(event.target))menu.open=false;
});
let saveTimer=null, saving=null, revision=0, composing=false, navigationBusy=false;
function saveState(message,retry=false){
  $('save-state').textContent=message;$('save').hidden=!retry;
}
function scheduleSave(){
  clearTimeout(saveTimer);
  if(song&&!composing)saveTimer=setTimeout(()=>{void saveSong();},1000);
}
function changed(){
  dirty=true;revision++;saveState('Есть изменения');scheduleSave();
}
document.addEventListener('compositionstart',()=>{composing=true;clearTimeout(saveTimer);});
document.addEventListener('compositionend',()=>{composing=false;if(dirty)scheduleSave();});
async function navigate(action){
  if(navigationBusy)return;
  navigationBusy=true;
  try{if(await canLeave())await action();}
  catch(error){status(error.message);}
  finally{navigationBusy=false;}
}
async function library(){
  const list=await storage.list(); $('count').textContent=list.length;
  for(const container of [$('library'),$('home-library')]){
    container.replaceChildren();
    if(!list.length){const p=document.createElement('p');p.className='empty-library';p.textContent='Нет сохранённых песен';container.append(p);}
    for(const item of list){
      const button=document.createElement('button');button.textContent=item.title;
      const small=document.createElement('small');small.textContent=new Date(item.updatedAt).toLocaleDateString('ru-RU');button.append(small);
      button.classList.toggle('active',song?.id===item.id);
      button.onclick=()=>navigate(async()=>{
        const target=song,version=revision,value=await storage.get(item.id);
        if(song!==target||revision!==version){status('Редактор изменён во время открытия песни. Повторите переход.');return;}
        show(value);await library();
      });
      const row=document.createElement('div');row.className='library-row';
      const menu=document.createElement('details');menu.className='song-menu';
      const toggle=document.createElement('summary');toggle.textContent='⋯';toggle.setAttribute('aria-label','Действия: '+item.title);
      const actions=document.createElement('div');actions.className='song-actions';
      for(const [label,action] of [['Сделать копию',()=>copySong(item)],['Удалить',()=>deleteSong(item)]]){
        const control=document.createElement('button');control.textContent=label;control.onclick=()=>{menu.open=false;action();};actions.append(control);
      }
      menu.append(toggle,actions);menu.ontoggle=()=>{if(menu.open)for(const other of container.querySelectorAll('details'))if(other!==menu)other.open=false;};
      row.append(button,menu);container.append(row);
    }
  }
}

async function copySong(item){
  if(libraryBusy||saving)return;
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
  if(libraryBusy||saving)return;
  if(!confirm(`Удалить песню «${item.title}» из хранилища?`))return;
  if(song?.id===item.id&&!await canLeave())return;
  if(libraryBusy||saving)return;
  libraryBusy=true;
  const target=song, snapshot=JSON.stringify(song), source=$('source').value;
  try{
    await storage.remove(item.id);
    if(song?.id===item.id){
      if(song===target&&JSON.stringify(song)===snapshot&&$('source').value===source){
        clearTimeout(saveTimer);saveState('');song=null;selected=null;dirty=false;$('editor').hidden=true;$('welcome').hidden=false;
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
  if(name==='preview')refreshPreview();
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
let previewColumns=false,previewGap=1,previewSeparator=false;
function refreshPreview(){
  if(activeTab!=='preview'||!song)return;
  const value={...song,title:song.title||'Без названия'};
  const preview=$('preview');preview.replaceChildren();
  const rows=previewRows(value,previewColumns,previewGap,previewSeparator);
  rows.forEach((parts,index)=>{
    for(const part of parts){
      const span=document.createElement('span');span.textContent=part.text;
      if(part.chord)span.className='preview-chords';
      preview.append(span);
    }
    if(index<rows.length-1)preview.append(document.createTextNode('\n'));
  });
}
$('preview-separator').onclick=()=>{previewSeparator=!previewSeparator;$('preview-separator').setAttribute('aria-pressed',String(previewSeparator));refreshPreview();};
$('preview-columns').onclick=()=>{previewColumns=!previewColumns;$('preview-columns').setAttribute('aria-pressed',String(previewColumns));refreshPreview();};
for(const [id,step] of [['gap-minus',-1],['gap-plus',1]])$(id).onclick=()=>{
  previewGap=Math.max(1,previewGap+step);$('gap-value').textContent=previewGap;$('gap-minus').disabled=previewGap===1;refreshPreview();
};
$('home').onclick=event=>{
  event.preventDefault();void navigate(async()=>{
    $('editor').hidden=true;$('welcome').hidden=false;
    $('chord-editor').hidden=true;closeSuggestions();
    await library();
  });
};
const resizeHandle=$('sidebar-resize'),sidebar=resizeHandle.parentElement;
function resizeSidebar(width){
  const max=Math.min(600,Math.max(180,window.innerWidth-280));
  const value=Math.round(Math.max(180,Math.min(max,width)));
  sidebar.style.width=value+'px';resizeHandle.setAttribute('aria-valuenow',String(value));resizeHandle.setAttribute('aria-valuemax',String(max));
}
resizeHandle.onpointerdown=event=>{
  if(event.button!==0)return;
  event.preventDefault();resizeHandle.setPointerCapture(event.pointerId);
};
resizeHandle.onpointermove=event=>{if(resizeHandle.hasPointerCapture(event.pointerId))resizeSidebar(event.clientX-sidebar.getBoundingClientRect().left);};
resizeHandle.onpointerup=event=>{if(resizeHandle.hasPointerCapture(event.pointerId))resizeHandle.releasePointerCapture(event.pointerId);};
resizeHandle.onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();resizeSidebar(sidebar.getBoundingClientRect().width+(event.key==='ArrowRight'?10:-10));
};
function setChordSpelling(spelling){
  chordSpelling=spelling;
  for(const value of ['sharps','flats'])$('spelling-'+value).setAttribute('aria-pressed',String(value===spelling));
}
function syncTranspose(){
  const offset=song?.transposeOffset||0;
  $('transpose-offset').textContent=offset>0?'+'+offset:String(offset);
  $('transpose-offset').hidden=offset===0;
  $('transpose-apply').hidden=offset===0;
}
$('transpose-apply').onclick=()=>{
  if(!commit())return;
  song.transposeOffset=0;syncTranspose();changed();
};
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
  if(modified){song.transposeOffset=(song.transposeOffset||0)+step;changed();}
  syncTranspose();render();refreshPreview();
  if(skipped)status(`Нераспознанных обозначений без изменений: ${skipped}${dirty?' · есть несохранённые изменения':''}`);
}
for(const [id,step] of [['transpose-down',-1],['transpose-up',1]])$(id).onclick=()=>transposeSong(step);
for(const spelling of ['sharps','flats'])$('spelling-'+spelling).onclick=()=>transposeSong(0,spelling);
async function canLeave(){
  if(composing)return false;
  if(!commit())return false;
  return await saveSong();
}
function show(value){
  clearTimeout(saveTimer);saveState(value.id?'Сохранено':'Добавьте название песни');
  song=value;selected=null;dirty=false;revision++;syncTranspose();resetRowSelection();
  setChordSpelling(Object.values(song.chords).some(chord=>/^[A-H][b♭]|\/[A-H][b♭]$/u.test(chord))?'flats':'sharps');$('welcome').hidden=true;$('editor').hidden=false;
  $('title').value=song.title;$('author').value=song.author||'';$('notes').value=song.notes||'';$('source').value=song.text;setTab(song.text?'chords':'text');
  $('chord-editor').hidden=true;closeSuggestions();render();status(song.id?'Песня открыта':'Новая песня · ещё не сохранена');
}
function fresh(){return navigate(async()=>{show({title:'',author:'',text:'',notes:'',chords:{}});$('title').focus();await library();});}
$('new').onclick=fresh;$('first').onclick=fresh;
let rowStart=null,rowEnd=null,copiedRows=null;
function resetRowSelection(){rowStart=null;rowEnd=null;copiedRows=null;syncRowTools();}
function syncRowTools(){
  const chordRows=new Set(Object.entries(song?.chords||{}).filter(([,value])=>value).map(([key])=>Number(key.split(':')[0])));
  const inRange=row=>rowStart!==null&&row>=Math.min(rowStart,rowEnd)&&row<=Math.max(rowStart,rowEnd);
  $('copy-chords').disabled=![...chordRows].some(inRange);
  $('paste-chords').disabled=rowStart===null||!copiedRows;
  $('row-selection').textContent=rowStart===null?'':`Строки ${Math.min(rowStart,rowEnd)+1}–${Math.max(rowStart,rowEnd)+1}`;
  for(const row of $('score').querySelectorAll('[data-row]')){
    const index=Number(row.dataset.row),line=song.text.split('\n')[index];
    const pick=row.querySelector('.row-pick');
    pick.disabled=!chordRows.has(index)&&!(copiedRows&&line.trim()&&!isTextOnlyLine(line));
    pick.setAttribute('aria-label',`${chordRows.has(index)?'Выбрать строку':'Вставить с строки'} ${index+1}`);
    row.classList.toggle('copy-selected',inRange(index)&&(chordRows.has(index)||!!copiedRows&&!pick.disabled));
  }
}
$('copy-chords').onclick=()=>{
  if(!commit())return;
  if($('copy-chords').disabled)return;
  copiedRows=copyChordRows(song.text,song.chords,Math.min(rowStart,rowEnd),Math.max(rowStart,rowEnd));
  syncRowTools();status(`Скопировано строк: ${copiedRows.length}. Выберите начало вставки.`);
};
$('paste-chords').onclick=()=>{
  if(!commit())return;
  const plan=planChordPaste(song.text,song.chords,copiedRows,Math.min(rowStart,rowEnd));
  const count=Object.keys(plan.additions).length;
  if(!count){status('Нет аккордов для вставки.'+(plan.issues.length?' '+plan.issues.join(' '):''));return;}
  if((plan.issues.length||plan.replacements)&&!confirm([...plan.issues,plan.replacements?`Заменить аккордов: ${plan.replacements}.`:'',`Вставить доступных аккордов: ${count}?`].filter(Boolean).join('\n')))return;
  const modified=Object.entries(plan.additions).some(([key,value])=>song.chords[key]!==value);
  Object.assign(song.chords,plan.additions);
  selected=null;$('chord-editor').hidden=true;closeSuggestions();
  if(modified)changed();render();refreshPreview();status(`Вставлено аккордов: ${count}${dirty?' · есть несохранённые изменения':''}`);
};
function render(){
  // Keep the one real input alive when rebuilding the score.
  $('panel-chords').append($('chord-editor'));
  $('score').replaceChildren();
  if(!song.text){$('score').textContent='Добавьте текст песни на вкладке «Текст» и нажмите «Применить текст».';renderNotes();return;}
  const all=positions(song.text,song.chords);
  song.text.split('\n').forEach((line,row)=>{
    const wrapper=document.createElement('div');wrapper.className=line?'song-line':'blank';wrapper.dataset.row=row;
    const pick=document.createElement('button');pick.className='row-pick';pick.textContent=row+1;
    pick.setAttribute('aria-label',`Выбрать строку ${row+1}`);
    pick.onclick=event=>{
      if(!commit())return;
      if(pick.disabled)return;
      if(event.shiftKey&&rowStart!==null&&Object.keys(song.chords).some(key=>key.startsWith(row+':')))rowEnd=row;else rowStart=rowEnd=row;
      syncRowTools();
    };
    wrapper.append(pick);
    if(isTextOnlyLine(line))wrapper.classList.add('text-only-line');
    if(line){
      const result=layout(line,row,song.chords,2);wrapper.style.width=`${result.width}ch`;
      const lyric=document.createElement('div');lyric.className='lyric';lyric.textContent=result.text;wrapper.append(lyric);
      for(const pos of all.filter(p=>p.row===row)){
        wrapper.append(slotButton(pos,line,result));
      }
    }
    $('score').append(wrapper);
  });
  renderNotes();placeEditor();syncRowTools();
}
function slotButton(pos,line,result){
  const button=document.createElement('button');const chord=song.chords[pos.key];
  button.className='slot '+(chord?'filled':'empty')+(selected?.key===pos.key?' selected':'');
  button.textContent=chord||'·';button.style.left=`${result.columns[pos.index]}ch`;
  button.dataset.position=pos.key;
  const place=pos.index===-1?'перед строкой':pos.index>=Array.from(line).length?'после строки, позиция '+(pos.index-Array.from(line).length+1):`буква «${Array.from(line)[pos.index]}», позиция ${pos.index+1}`;
  button.setAttribute('aria-label',`Строка ${pos.row+1}, ${place}${chord?', аккорд '+chord:', добавить аккорд'}`);
  button.onclick=()=>select(pos);return button;
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
  draft[selected.key]=value;
  const line=song.text.split('\n')[selected.row];
  const result=layout(line,selected.row,draft,2);
  const available=positions(line,draft,selected.row);
  const keys=new Set(available.map(pos=>pos.key));
  // Keep the active empty slot until editing ends, without replacing the input.
  for(const slot of row.querySelectorAll('.slot'))if(!keys.has(slot.dataset.position)&&slot.dataset.position!==selected.key)slot.remove();
  for(const pos of available)if(!row.querySelector(`[data-position="${pos.key}"]`))row.append(slotButton(pos,line,result));
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
  positionSuggestions();syncRowTools();
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
  $('position-label').textContent=`строка ${pos.row+1} · ${pos.index===-1?'начало':pos.index>=Array.from(song.text.split('\n')[pos.row]).length?'конец, позиция '+(pos.index-Array.from(song.text.split('\n')[pos.row]).length+1):'буква '+(pos.index+1)}`;
  $('chord').setAttribute('aria-label','Аккорд, '+$('position-label').textContent);
  if(previous){
    const slot=$('score').querySelector(`[data-position="${previous.key}"]`);
    if(slot){slot.style.visibility='';slot.classList.remove('selected');}
  }
  closed=false;closeSuggestions();placeEditor();
  $('chord').focus({preventScroll:true});$('chord').select();revealPosition();suggestions();
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
  if(closed)return;
  if(value)matches=dictionary.filter(c=>c.toLowerCase().startsWith(value.toLowerCase())).slice(0,10);
  else{
    const counts=new Map();
    for(const [key,chord] of Object.entries(song.chords)){
      if(key===selected?.key)continue;
      counts.set(chord,(counts.get(chord)||0)+1);
    }
    matches=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||a.localeCompare(b));
  }
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
    if(matches.length){
      choice=choice<0?(e.key==='ArrowDown'?0:matches.length-1):(choice+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
      $('chord').value=matches[choice];commit();updateLine();drawSuggestions();
    }
    return;
  }
  if(e.key==='Enter'){
    e.preventDefault();
    if(choice>=0&&matches[choice])$('chord').value=matches[choice];
    finishEditing();return;
  }
  if(e.key==='Tab'){
    if(!commit()){e.preventDefault();return;}
    closeSuggestions();const all=positions(song.text,{...song.chords,[selected.key]:$('chord').value.trim()});const next=all.findIndex(p=>p.key===selected.key)+(e.shiftKey?-1:1);
    if(next>=0&&next<all.length){e.preventDefault();select(all[next]);}
    else {e.preventDefault();selected=null;$('chord-editor').hidden=true;render();(e.shiftKey?$('transpose-up'):$('tab-preview')).focus({preventScroll:true});}
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
  song.text=text;resetRowSelection();selected=null;$('chord-editor').hidden=true;changed();render();syncSourceState();return true;
}
$('apply').onclick=()=>{if(commit())applyText();};
function applyImported(result,{metadata=false}={}){
  if(metadata){song.transposeOffset=0;syncTranspose();}
  song.chords=metadata?result.chords:{...remapChords(song.text,result.text,song.chords),...result.chords};
  song.text=result.text;resetRowSelection();$('source').value=result.text;
  if(metadata){song.title=result.title;song.author=result.author;$('title').value=result.title;$('author').value=result.author;}
  selected=null;$('chord-editor').hidden=true;closeSuggestions();
  setChordSpelling(Object.values(song.chords).some(chord=>/^[A-H][b♭]|\/[A-H][b♭]$/u.test(chord))?'flats':'sharps');
  changed();render();setTab('chords');
  status(`Импортировано аккордов: ${result.imported}${result.retained?` · строк аккордов без слов оставлено в тексте: ${result.retained}`:''} · есть несохранённые изменения`);
}
$('apply-chords').onclick=()=>{
  if(!commit())return;
  try{
    applyImported(importChordText($('source').value));
  }catch(error){status(error.message);}
};
$('import-amdm').onclick=()=>{if(commit())$('amdm-file').click();};
$('amdm-file').onchange=async()=>{
  const file=$('amdm-file').files[0];$('amdm-file').value='';
  if(!file||!commit())return;
  const target=song,snapshot=JSON.stringify(song),source=$('source').value;
  $('import-amdm').disabled=true;
  try{
    if(file.size>2*1024*1024)throw new Error('Страница AMDM слишком большая (максимум 2 МиБ).');
    const result=parseAmdmHtml(await file.text());
    if(song!==target||JSON.stringify(song)!==snapshot||$('source').value!==source){status('Редактор изменён во время чтения файла. Повторите импорт.');return;}
    applyImported(result,{metadata:true});
  }catch(error){status(error.message);}finally{$('import-amdm').disabled=false;}
};
async function saveSong(){
  clearTimeout(saveTimer);
  if(saving)return saving;
  if(!song)return true;
  if(composing)return false;
  if(libraryBusy){scheduleSave();return false;}
  // Defer the work one microtask so concurrent callers share the same promise.
  saving=Promise.resolve().then(async()=>{
    try{
      while(song){
        if(composing)return false;
        if(!commit()){saveState('Ошибка сохранения',true);return false;}
        applyText();clearTimeout(saveTimer);
        if(!dirty)return true;
        if(!song.title.trim()){saveState('Добавьте название песни');status('Добавьте название песни для автосохранения.');return false;}
        const target=song,version=revision,snapshot=JSON.parse(JSON.stringify(song));
        saveState('Сохранение…');
        const saved=await storage.save(snapshot);
        if(song!==target)return false;
        // Keep the editor object and any input received while the write was pending.
        song.id=saved.id;song.exportFile=saved.exportFile;song.updatedAt=saved.updatedAt;
        if(revision===version){dirty=false;saveState('Сохранено');status('Сохранено');refreshPreview();}
        try{await library();}catch(error){status('Песня сохранена. Не удалось обновить список: '+error.message);}
        if(!dirty)return true;
      }
      return true;
    }catch(error){
      saveState('Ошибка сохранения',true);status(error.message);return false;
    }finally{clearTimeout(saveTimer);saving=null;}
  });
  return saving;
}
$('save').onclick=()=>{void saveSong();};
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
$('import').onclick=()=>navigate(async()=>{$('import-files').click();});
$('import-files').onchange=async()=>{
  const files=Array.from($('import-files').files);$('import-files').value='';
  if(!files.length||libraryBusy||saving)return;
  libraryBusy=true;const target=song,version=revision;
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
    if(song===target&&revision===version&&!dirty&&saved.length)show(saved[0]);
    await library();status(`Импортировано песен: ${saved.length}`);
  }catch(error){status(error instanceof SyntaxError?'Некорректный JSON.':error.message);}
  finally{libraryBusy=false;if(dirty)scheduleSave();}
};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&song){event.preventDefault();void saveSong();}});
library().catch(e=>status(e.message));


$('share-song').onclick=async()=>{
  try{
    if(!song)throw new Error('Сначала откройте или создайте песню.');
    if(!commit())throw new Error('Исправьте обозначение аккорда.');
    if($('source').value!==song.text)throw new Error('Сначала примените изменения текста.');
    $('share-song').disabled=true;
    const link=await createSongLink(song,location.href);
    $('share-url').value=link;$('share-status').textContent='';
    $('share-dialog').showModal();$('share-url').focus();$('share-url').select();
  }catch(error){alert(error.message);}finally{$('share-song').disabled=false;}
};
$('copy-share').onclick=async()=>{
  try{
    await navigator.clipboard.writeText($('share-url').value);
    $('share-status').textContent='Ссылка скопирована';
  }catch{
    $('share-url').focus();$('share-url').select();
    alert('Не удалось скопировать ссылку автоматически. Скопируйте выделенную ссылку вручную.');
  }
};
async function openSharedSong(){
  try{
    const value=await readSongLink(location.href);
    if(!value)return;
    if(song||dirty)throw new Error('Редактор изменён во время открытия ссылки. Откройте ссылку в новой вкладке.');
    show(value);changed();setTab('preview');
    status('Песня открыта по ссылке · автосохранение');
  }catch(error){alert(error.message);}
}
openSharedSong();
