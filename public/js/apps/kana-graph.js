import { el } from "../core/util.js";
const NS="http://www.w3.org/2000/svg";
function svg(tag,attrs={},text){
  const n=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);
  if(text!==undefined)n.textContent=text;return n;
}
export function historyGraph(history){
  const hist=history.slice(-30);
  const root=el("div",{className:"kt-history-graph"},el("h3",{textContent:"📈 Прогресс обучения"}));
  if(!hist.length){root.append(el("p",{className:"kn-muted",textContent:"После первого урока здесь появится история."}));return root;}
  const chart=(title,series,max,suffix)=>{
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
      const pts=hist.map((h,i)=>[x(i),y(Math.max(0,Math.min(max,s.value(h))))]);
      if(pts.length>1)plot.append(svg("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:s.color,"stroke-width":2.4,"stroke-linejoin":"round","stroke-linecap":"round"}));
      pts.forEach((p,i)=>{const dot=svg("circle",{cx:p[0],cy:p[1],r:3.3,fill:s.color});dot.append(svg("title",{},new Date(hist[i].at).toLocaleString("ru-RU")+" · "+s.name+": "+s.value(hist[i])+suffix+" · ур. "+hist[i].level));plot.append(dot);});
    }
    return el("div",{className:"kt-graph-panel"},el("b",{textContent:title}),plot,el("div",{className:"kt-graph-legend"},...series.map(s=>el("span",{},el("i",{style:"background-color:"+s.color}),s.name))));
  };
  const speedMax=Math.max(20,Math.ceil(Math.max(...hist.map(h=>Number(h.kpm)||0))/20)*20);
  root.append(chart("Точность (%)",[{name:"Урок",color:"#79d6a5",value:h=>parseInt(h.acc)||0},{name:"Проверка",color:"#82aaff",value:h=>parseInt(h.check)||0}],100,"%"),chart("Скорость (знаков/мин)",[{name:"Скорость",color:"#f2be75",value:h=>Number(h.kpm)||0}],speedMax,""));
  root.append(el("p",{className:"kn-muted",textContent:"Последние "+hist.length+" уроков · наведи на точку для даты и уровня. Сложность уроков может различаться."}));
  return root;
}
