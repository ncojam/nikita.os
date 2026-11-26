import { el } from "../core/util.js";
import { progress as p, accountInfo, scriptOf, dayKey } from "./kana-progress.js";
import { historyGraph, trendGraph, barGraph, graphColors as C } from "./kana-graph.js";
import { writingStage } from "./kana-write.js";
import { WORDS, COLS, cell } from "./kana-data.js";
const n=x=>Number(x)||0, sum=(rows,key)=>rows.reduce((s,x)=>s+n(x[key]),0);
const pct=(a,b)=>a+b?Math.round(a/(a+b)*100)+"%":"—";
const time=ms=>ms?Math.round(ms/1000)+" с":"—";
const date=t=>new Date(t).toLocaleString("ru-RU");
const dict=new Map([...WORDS.hira,...WORDS.kata].map(w=>[w.k,w.m]));
const names={type:"Учебная печать",check:"Свободная проверка",exam:"Экзамен",writing:"Письмо"};
const scripts={all:"Все азбуки",hira:"Хирагана",kata:"Катакана",mixed:"Смешанные фразы",other:"Прочее"};
const modeRows=(mode,script="all")=>Object.entries(p.modeStats).filter(([k])=>k.startsWith(mode+".")&&(script==="all"||k===mode+"."+script)).map(([,v])=>v);
const SERIES=[{key:"ok",name:"Верно",color:C.good},{key:"err",name:"Ошибки / пропуски",color:C.bad}];
const MODES=Object.keys(names);
const countRow=(label,rows)=>({label,ok:sum(rows,"ok"),err:sum(rows,"err"),ms:sum(rows,"ms"),scriptFallback:sum(rows,"scriptFallback"),strokeOk:sum(rows,"strokeOk"),strokeErr:sum(rows,"strokeErr"),completed:sum(rows,"completed"),skipped:sum(rows,"skipped"),assisted:sum(rows,"assisted")});
const ratio=(ok,err)=>ok+err?100*ok/(ok+err):null;
const scale=values=>Math.max(4,Math.ceil(Math.max(0,...values.filter(Number.isFinite))/4)*4);
export function dailyRows(stats,period,now=new Date()){
  const days=[];
  for(let i=period-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i,12);days.push({day:dayKey(d),at:d.getTime(),rows:[]});}
  const index=new Map(days.map(d=>[d.day,d]));
  for(const [key,value] of Object.entries(stats)){
    const [day,kind]=key.split("|"),[mode,script]=(kind||"").split(".");
    if(index.has(day)&&MODES.includes(mode))index.get(day).rows.push({...value,mode,script});
  }
  // Suppress empty leading days rather than suggesting earlier zero activity.
  const first=days.findIndex(d=>d.rows.length);
  return first<0?[]:days.slice(first);
}
function dailyCharts(days,script,mode){
  const rows=days.map(d=>({...d,counts:countRow("",d.rows.filter(r=>(!mode||r.mode===mode)&&(script==="all"||script===r.script)))}));
  if(!rows.some(d=>d.rows.some(r=>(!mode||r.mode===mode)&&(script==="all"||script===r.script))))return el("p",{className:"kn-muted",textContent:"Графики по дням появятся после новых упражнений."});
  const chart=(title,series,max,suffix="")=>trendGraph(rows,title,series,max,suffix,90);
  const v=(name,color,value)=>({name,color,value});
  const count=(d,k)=>n(d.counts[k]);
  const attempts=d=>count(d,"ok")+count(d,"err");
  const seconds=d=>attempts(d)?count(d,"ms")/attempts(d)/1000:null;
  const out=el("div",{className:"ks-chart-grid"});
  if(!mode){
    out.append(chart("Точность по направлениям",MODES.map((m,i)=>v(names[m],[C.good,C.blue,C.gold,C.purple][i],d=>{const r=d.rows.filter(r=>r.mode===m&&(script==="all"||r.script===script));return ratio(sum(r,"ok"),sum(r,"err"));})),100,"%"));
  }else out.append(chart("Точность по дням",[v("Верно",C.good,d=>ratio(count(d,"ok"),count(d,"err")))],100,"%"));
  out.append(chart("Нагрузка: верно и ошибки",[v("Верно",C.good,d=>count(d,"ok")),v("Ошибки",C.bad,d=>count(d,"err"))],scale(rows.flatMap(d=>[count(d,"ok"),count(d,"err")]))),
    chart("Время упражнений, мин",[v("Минуты",C.blue,d=>count(d,"ms")/60000)],scale(rows.map(d=>count(d,"ms")/60000))," мин"));
  if(mode)out.append(chart("Среднее время ответа",[v("Секунды",C.gold,seconds)],scale(rows.map(seconds))," с"));
  if(mode==="writing"){
    out.append(chart("Штрихи: точность",[v("Верно",C.good,d=>ratio(count(d,"strokeOk"),count(d,"strokeErr")))],100,"%"),
      chart("Подсказки и пропуски",[v("С подсказкой",C.gold,d=>count(d,"assisted")),v("Пропуск",C.bad,d=>count(d,"skipped"))],scale(rows.flatMap(d=>[count(d,"assisted"),count(d,"skipped")]))));
  }else if(mode){
    out.append(chart("Принято по чтению",[v("Смена азбуки не удалась",C.purple,d=>count(d,"scriptFallback"))],scale(rows.map(d=>count(d,"scriptFallback")))));
  }
  return out;
}
function heatmap(field,script,mode,writing=false){
  const az=script==="all"?["hira","kata"]:["hira","kata"].includes(script)?[script]:[];
  if(!az.length)return "";
  return el("div",{className:"ks-chart-grid"},...az.map(sc=>{
    const cols=COLS.filter(c=>!writing||!c.dk);
    const grid=el("div",{className:"ks-heat-grid",style:"grid-template-columns:repeat("+cols.length+",minmax(24px,1fr))"});
    for(let i=0;i<5;i++)for(const c of cols){
      const x=cell(sc,c.c,i);
      if(!x){grid.append(el("span"));continue;}
      const r=field[x.ch]||{},ok=writing?n(r.ok):mode?n(r[mode+"Ok"]):MODES.slice(0,3).reduce((a,m)=>a+n(r[m+"Ok"]),0),err=writing?Math.max(0,n(r.completed)-n(r.ok))+n(r.skipped):mode?n(r[mode+"Err"]):MODES.slice(0,3).reduce((a,m)=>a+n(r[m+"Err"]),0);
      const stage=writingStage(x.ch,r,true);
      const rate=ratio(ok,err),seen=writing?!!(r.ok||r.err||r.completed||r.skipped):rate!==null;
      const color=!seen?"#8091a526":writing?["#f2be7566","#82aaff77","#79d6a588"][stage]:rate>=85?"#79d6a588":rate>=60?"#f2be7577":"#f08a8a88";
      const label=writing?(seen?["Эталон","По образцу","На слух"][stage]:"Нет данных"):(rate===null?"Нет данных":Math.round(rate)+"% · "+ok+" верно / "+err+" ошибок");
      grid.append(el("span",{className:"ks-heat-cell",style:"background:"+color,title:x.ch+" · "+x.ro+" · "+label,tabIndex:0,textContent:x.ch}));
    }
    return el("div",{className:"kt-graph-panel"},el("b",{textContent:scripts[sc]+(writing?" · этапы письма":" · точность слогов")}),el("div",{className:"ks-heat-scroll"},grid),
      el("p",{className:"kn-muted",textContent:writing?"Серый — нет данных, жёлтый — эталон, синий — по образцу, зелёный — на слух.":"Серый — нет данных, красный — <60%, жёлтый — 60–84%, зелёный — ≥85%. Только отдельные знаки, сочетания — в таблице."}));
  }));
}
const stat=(label,value)=>el("div",{className:"ks-metric"},el("b",{textContent:String(value)}),el("small",{textContent:label}));
const block=(title,...children)=>el("section",{className:"ks-panel"},el("h3",{textContent:title}),...children);
function table(headers,rows){
  if(!rows.length)return el("p",{className:"kn-muted",textContent:"Пока нет данных по этому направлению."});
  return el("div",{className:"ks-table-wrap"},el("table",{className:"ks-table"},el("thead",{},el("tr",{},...headers.map(x=>el("th",{textContent:x})))),el("tbody",{},...rows.map(row=>el("tr",{},...row.map(x=>el("td",{textContent:String(x)})))))));
}
export function renderKanaStats(c,back,initial="overview"){
  let tab=initial,script="all",query="",onlyWeak=false,period=30;
  const root=el("div",{className:"kt-menu ks-page"}),body=el("div",{className:"ks-body"});
  const controls=el("div",{className:"kn-row ks-tabs"});
  const filter=el("select",{onchange:e=>{script=e.target.value;paint();}},...Object.entries(scripts).map(([value,textContent])=>el("option",{value,textContent})));
  const range=el("select",{onchange:e=>{period=+e.target.value;paint();}},...[[7,"7 дней"],[30,"30 дней"],[90,"90 дней"]].map(([value,textContent])=>el("option",{value,textContent,selected:value===30})));
  const search=el("input",{className:"kt-in",placeholder:"Найти слово, знак или перевод",oninput:e=>{query=e.target.value.toLowerCase();paint();}});
  const weak=el("input",{type:"checkbox",onchange:e=>{onlyWeak=e.target.checked;paint();}});
  root.append(el("div",{className:"kt-top"},el("h3",{textContent:"📊 Статистика Каны"}),el("span",{className:"kt-sp"}),el("button",{className:"kn-btn",textContent:"Назад",onclick:back})),
    el("p",{className:"kn-muted",textContent:accountInfo().uid===null?"Гостевой прогресс · в браузере":"Прогресс аккаунта "+accountInfo().nick}),controls,
    el("div",{className:"kn-row"},filter,range,search,el("label",{className:"kn-check"},weak,"Только ошибки")),body);
  c.replaceChildren(root);
  function paint(){
    controls.replaceChildren(...Object.entries({overview:"Обзор",type:"Печать",check:"Проверка",exam:"Экзамены",writing:"Письмо",words:"Слова",kana:"Слоги"}).map(([id,label])=>el("button",{className:"kn-btn"+(id===tab?" kt-go":""),textContent:label,onclick:()=>{tab=id;paint();}})));
    body.replaceChildren();
    const matches=(k,r)=> (script==="all"||scriptOf(k)===script)&&(!query||(k+" "+(r.ru||dict.get(k)||"")).toLowerCase().includes(query));
    const days=dailyRows(p.dailyStats,period);
    const byScript=mode=>Object.keys(scripts).filter(k=>k!=="all"&&(script==="all"||script===k)).map(k=>countRow(scripts[k],modeRows(mode,k)));
    const comparisons=(title,rows)=>el("div",{className:"ks-chart-grid"},barGraph(title+" · количество",rows,SERIES),barGraph(title+" · доля",rows,SERIES,true));
    const top=(field,mode)=>{
      const rows=Object.entries(p[field]).filter(([k,r])=>matches(k,r)).map(([k,r])=>({label:k,ok:mode?n(r[mode+"Ok"]):field==="words"?n(r.ok):["type","check","exam"].reduce((a,m)=>a+n(r[m+"Ok"]),0),err:mode?n(r[mode+"Err"]):field==="words"?n(r.err):["type","check","exam"].reduce((a,m)=>a+n(r[m+"Err"]),0)}));
      return barGraph("Топ ошибок · "+(field==="words"?"слова":"слоги"),rows.filter(r=>r.err>0).sort((a,b)=>b.err-a.err).slice(0,12),SERIES);
    };
    const timeline=(mode)=>block("Динамика · последние "+period+" календарных дней",dailyCharts(days,script,mode),el("p",{className:"kn-muted",textContent:"Время — длительность карточек, включая паузы; только зафиксированные упражнения. Дни без ответов не получают оценку точности."}));
    const history=(title,hist,series,suffix="")=>trendGraph(hist,title,series,scale(hist.flatMap(r=>series.map(x=>x.value(r)))),suffix);
    const metrics=(mode)=>{
      const rows=modeRows(mode,script),ok=sum(rows,"ok"),err=sum(rows,"err"),skip=sum(rows,"skipped");
      return el("div",{className:"ks-metrics"},stat("Без ошибок",ok),stat("С ошибками / пропуском",err),stat("Точность карточек",pct(ok,err)),stat("Среднее время",time((ok+err)?sum(rows,"ms")/(ok+err):0)),...(mode!=="writing"?[stat("Принято по чтению",sum(rows,"scriptFallback"))]:[]),...(mode==="writing"?[stat("Верных штрихов",sum(rows,"strokeOk")),stat("Ошибок штрихов",sum(rows,"strokeErr")),stat("Пропущено",skip)]:mode==="exam"?[stat("Не вспомнил",skip)]:[]));
    };
    const modeTable=(field,mode)=>{
      const rows=Object.entries(p[field]).filter(([k,r])=>matches(k,r)&&n(r[mode+"Ok"])+n(r[mode+"Err"])>0&&(!onlyWeak||n(r[mode+"Err"])));
      rows.sort((a,b)=>n(b[1][mode+"Err"])-n(a[1][mode+"Err"])||n(b[1][mode+"Ok"])-n(a[1][mode+"Ok"]));
      return table(["Знак / слово","Перевод","Верно","Ошибок","Точность"],rows.map(([k,r])=>[k,field==="words"?dict.get(k)||r.ru||"—":"—",n(r[mode+"Ok"]),n(r[mode+"Err"]),pct(n(r[mode+"Ok"]),n(r[mode+"Err"]))]));
    };
    const allTable=field=>{
      const rows=Object.entries(p[field]).filter(([k,r])=>matches(k,r)&&(!onlyWeak||n(r.err)+n(r.typeErr)+n(r.checkErr)+n(r.examErr)>0));
      rows.sort((a,b)=>n(b[1].err)+n(b[1].typeErr)+n(b[1].checkErr)+n(b[1].examErr)-n(a[1].err)-n(a[1].typeErr)-n(a[1].checkErr)-n(a[1].examErr));
      return table(["Знак / слово",...(field==="words"?["Перевод"]:[]),"Печать В/О","Проверка В/О","Экзамен В/О",...(field==="words"||field==="kana"?["Все верно / ошибки"]:[])],rows.map(([k,r])=>[k,...(field==="words"?[dict.get(k)||r.ru||"—"]:[]),...["type","check","exam"].map(m=>n(r[m+"Ok"])+"/"+n(r[m+"Err"])),...(field==="words"||field==="kana"?[n(r.ok)+"/"+n(r.err)]:[])]));
    };
    if(tab==="overview"){
      const modes=MODES.map(m=>countRow(names[m],modeRows(m,script)));
      body.append(block("Сравнение направлений (за всё время)",comparisons("Карточки",modes)),timeline());
      for(const mode of MODES)body.append(block(names[mode],metrics(mode)));
      body.append(block("Общая история печати",historyGraph(p.hist)),el("p",{className:"kn-muted",textContent:"Раздельные показатели начинают накапливаться после обновления. Старые общие счётчики и истории сохранены."}));
    }else if(tab==="type"||tab==="check"){
      body.append(block(names[tab],metrics(tab),comparisons("По азбукам",byScript(tab))),timeline(tab),block("Карта знаков",heatmap(p.scriptKana,script,tab)),block("Слабые места",el("div",{className:"ks-chart-grid"},top("words",tab),top("scriptKana",tab))),block("По слогам и азбукам",modeTable("scriptKana",tab)),block("По словам",modeTable("words",tab)),block("Общая история уроков (все азбуки)",historyGraph(p.hist)));
    }else if(tab==="exam"){
      const hist=p.examHist;
      body.append(block("Экзамены",metrics("exam"),comparisons("По азбукам",byScript("exam"))),timeline("exam"),block("Результаты завершённых экзаменов · все азбуки",el("p",{textContent:"Завершено экзаменов (вся история): "+hist.length}),trendGraph(hist,"Результаты экзаменов · все азбуки",[{name:"Верно",color:"#82aaff",value:r=>Math.round(r.ok/r.total*100)}],100,"%"),history("Время экзамена",hist,[{name:"Секунды",color:C.gold,value:r=>r.ms==null?null:r.ms/1000}]," с"),barGraph("Последние экзамены",hist.slice(-12).map((r,i)=>({label:new Date(r.at).toLocaleDateString("ru-RU"),ok:r.ok,err:r.total-r.ok})),SERIES)),block("Слабые места",el("div",{className:"ks-chart-grid"},top("words","exam"),top("scriptKana","exam"))),
        block("История экзаменов",table(["Дата","Верно / всего","Время"],hist.slice().reverse().map(r=>[date(r.at),r.ok+"/"+r.total,time(r.ms)]))),block("Слова на экзамене",modeTable("words","exam")),block("Слоги на экзамене",modeTable("scriptKana","exam")));
    }else if(tab==="writing"){
      const rows=Object.entries(p.writing).filter(([k,r])=>matches(k,r)&&(!onlyWeak||n(r.err)+n(r.skipped)>0)).sort((a,b)=>n(b[1].err)-n(a[1].err));
      const hist=p.writingHist;
      body.append(block("Рукописное письмо",metrics("writing"),comparisons("По азбукам",byScript("writing"))),timeline("writing"),block("Карта освоения глифов",heatmap(p.writing,script,null,true)),block("Этапы письма",barGraph("Все базовые знаки",["hira","kata"].filter(sc=>script==="all"||script===sc).map(sc=>{const r={label:scripts[sc],unseen:0,copy:0,recall:0,audio:0};for(const col of COLS.filter(c=>!c.dk))for(let i=0;i<5;i++){const x=cell(sc,col.c,i);if(!x)continue;const v=p.writing[x.ch];r[!v?"unseen":["copy","recall","audio"][writingStage(x.ch,v,true)]]++;}return r;}),[{key:"audio",name:"На слух",color:C.good},{key:"recall",name:"По образцу",color:C.blue},{key:"copy",name:"Эталон",color:C.gold},{key:"unseen",name:"Нет данных",color:C.gray}]),barGraph("Глифы с ошибками штрихов",rows.filter(([,r])=>r.err).slice(0,12).map(([k,r])=>({label:k,err:n(r.err)})),[{key:"err",name:"Ошибки штрихов",color:C.bad}])),block("История занятий · все азбуки",trendGraph(hist,"Чистые глифы за занятие · все азбуки",[{name:"Без ошибок",color:"#79d6a5",value:r=>Math.round(r.ok/r.total*100)}],100,"%"),trendGraph(hist,"Точность штрихов",[{name:"Верные штрихи",color:C.blue,value:r=>ratio(n(r.strokeOk),n(r.strokeErr))}],100,"%"),history("Время занятия",hist,[{name:"Секунды",color:C.gold,value:r=>r.ms==null?null:r.ms/1000}]," с"),history("Ошибки и пропуски",hist,[{name:"Ошибки штрихов",color:C.bad,value:r=>r.strokeErr},{name:"Пропуски",color:C.gold,value:r=>r.skipped}])),
        block("Освоение глифов",table(["Глиф","Чистых","Без контура","На слух","Ошибки штрихов","Пропуск","Этап"],rows.map(([k,r])=>[k,n(r.ok),n(r.unguided),n(r.audioOk),n(r.err),n(r.skipped),["Эталон","По образцу","На слух"][writingStage(k,r,true)]]))),
        block("История письма",table(["Дата","Чистых / всего","Завершено","Ошибки штрихов","Время"],hist.slice().reverse().map(r=>[date(r.at),r.ok+"/"+r.total,r.completed,r.strokeErr,time(r.ms)]))));
    }else if(tab==="words"){
      const coverage=["hira","kata","mixed"].filter(sc=>script==="all"||script===sc).map(sc=>{
        const words=[...dict.keys()].filter(k=>scriptOf(k)===sc),r={label:scripts[sc],exam:0,seen:0,unseen:0};
        for(const k of words){const w=p.words[k];r[!w?"unseen":n(w.examOk)>0?"exam":"seen"]++;}return r;
      });
      const first=Object.entries(p.words).filter(([k,r])=>dict.has(k)&&matches(k,r)&&r.first);
      const learned=dailyRows(p.dailyStats,period).map(d=>({...d,newWords:first.filter(([,r])=>dayKey(new Date(r.first))===d.day).length}));
      let running=0;for(const d of learned){running+=d.newWords;d.cumulative=running;}
      body.append(block("Словарный запас",el("p",{textContent:"Слов в словаре: "+dict.size+" · встречалось: "+[...dict.keys()].filter(k=>p.words[k]).length}),barGraph("Охват словаря",coverage,[{key:"exam",name:"Хотя бы раз верно на экзамене",color:C.good},{key:"seen",name:"Встречалось",color:C.blue},{key:"unseen",name:"Ещё не встречалось",color:C.gray}]),trendGraph(learned,"Первые раздельные записи слов за период",[{name:"Новых записей",color:C.blue,value:d=>d.newWords}],scale(learned.map(d=>d.newWords)),"",90),trendGraph(learned,"Накопление новых записей за период",[{name:"Слова",color:C.good,value:d=>d.cumulative}],scale(learned.map(d=>d.cumulative)),"",90),el("p",{className:"kn-muted",textContent:"Дата первой раздельной записи сохраняется с этого обновления; это не дата первого знакомства со старыми словами."})),block("Слова с ошибками",top("words")),block("Подробности",allTable("words")));
    }else{
      body.append(block("Карта точности знаков",heatmap(p.scriptKana,script)),block("Частые ошибки",top("scriptKana")),block("Точные знаки с разделением азбук",allTable("scriptKana")),block("Старая общая статистика (объединена в хирагану)",allTable("kana")));
    }
  }
  paint();
}
