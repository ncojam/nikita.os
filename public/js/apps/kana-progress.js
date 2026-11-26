import { store } from "../core/util.js";

const clone = x => JSON.parse(JSON.stringify(x));
const empty = () => ({level:1,max:1,voice:true,keys:"auto",kana:{},words:{},hist:[],examCredit:0,examHist:[],writing:{},writingHist:[],modeStats:{},scriptKana:{}});
const normalize = x => Object.assign(empty(),x||{});
const guest = () => normalize({...store.get("kana.type",{}),writing:store.get("kana.type",{}).writing || store.get("kana.write",{})});
export const progress = guest();
let uid=null,nick=null,rev=0,base=empty(),dirty=false,busy=false,timer=null,listener=null,connecting=false,epoch=0,running=null,pending=null;
const key = id => "kana.account."+id;
const status = message => listener?.(message);
const set = x => { for(const k of Object.keys(progress))delete progress[k];Object.assign(progress,normalize(x)); };
const nonempty = x => x.hist.length || x.examHist.length || Object.keys(x.kana).length || Object.keys(x.words).length || Object.keys(x.writing).length || Object.keys(x.modeStats).length || Object.keys(x.scriptKana).length || x.writingHist.length || x.examCredit;
const count = x => Number.isFinite(x)?x:0;
const delta = (a,b)=>count(b)-count(a);
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Apply the changes from base → local to remote. Histories are deduplicated,
// counters add their increments rather than overwriting work on another device.
export function rebase(base,local,remote){
  base=normalize(base);local=normalize(local);const out=normalize(clone(remote||{}));
  for(const field of ["kana","words","writing","modeStats","scriptKana"]){
    for(const [k,v] of Object.entries(local[field])){
      const old=base[field][k]||{},r=out[field][k]||{ok:0,err:0};
      if(eq(v,old))continue;
      for(const f of ["ok","err","streak","unguided","audioOk","copyLapses","recallLapses","typeOk","typeErr","checkOk","checkErr","examOk","examErr","ms","completed","skipped","assisted","strokeOk","strokeErr","scriptFallback"])if(f in v||f in r)r[f]=Math.max(0,count(r[f])+delta(old[f],v[f]));
      if(v.ru&&!r.ru)r.ru=v.ru;
      if(v.last)r.last=Math.max(count(r.last),v.last);
      out[field][k]=r;
    }
  }
  for(const field of ["hist","examHist","writingHist"]){
    const id=x=>x.id||JSON.stringify(x);
    const old=new Set(base[field].map(id)),seen=new Set(out[field].map(id));
    for(const row of local[field])if(!old.has(id(row))&&!seen.has(id(row))){out[field].push(row);seen.add(id(row));}
    out[field]=out[field].sort((a,b)=>a.at-b.at).slice(-365);
  }
  out.examCredit=Math.max(0,count(out.examCredit)+delta(base.examCredit,local.examCredit));
  out.max=Math.max(out.max,local.max);
  for(const f of ["level","voice","keys"])if(local[f]!==base[f])out[f]=local[f];
  return out;
}
function persist(){
  if(uid===null)store.set("kana.type",progress);
  else store.set(key(uid),{rev,base,state:progress,dirty,pending});
}
function schedule(ms=500){
  clearTimeout(timer);
  if(uid!==null&&dirty)timer=setTimeout(sync,ms);
}
export function saveProgress(){
  if(uid!==null)dirty=true;
  persist();schedule();
}
export const accountInfo=()=>({uid,nick,dirty,guestAvailable:!!nonempty(guest())&&!store.get("kana.guest.imported",false)});
export function bindProgressStatus(fn){listener=fn;if(fn)fn(uid===null?"Гость · прогресс хранится в браузере":dirty?"Аккаунт "+nick+" · ожидает синхронизации":"Аккаунт "+nick+" · синхронизировано");}
export function importGuest(){
  if(uid===null||!accountInfo().guestAvailable)return false;
  set(rebase(empty(),guest(),progress));
  store.set("kana.guest.imported",true);
  saveProgress();return true;
}
async function request(method,body){
  const r=await fetch("/api/kana/progress",{method,cache:"no-store",credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));
  return {r,d};
}
export async function connectProgress(){
  if(connecting)return;
  connecting=true;
  clearTimeout(timer);
  if(running)await running;
  const token=++epoch;
  try{
    const {r,d}=await request("GET");
    if(token!==epoch)return;
    if(r.status===401){
      persist();uid=null;nick=null;dirty=false;rev=0;base=empty();pending=null;set(guest());status("Гость · прогресс хранится в браузере");return;
    }
    if(!r.ok||!Number.isInteger(d.uid))throw Error(d.error||"HTTP "+r.status);
    persist();
    const cache=store.get(key(d.uid),null);
    uid=d.uid;nick=d.nick;rev=d.rev;base=normalize(d.state);pending=null;
    if(cache?.dirty){
      if(cache.pending){
        // Retry the same operation before rebasing it. The server deduplicates
        // successful operations even if the original acknowledgement was lost.
        pending=cache.pending;rev=cache.rev;base=normalize(cache.base);
        set(clone(cache.state));dirty=true;
      }else{set(rebase(cache.base,cache.state,base));dirty=true;}
    }else{set(clone(base));dirty=false;}
    persist();status("Аккаунт "+nick+(dirty?" · синхронизация…":" · синхронизировано"));
  }catch(e){status("Не удалось проверить аккаунт · данные остаются локально");}
  finally{connecting=false;schedule();}
}
function sync(){
  if(running)return running;
  if(uid===null||!dirty||connecting)return Promise.resolve();
  running=flush().finally(()=>{running=null;});
  return running;
}
async function flush(){
  busy=true;
  const account=uid,token=epoch;
  if(!pending){
    pending={op:globalThis.crypto?.randomUUID?.()||Date.now()+"-"+Math.random(),sent:clone(progress),prior:clone(base),version:rev};
    persist();
  }
  const {op,sent,prior,version}=pending;
  let delay=500;
  try{
    const {r,d}=await request("PUT",{uid:account,rev:version,state:sent,op});
    if(token!==epoch||uid!==account)return;
    if(r.ok&&d.uid===account){
      // Changes made while the HTTP request was in flight are preserved.
      const current=clone(progress);
      rev=d.rev;base=normalize(d.state);pending=null;
      dirty=!eq(current,sent);set(dirty?rebase(sent,current,base):clone(base));
      status("Аккаунт "+nick+(dirty?" · синхронизация…":" · синхронизировано"));
    }else if(r.status===409&&d.uid===account&&Number.isInteger(d.rev)){
      const current=clone(progress);rev=d.rev;base=normalize(d.state);pending=null;set(rebase(prior,current,base));dirty=true;
    }else if(r.status===401||r.status===409){
      status("Вход изменился · прогресс сохранён локально, войди снова");delay=30000;
    }else{throw Error(d.error||"HTTP "+r.status);}
  }catch(e){if(token===epoch){status("Синхронизация не удалась · прогресс сохранён локально");delay=10000;}}
  finally{busy=false;if(token===epoch)persist();schedule(delay);}
}

export function scriptOf(k){
  const hira=/[ぁ-ゖ]/.test(k),kata=/[ァ-ヺ]/.test(k);
  return hira&&kata?"mixed":kata?"kata":hira?"hira":"other";
}
export const statId=()=>globalThis.crypto?.randomUUID?.()||Date.now()+"-"+Math.random();
export function recordMode(mode,k,delta){
  const key=mode+"."+scriptOf(k),r=progress.modeStats[key]||={ok:0,err:0};
  for(const [field,n] of Object.entries(delta))r[field]=(r[field]||0)+Math.max(0,Math.round(n||0));
}
export function recordItem(field,k,mode,ok){
  const r=progress[field][k]||={ok:0,err:0};
  const key=mode+(ok?"Ok":"Err");
  r[key]=(r[key]||0)+1;
}
