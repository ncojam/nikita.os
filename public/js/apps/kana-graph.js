import { el } from "../core/util.js";
const NS="http://www.w3.org/2000/svg";
function svg(tag,attrs={},text){
  const n=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);
  if(text!==undefined)n.textContent=text;return n;
}
export function trendGraph(hist,title,series,max,suffix="",limit=30){
    hist=hist.slice(-limit);
    max=Math.max(1,max);
    if(!hist.length)return el("p",{className:"kn-muted",textContent:"Пока нет записей."});
    const W=520,H=150,l=40,r=16,t=12,b=25;
    const plot=svg("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":title,class:"kt-graph-svg"});
    const x=i=>l+(W-l-r)*(hist.length===1?.5:i/(hist.length-1));
    const y=v=>t+(H-t-b)*(1-v/max);
    for(let i=0;i<=4;i++){
      const v=max*i/4,py=y(v);
      plot.append(svg("line",{x1:l,x2:W-r,y1:py,y2:py,class:"kt-graph-grid"}),svg("text",{x:l-6,y:py+3,"text-anchor":"end",class:"kt-graph-label"},Math.round(v)+suffix));
    }
    const ticks=[...new Set([0,Math.floor((hist.length-1)/2),hist.length-1])];
    for(const i of ticks){
      const date=new Date(hist[i].at);
      plot.append(svg("text",{x:x(i),y:H-6,"text-anchor":"middle",class:"kt-graph-label"},Number.isFinite(date.getTime())?date.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"}):String(i+1)));
    }
    for(const s of series){
      // Missing observations are gaps, never zero accuracy or zero speed.
      let points=[];
      const line=()=>{if(points.length>1)plot.append(svg("polyline",{points:points.join(" "),fill:"none",stroke:s.color,"stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));points=[];};
      hist.forEach((h,i)=>{
        const value=s.value(h);if(value==null||!Number.isFinite(value)){line();return;}
        const px=x(i),py=y(Math.max(0,Math.min(max,value)));points.push(px+","+py);
        const dot=svg("circle",{cx:px,cy:py,r:hist.length>45?2:3.3,fill:s.color,tabindex:0});
        dot.append(svg("title",{},new Date(h.at).toLocaleString("ru-RU")+" · "+s.name+": "+Math.round(value*10)/10+suffix+(h.level?" · ур. "+h.level:"")));plot.append(dot);
      });line();
    }
    return el("div",{className:"kt-graph-panel"},el("b",{textContent:title}),plot,el("div",{className:"kt-graph-legend"},...series.map(s=>el("span",{},el("i",{style:"background-color:"+s.color}),s.name))));
}
export function historyGraph(history){
  const hist=history.slice(-30);
  const root=el("div",{className:"kt-history-graph"},el("h3",{textContent:"📈 Прогресс обучения"}));
  if(!hist.length){root.append(el("p",{className:"kn-muted",textContent:"После первого урока здесь появится история."}));return root;}
  const chart=(title,series,max,suffix)=>trendGraph(hist,title,series,max,suffix);
  const speedMax=Math.max(20,Math.ceil(Math.max(...hist.map(h=>Number(h.kpm)||0))/20)*20);
  root.append(chart("Точность (%)",[{name:"Урок",color:"#79d6a5",value:h=>parseInt(h.acc)||0},{name:"Проверка",color:"#82aaff",value:h=>parseInt(h.check)||0}],100,"%"),chart("Скорость (знаков/мин)",[{name:"Скорость",color:"#f2be75",value:h=>Number(h.kpm)||0}],speedMax,""));
  root.append(chart("Сложность: уровень урока",[{name:"Уровень",color:"#bd9af6",value:h=>Number(h.level)||0}],6,""));
  root.append(el("p",{className:"kn-muted",textContent:"Последние "+hist.length+" уроков · наведи на точку для даты и уровня. Сложность уроков может различаться."}));
  return root;
}

export const graphColors={good:"#79d6a5",bad:"#f08a8a",blue:"#82aaff",gold:"#f2be75",purple:"#bd9af6",gray:"#8b96a5"};
// Horizontal comparison charts, absolute stacked values or a common percentage scale.
export function barGraph(title,rows,series,percent=false){
  if(!rows.length||!rows.some(r=>series.some(s=>Number(r[s.key])>0)))return el("p",{className:"kn-muted",textContent:title+" — пока нет данных."});
  const total=r=>series.reduce((a,s)=>a+Math.max(0,Number(r[s.key])||0),0);
  const max=percent?100:Math.max(1,...rows.map(total));
  return el("div",{className:"kt-graph-panel"},el("b",{textContent:title}),
    el("div",{className:"ks-bars"},...rows.map(r=>{
      const t=total(r),value=s=>Math.max(0,Number(r[s.key])||0);
      return el("div",{className:"ks-bar-row",title:r.label+" · "+series.map(s=>s.name+": "+value(s)).join(" · ")},
        el("span",{className:"ks-bar-label",textContent:r.label}),
        el("div",{className:"ks-bar-track"},...series.map(s=>el("span",{style:"width:"+(percent?(t?100*value(s)/t:0):100*value(s)/max)+"%;background:"+s.color}))),
        el("span",{className:"ks-bar-value",textContent:percent?(t?Math.round(100*value(series[0])/t)+"%":"—"):String(Math.round(t*10)/10)}));
    })),el("div",{className:"kt-graph-legend"},...series.map(s=>el("span",{},el("i",{style:"background-color:"+s.color}),s.name))));
}
