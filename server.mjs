import http from 'node:http';
import {readFile, readdir, mkdir, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {positions,exportTxt,exportFilename} from './dist/core.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const songs = path.join(root, 'songs');
const exportsDirectory = path.join(root, 'exports');
await mkdir(songs,{recursive:true});
await mkdir(exportsDirectory,{recursive:true});
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const send = (res,status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req) {
  let value = '';
  for await (const chunk of req) {value += chunk; if(Buffer.byteLength(value)>1024*1024) throw Object.assign(new Error('Песня слишком большая (максимум 1 МБ).'),{status:413});}
  try {return JSON.parse(value);} catch {throw Object.assign(new Error('Некорректный JSON.'),{status:400});}
}
function validate(data) {
  if(typeof data.title!=='string'|| !data.title.trim() || data.title.length>200 || typeof data.text!=='string' || !data.chords || typeof data.chords!=='object' || Array.isArray(data.chords)) throw Object.assign(new Error('Проверьте название, текст и аккорды.'),{status:400});
  if(data.author!==undefined&&(typeof data.author!=='string'||data.author.length>200||/[\x00-\x1f\x7f]/u.test(data.author))) throw Object.assign(new Error('Проверьте автора песни (максимум 200 символов, одна строка).'),{status:400});
  if(data.notes!==undefined&&typeof data.notes!=='string') throw Object.assign(new Error('Примечания должны быть текстом.'),{status:400});
  const valid = new Set(positions(data.text).map(p=>p.key));
  for(const [key,value] of Object.entries(data.chords)) if(!valid.has(key)||typeof value!=='string'||value.length>40||/[\s\x00-\x1f\x7f]/u.test(value)||!value) throw Object.assign(new Error('Некорректная позиция или обозначение аккорда.'),{status:400});
  return {version:1,title:data.title.trim(),author:(data.author||'').trim(),text:data.text,notes:data.notes||'',chords:data.chords};
}
export const server = http.createServer(async (req,res) => {
 try {
  const url = new URL(req.url,'http://localhost');
  if(req.method!=='GET' && (req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin!==`http://${req.headers.host}`))) return send(res,403,{error:'Запрос с другого сайта отклонён.'});
  if(url.pathname==='/api/songs' && req.method==='GET') {
    const list=[];
    for(const file of await readdir(songs)) if(idPattern.test(file.replace(/\.json$/,''))&&file.endsWith('.json')) {
      try {const song=JSON.parse(await readFile(path.join(songs,file),'utf8'));list.push({id:song.id,title:song.title,updatedAt:song.updatedAt});} catch { /* Ignore unrelated or damaged files. */ }
    }
    return send(res,200,list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
  }
  const match=url.pathname.match(/^\/api\/songs\/([^/]+)$/);
  if(match && !idPattern.test(match[1])) return send(res,400,{error:'Некорректный идентификатор.'});
  if(match && req.method==='DELETE') {
    const filename=path.join(songs,match[1]+'.json');
    const previous=JSON.parse(await readFile(filename,'utf8'));
    const exportFile=previous.exportFile;
    const ownedExport=typeof exportFile==='string'&&path.basename(exportFile)===exportFile&&exportFile.endsWith('.txt')?exportFile:match[1]+'.txt';
    try {await unlink(path.join(exportsDirectory,ownedExport));}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    await unlink(filename);
    return send(res,200,{id:match[1]});
  }
  if(match && req.method==='GET') return send(res,200,JSON.parse(await readFile(path.join(songs,match[1]+'.json'),'utf8')));
  if((url.pathname==='/api/songs'&&req.method==='POST') || (match&&req.method==='PUT')) {
    const data=validate(await body(req));
    const id=match?match[1]:randomUUID();
    const previous=match?JSON.parse(await readFile(path.join(songs,id+'.json'),'utf8')):null;
    const oldExport=previous?.exportFile;
    const ownedExport=typeof oldExport==='string'&&path.basename(oldExport)===oldExport&&oldExport.endsWith('.txt')?oldExport:id+'.txt';
    const existingExports=await readdir(exportsDirectory);
    const candidate=exportFilename(data.title,existingExports.filter(name=>name!==ownedExport));
    // Keep casing for the same name so case-insensitive filesystems never
    // mistake the replacement for a separate stale file during cleanup.
    const exportFile=candidate.normalize('NFC').toLowerCase()===ownedExport.normalize('NFC').toLowerCase()?ownedExport:candidate;
    const song={...data,id,exportFile,updatedAt:new Date().toISOString()};
    const token=randomUUID();
    const temporary=path.join(songs,id+'.'+token+'.tmp');
    const temporaryTxt=path.join(exportsDirectory,id+'.'+token+'.tmp');
    try {
      await writeFile(temporary,JSON.stringify(song,null,2)+'\n');
      await writeFile(temporaryTxt,exportTxt(song));
      await rename(temporaryTxt,path.join(exportsDirectory,exportFile));
      await rename(temporary,path.join(songs,id+'.json'));
      if(ownedExport!==exportFile) {
        try {await unlink(path.join(exportsDirectory,ownedExport));}
        catch(error) {if(error.code!=='ENOENT')throw error;}
      }
    } finally {
      await Promise.allSettled([unlink(temporary),unlink(temporaryTxt)]);
    }
    return send(res,200,song);
  }
  const files={'/':'index.html','/app.js':'app.js','/core.js':'core.js','/storage.js':'storage.js','/archive.js':'archive.js','/amdm.js':'amdm.js','/style.css':'style.css'};
  if(req.method==='GET' && files[url.pathname]) {
    const name=files[url.pathname];
    res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    const content=await readFile(path.join(root,'dist',name));
    return res.end(name==='index.html'?content.toString().replace('data-storage="browser"','data-storage="files"'):content);
  }
  send(res,404,{error:'Не найдено.'});
 } catch(error) {send(res,error.status||(error.code==='ENOENT'?404:500),{error:error.status?error.message:error.code==='ENOENT'?'Песня не найдена.':'Не удалось прочитать или сохранить файл.'});}
});
if(process.argv[1]===fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT||3210),'127.0.0.1',()=>console.log(`Accorder: http://127.0.0.1:${server.address().port}`));
