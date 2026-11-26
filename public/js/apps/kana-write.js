import { el } from "../core/util.js";
import { progress, saveProgress } from "./kana-progress.js";
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
// Clean full glyphs, not individual strokes. Old ok totals remain usable.
const COPY_THRESHOLD=5, RECALL_THRESHOLD=25;
export function writingStage(ch,rec={},voice=true){
  const copy=Math.max(0,(rec.ok||0)-2*(rec.copyLapses||0));
  const recall=Math.max(0,(rec.unguided||0)-3*(rec.recallLapses||0));
  if(copy<COPY_THRESHOLD)return 0;
  // お/を and オ/ヲ can sound the same. Don't ask for an ambiguous symbol by sound alone.
  if(voice&&recall>=RECALL_THRESHOLD&&!/[おをオヲ]/.test(ch))return 2;
  return 1;
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
  const stats=()=>progress.writing;
  let script=level===1?"hira":"both", adaptive=true;
  const speak=ch=>{if(voice())KanaTTS.say(ch,.9);};
  const leave=()=>{KanaTTS.stop();KanaTTS.bindStatus(null);back();};
  function menu(){
    KanaTTS.stop();
    c.replaceChildren(el("div",{className:"kt-menu"},
      el("h3",{textContent:"✍ Тренажёр письма"}),
      el("p",{className:"kn-muted",textContent:"Рисуй мышью, пальцем или пером. Проверяются форма, направление, начало и конец штрихов в правильном порядке."}),
      el("div",{className:"kn-builder"},el("label",{className:"kn-bsel"},el("span",{textContent:"Азбука"}),el("select",{onchange:e=>script=e.target.value},...[["hira","Хирагана"],["kata","Катакана"],["both","Обе азбуки"]].map(([value,textContent])=>el("option",{value,textContent,selected:value===script})))),
      el("label",{className:"kn-check"},el("input",{type:"checkbox",checked:adaptive,onchange:e=>adaptive=e.target.checked}),"Адаптивные подсказки (сначала эталон, затем память)")),
      el("p",{className:"kn-muted",textContent:"После 5 чистых написаний исчезает эталон; после 25 чистых написаний без него остаётся только звук и название азбуки. Ошибки возвращают подсказки."}),
      el("button",{className:"kn-btn kt-go",textContent:"▶ 6 знаков",onclick:start}),el("button",{className:"kn-btn",textContent:"Назад",onclick:leave}),
      el("a",{className:"kn-muted",href:"/js/apps/kana-strokes.LICENSE.txt",target:"_blank",rel:"noopener",textContent:"Эталоны KanjiVG · CC BY-SA 3.0"})));
  }
  function start(){
    const pool=Object.keys(data.kana).filter(ch=>script==="both"||(script==="hira"?/[ぁ-ゖ]/.test(ch):/[ァ-ヺ]/.test(ch)));
    const fav=[...new Set(preferred.flatMap(s=>[...s.normalize("NFD").replace(/[\u3099\u309a]/g,"")]))].filter(ch=>pool.includes(ch));
    // Weak glyphs are favored, but every glyph (including mastered ones) remains eligible.
    const priority=ch=>{const r=stats()[ch]||{};return 1+Math.min(5,(r.err||0)/(1+(r.ok||0)))+(writingStage(ch,r,voice())===0?2:0);};
    const weak=pool.map(ch=>[ch,-Math.log(Math.max(Number.EPSILON,Math.random()))/priority(ch)]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
    const chars=[...new Set([...shuffle(fav).slice(0,3),...weak])].slice(0,6);
    let at=0,ok=0,errors=0;
    function next(){
      KanaTTS.stop();
      if(at>=chars.length){KanaTTS.bindStatus(null);c.replaceChildren(el("div",{className:"kt-menu"},el("h3",{textContent:"Письмо завершено"}),el("p",{textContent:ok+" знаков написано · "+errors+" ошибок штриха"}),el("button",{className:"kn-btn kt-go",textContent:"Ещё 6 знаков",onclick:start}),el("button",{className:"kn-btn",textContent:"Назад",onclick:leave})));return;}
      const ch=chars[at],refs=data.kana[ch].strokes;
      const stage=adaptive?writingStage(ch,stats()[ch],voice()):0;
      let guided=stage===0,showGlyph=stage!==2,assisted=false;
      let step=0,pointer=null,points=[],ink,finished=false,timer,hadError=false,lapse=false;
      const record=()=>stats()[ch]||={ok:0,err:0};
      function loseCredit(){
        if(lapse||!adaptive)return;
        lapse=true;
        const rec=record();
        rec.copyLapses=(rec.copyLapses||0)+1;
        if(stage>=1)rec.recallLapses=(rec.recallLapses||0)+1;
        saveProgress();
      }
      const board=svg("svg",{viewBox:"0 0 109 109",class:"kw-board","aria-label":"Поле письма"});
      const guides=svg("g"),accepted=svg("g"),draw=svg("g");
      board.append(svg("path",{d:"M54.5 0V109M0 54.5H109M0 0L109 109M109 0L0 109",class:"kw-grid"}),guides,accepted,draw);
      const ref=refs.map(r=>svg("path",{d:r.path,class:"kw-reference"}));ref.forEach(p=>guides.append(p));
      const dot=svg("circle",{r:2.4,class:"kw-dot"});guides.append(dot);
      const num=el("b"),note=el("p",{className:"kw-note",role:"status"}),status=el("p",{className:"kn-muted",role:"status"});
      const glyph=el("span",{className:"kw-character",textContent:showGlyph?ch:"？"});
      const mode=el("p",{className:"kn-muted",textContent:["Обводка по эталону","Письмо по образцу знака","Письмо на слух"][stage]+" · "+(/[ァ-ヺ]/.test(ch)?"катакана":"хирагана")});
      const toggle=el("button",{className:"kn-btn small",onclick:()=>{
        if(finished)return;
        if(guided){guided=false;}
        else{guided=true;showGlyph=true;if(stage>0){assisted=true;loseCredit();}}
        paint();
      }});
      const reveal=el("button",{className:"kn-btn small",textContent:"Показать знак",hidden:stage!==2,onclick:()=>{
        if(finished||showGlyph)return;showGlyph=true;assisted=true;loseCredit();paint();
      }});
      const card=el("div",{className:"kt-menu kw-card"},el("div",{className:"kt-top"},el("b",{textContent:"Письмо "+(at+1)+" / "+chars.length}),el("span",{className:"kt-sp"}),el("button",{className:"kn-btn small",textContent:"✕ Назад",onclick:leave})),
        el("div",{className:"kw-heading"},glyph,el("div",{},num,mode),el("button",{className:"kn-btn",textContent:"🔊",title:"Повторить произношение",onclick:()=>speak(ch)})),
        board,note,status,el("div",{className:"kn-row"},toggle,reveal,el("button",{className:"kn-btn small",textContent:"Заново",onclick:()=>{if(finished)return;if(step||pointer!==null){assisted=true;loseCredit();}pointer=null;step=0;draw.replaceChildren();accepted.replaceChildren();note.textContent="";paint();}}),el("button",{className:"kn-btn small",textContent:"Пропустить →",onclick:()=>{clearTimeout(timer);if(!finished){loseCredit();finished=true;}at++;next();}})));
      c.replaceChildren(card);KanaTTS.bindStatus(status);
      function paint(){
        glyph.textContent=showGlyph||finished?ch:"？";
        reveal.hidden=stage!==2||showGlyph||finished;
        toggle.textContent=guided?"Скрыть эталон":"Показать эталон";
        // Stroke count, start point and outline would leak the answer at the audio-only stage.
        num.textContent=stage===2&&!showGlyph&&!finished?"Напиши услышанный знак":"Штрих "+Math.min(step+1,refs.length)+" / "+refs.length;
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
        const error=assessStroke(points,target),rec=stats()[ch]||={ok:0,err:0};
        draw.replaceChildren();
        if(error){errors++;hadError=true;rec.err++;loseCredit();saveProgress();note.textContent=error;note.className="kw-note kt-warn";ink.classList.add("kw-wrong");draw.append(ink);Juice.buzz();return;}
        ink.classList.add("kw-right");accepted.append(ink);step++;Juice.ding(step);paint();note.textContent="Верно!";note.className="kw-note";
        if(step===refs.length){
          finished=true;ok++;
          if(!hadError&&!assisted){
            rec.ok++;
            if(stage>=1&&!guided)rec.unguided=(rec.unguided||0)+1;
            if(stage===2&&!showGlyph)rec.audioOk=(rec.audioOk||0)+1;
          }
          rec.last=Date.now();saveProgress();paint();speak(ch);
          const now=writingStage(ch,rec,voice());
          if(adaptive&&now>stage)note.textContent=now===2?"Отлично! Следующий раз — на слух.":"Отлично! Следующий раз — без эталона.";
          timer=setTimeout(()=>{if(card.isConnected){at++;next();}},now>stage?1800:1050);
        }
      });
      paint();speak(ch);
    }
    next();
  }
  menu();
}
