import { el, store } from "../core/util.js";
import { Juice } from "../core/juice.js";
import { ASSOCIATIONS, SOUND_SCENES } from "./kana-associations.js";
let ac, loader, serial=0;
const playing=new Set();
export const associationSettings={
  get visible(){return store.get("kana.association.visible",true);},
  set visible(v){store.set("kana.association.visible",!!v);},
  get sound(){return store.get("kana.association.sound",true);},
  set sound(v){store.set("kana.association.sound",!!v);}
};
function audio(){
  const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AC)return null;
  ac ||= new AC();
  if(ac.state==="suspended")ac.resume().catch(()=>{});
  return ac;
}
export function stopAssociation(){
  serial++;
  for(const s of playing){try{s.stop();}catch{}}
  playing.clear();
}
export async function playAssociation(k,guard=()=>true){
  const scene=ASSOCIATIONS[k],steps=scene&&SOUND_SCENES[scene.sfx];
  if(!steps||!associationSettings.sound||!Juice.cfg.sound||!Juice.cfg.volume)return;
  stopAssociation();const ticket=serial;
  try{
    const ctx=audio();if(!ctx)return;
    const {ensureSample}=await (loader ||= import("./dawn/instruments.js").catch(e=>{loader=null;throw e;}));
    const buffers=await Promise.all(steps.map(([name])=>ensureSample(ctx,"builtin:"+name)));
    if(ticket!==serial||!guard()||ctx.state!=="running")return;
    const start=ctx.currentTime+.015;
    steps.forEach(([,offset,gain,rate],i)=>{
      if(!buffers[i])return;
      const src=ctx.createBufferSource(),g=ctx.createGain();
      src.buffer=buffers[i];src.playbackRate.value=rate;
      g.gain.value=Math.min(.18,Juice.cfg.volume*.32)*gain;
      src.connect(g);g.connect(ctx.destination);
      playing.add(src);
      src.onended=()=>{playing.delete(src);src.disconnect();g.disconnect();};
      src.start(start+offset);
    });
  }catch(e){console.warn("Kana association sound",e);}
}
export function associationKeys(toks){return [...new Set(toks.filter(t=>!t.p&&ASSOCIATIONS[t.k]).map(t=>t.k))];}
function scythe(){
  const ns="http://www.w3.org/2000/svg",s=document.createElementNS(ns,"svg");
  s.setAttribute("viewBox","0 0 48 48");s.setAttribute("class","ka-scythe");s.setAttribute("aria-label","Коса");s.setAttribute("role","img");
  for(const [d,stroke,width,fill] of [["M13 44 31 7","#94613d","4","none"],["M30 7 Q15 1 4 15 Q15 11 28 15 Z","#718096","1","#dce4ec"]]){
    const p=document.createElementNS(ns,"path");p.setAttribute("d",d);p.setAttribute("stroke",stroke);p.setAttribute("stroke-width",width);p.setAttribute("fill",fill);p.setAttribute("stroke-linecap","round");s.append(p);
  }
  return s;
}
export function associationRow(toks,{compact=false}={}){
  if(!associationSettings.visible)return "";
  const keys=associationKeys(toks);
  if(!keys.length)return "";
  const root=el("div",{className:"ka-scenes"+(compact?" compact":"")});
  for(const k of keys.slice(0,compact?1:2)){
    const a=ASSOCIATIONS[k];
    const row=el("div",{className:"ka-scene"},
      el("div",{className:"ka-icons"},el("span",{textContent:a.meaning}),el("span",{className:"ka-link",textContent:"↔"}),k==="かさ"?scythe():el("span",{textContent:a.anchor})),
      el("div",{className:"ka-copy"},el("b",{textContent:a.keyword}),el("small",{textContent:a.story})),
      associationSettings.sound?el("button",{className:"kn-btn small",title:"Воспроизвести ассоциацию",textContent:"🔊",onclick:()=>playAssociation(k,()=>row.isConnected)}):"");
    root.append(row);
  }
  return root;
}
