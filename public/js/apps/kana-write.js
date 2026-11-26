import { el, store } from "../core/util.js";
import { Juice } from "../core/juice.js";
import { KanaTTS } from "./kana-tts.js";
const NS="http://www.w3.org/2000/svg";
function svg(tag,attrs={}){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;}
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const len=p=>p.slice(1).reduce((s,x,i)=>s+dist(x,p[i]),0);
function sample(p,n=32){
  const total=len(p), out=[p[0]];let j=1,used=0;
  if(!total)return Array(n).fill(p[0]);
  for(let i=1;i<n-1;i++){
    const t=total*i/(n-1);
    while(j<p.length-1 && used+dist(p[j-1],p[j])<t){used+=dist(p[j-1],p[j]);j++;}
    const a=p[j-1],b=p[j],d=dist(a,b),f=d?(t-used)/d:0;
    out.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);
  }
  return [...out,p.at(-1)];
}
export function assessStroke(p,ref){
  if(p.length<2||len(p)<2)return "Штрих слишком короткий";
  const a=sample(p),b=sample(ref),ratio=len(p)/Math.max(1,len(ref));
  const error=a.reduce((s,x,i)=>s+dist(x,b[i]),0)/a.length;
  const rev=a.reduce((s,x,i)=>s+dist(x,b[b.length-1-i]),0)/a.length;
  if(rev+5<error)return "Неверное направление штриха";
  if(dist(a[0],b[0])>19||dist(a.at(-1),b.at(-1))>22)return "Проверь начало и конец штриха";
  if(error>12||ratio<.45||ratio>2.2)return "Повтори форму штриха";
  return "";
}
let dataP;
const load=()=>dataP ||= fetch("/js/apps/kana-strokes.json").then(r=>{if(!r.ok)throw Error("HTTP "+r.status);return r.json();}).catch(e=>{dataP=null;throw e;});
const shuffle=a=>[...a].map(x=>[Math.random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
export async function renderKanaWrite(c,{back,voice=()=>true,preferred=[],level=1}={}){
  const wait=el("p",{textContent:"Загружаем эталоны письма…"});
  c.replaceChildren(wait);let data;
  try{data=await load();}catch(e){if(wait.isConnected)c.replaceChildren(el("p",{textContent:e.message}),el("button",{className:"kn-btn",textContent:"Назад",onclick:back}));return;}
  if(!wait.isConnected)return;
  KanaTTS.init();
  const stats=store.get("kana.write",{})||{};
  let script=level===1?"hira":"both", guided=true;
  const speak=ch=>{if(voice())KanaTTS.say(ch,.9);};
  const leave=()=>{KanaTTS.stop();KanaTTS.bindStatus(null);back();};
  function menu(){
    KanaTTS.stop();
    c.replaceChildren(el("div",{className:"kt-menu"},
      el("h3",{textContent:"✍ Тренажёр письма"}),
      el("p",{className:"kn-muted",textContent:"Рисуй мышью, пальцем или пером. Проверяются форма, направление, начало и конец штрихов в правильном порядке."}),
      el("div",{className:"kn-builder"},el("label",{className:"kn-bsel"},el("span",{textContent:"Азбука"}),el("select",{onchange:e=>script=e.target.value},...[["hira","Хирагана"],["kata","Катакана"],["both","Обе азбуки"]].map(([value,textContent])=>el("option",{value,textContent,selected:value===script})))),
      el("label",{className:"kn-check"},el("input",{type:"checkbox",checked:guided,onchange:e=>guided=e.target.checked}),"Эталон и подсказки")),
      el("button",{className:"kn-btn kt-go",textContent:"▶ 6 знаков",onclick:start}),el("button",{className:"kn-btn",textContent:"Назад",onclick:leave}),
      el("a",{className:"kn-muted",href:"/js/apps/kana-strokes.LICENSE.txt",target:"_blank",rel:"noopener",textContent:"Эталоны KanjiVG · CC BY-SA 3.0"})));
  }
  function start(){
    const pool=Object.keys(data.kana).filter(ch=>script==="both"||(script==="hira"?/[ぁ-ゖ]/.test(ch):/[ァ-ヺ]/.test(ch)));
    const fav=[...new Set(preferred.flatMap(s=>[...s.normalize("NFD").replace(/[\u3099\u309a]/g,"")]))].filter(ch=>pool.includes(ch));
    const weak=shuffle(pool).sort((a,b)=>(stats[b]?.err||0)/(1+(stats[b]?.ok||0))-(stats[a]?.err||0)/(1+(stats[a]?.ok||0)));
    const chars=[...new Set([...shuffle(fav).slice(0,3),...weak])].slice(0,6);
    let at=0,ok=0,errors=0;
    function next(){
      KanaTTS.stop();
      if(at>=chars.length){KanaTTS.bindStatus(null);c.replaceChildren(el("div",{className:"kt-menu"},el("h3",{textContent:"Письмо завершено"}),el("p",{textContent:ok+" знаков написано · "+errors+" ошибок штриха"}),el("button",{className:"kn-btn kt-go",textContent:"Ещё 6 знаков",onclick:start}),el("button",{className:"kn-btn",textContent:"Назад",onclick:leave})));return;}
      const ch=chars[at],refs=data.kana[ch].strokes;
      let step=0,pointer=null,points=[],ink,finished=false,timer,hadError=false;
      const board=svg("svg",{viewBox:"0 0 109 109",class:"kw-board","aria-label":"Поле письма"});
      const guides=svg("g"),accepted=svg("g"),draw=svg("g");
      board.append(svg("path",{d:"M54.5 0V109M0 54.5H109M0 0L109 109M109 0L0 109",class:"kw-grid"}),guides,accepted,draw);
      const ref=refs.map(r=>svg("path",{d:r.path,class:"kw-reference"}));ref.forEach(p=>guides.append(p));
      const dot=svg("circle",{r:2.4,class:"kw-dot"});guides.append(dot);
      const num=el("b"),note=el("p",{className:"kw-note",role:"status"}),status=el("p",{className:"kn-muted",role:"status"});
      const toggle=el("button",{className:"kn-btn small",textContent:guided?"Скрыть эталон":"Показать эталон",onclick:()=>{guided=!guided;toggle.textContent=guided?"Скрыть эталон":"Показать эталон";paint();}});
      const card=el("div",{className:"kt-menu kw-card"},el("div",{className:"kt-top"},el("b",{textContent:"Письмо "+(at+1)+" / "+chars.length}),el("span",{className:"kt-sp"}),el("button",{className:"kn-btn small",textContent:"✕ Назад",onclick:leave})),
        el("div",{className:"kw-heading"},el("span",{className:"kw-character",textContent:ch}),el("div",{},num,el("p",{className:"kn-muted",textContent:"Напиши знак"})),el("button",{className:"kn-btn",textContent:"🔊",onclick:()=>speak(ch)})),
        board,note,status,el("div",{className:"kn-row"},toggle,el("button",{className:"kn-btn small",textContent:"Заново",onclick:()=>{if(finished)return;pointer=null;step=0;draw.replaceChildren();accepted.replaceChildren();note.textContent="";paint();}}),el("button",{className:"kn-btn small",textContent:"Пропустить →",onclick:()=>{clearTimeout(timer);finished=true;at++;next();}})));
      c.replaceChildren(card);KanaTTS.bindStatus(status);
      function paint(){
        num.textContent="Штрих "+Math.min(step+1,refs.length)+" / "+refs.length;
        ref.forEach((p,i)=>{p.classList.toggle("kw-current",i===step);p.style.opacity=guided?(i===step?".65":".16"):"0";});
        dot.style.opacity=guided&&step<refs.length?"1":"0";
        if(step<refs.length){dot.setAttribute("cx",refs[step].start[0]);dot.setAttribute("cy",refs[step].start[1]);}
      }
      function append(e){
        const m=board.getScreenCTM();if(!m)return;
        const p=board.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(m.inverse()),x=[q.x,q.y];
        if(!points.length||dist(x,points.at(-1))>.35)points.push(x);
        ink.setAttribute("points",points.map(p=>p.join(",")).join(" "));
      }
      board.addEventListener("pointerdown",e=>{if(finished||pointer!==null||e.button!==0)return;e.preventDefault();pointer=e.pointerId;board.setPointerCapture(pointer);points=[];draw.replaceChildren();ink=svg("polyline",{class:"kw-ink"});draw.append(ink);append(e);});
      board.addEventListener("pointermove",e=>{if(pointer!==e.pointerId)return;const events=e.getCoalescedEvents?.();for(const p of events?.length?events:[e])append(p);});
      board.addEventListener("pointercancel",e=>{if(pointer===e.pointerId){pointer=null;draw.replaceChildren();}});
      board.addEventListener("pointerup",e=>{
        if(pointer!==e.pointerId||finished)return;append(e);pointer=null;
        const p=ref[step],l=p.getTotalLength(),target=Array.from({length:64},(_,i)=>{const q=p.getPointAtLength(l*i/63);return[q.x,q.y];});
        const error=assessStroke(points,target),rec=stats[ch]||={ok:0,err:0};
        draw.replaceChildren();
        if(error){errors++;hadError=true;rec.err++;store.set("kana.write",stats);note.textContent=error;note.className="kw-note kt-warn";ink.classList.add("kw-wrong");draw.append(ink);Juice.buzz();return;}
        ink.classList.add("kw-right");accepted.append(ink);step++;Juice.ding(step);paint();note.textContent="Верно!";note.className="kw-note";
        if(step===refs.length){finished=true;ok++;if(!hadError)rec.ok++;store.set("kana.write",stats);speak(ch);timer=setTimeout(()=>{if(card.isConnected){at++;next();}},1050);}
      });
      paint();speak(ch);
    }
    next();
  }
  menu();
}
