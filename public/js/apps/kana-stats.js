import { el } from "../core/util.js";
import { progress as p, accountInfo, scriptOf } from "./kana-progress.js";
import { historyGraph, trendGraph } from "./kana-graph.js";
import { writingStage } from "./kana-write.js";
import { WORDS } from "./kana-data.js";
const n=x=>Number(x)||0, sum=(rows,key)=>rows.reduce((s,x)=>s+n(x[key]),0);
const pct=(a,b)=>a+b?Math.round(a/(a+b)*100)+"%":"—";
const time=ms=>ms?Math.round(ms/1000)+" с":"—";
const date=t=>new Date(t).toLocaleString("ru-RU");
const dict=new Map([...WORDS.hira,...WORDS.kata].map(w=>[w.k,w.m]));
const names={type:"Учебная печать",check:"Свободная проверка",exam:"Экзамен",writing:"Письмо"};
const scripts={all:"Все азбуки",hira:"Хирагана",kata:"Катакана",mixed:"Смешанные фразы",other:"Прочее"};
const modeRows=(mode,script="all")=>Object.entries(p.modeStats).filter(([k])=>k.startsWith(mode+".")&&(script==="all"||k===mode+"."+script)).map(([,v])=>v);
const stat=(label,value)=>el("div",{className:"ks-metric"},el("b",{textContent:String(value)}),el("small",{textContent:label}));
const block=(title,...children)=>el("section",{className:"ks-panel"},el("h3",{textContent:title}),...children);
function table(headers,rows){
  if(!rows.length)return el("p",{className:"kn-muted",textContent:"Пока нет данных по этому направлению."});
  return el("div",{className:"ks-table-wrap"},el("table",{className:"ks-table"},el("thead",{},el("tr",{},...headers.map(x=>el("th",{textContent:x})))),el("tbody",{},...rows.map(row=>el("tr",{},...row.map(x=>el("td",{textContent:String(x)})))))));
}
export function renderKanaStats(c,back,initial="overview"){
  let tab=initial,script="all",query="",onlyWeak=false;
  const root=el("div",{className:"kt-menu ks-page"}),body=el("div",{className:"ks-body"});
  const controls=el("div",{className:"kn-row ks-tabs"});
  const filter=el("select",{onchange:e=>{script=e.target.value;paint();}},...Object.entries(scripts).map(([value,textContent])=>el("option",{value,textContent})));
  const search=el("input",{className:"kt-in",placeholder:"Найти слово, знак или перевод",oninput:e=>{query=e.target.value.toLowerCase();paint();}});
  const weak=el("input",{type:"checkbox",onchange:e=>{onlyWeak=e.target.checked;paint();}});
  root.append(el("div",{className:"kt-top"},el("h3",{textContent:"📊 Статистика Каны"}),el("span",{className:"kt-sp"}),el("button",{className:"kn-btn",textContent:"Назад",onclick:back})),
    el("p",{className:"kn-muted",textContent:accountInfo().uid===null?"Гостевой прогресс · в браузере":"Прогресс аккаунта "+accountInfo().nick}),controls,
    el("div",{className:"kn-row"},filter,search,el("label",{className:"kn-check"},weak,"Только ошибки")),body);
  c.replaceChildren(root);
  function paint(){
    controls.replaceChildren(...Object.entries({overview:"Обзор",type:"Печать",check:"Проверка",exam:"Экзамены",writing:"Письмо",words:"Слова",kana:"Слоги"}).map(([id,label])=>el("button",{className:"kn-btn"+(id===tab?" kt-go":""),textContent:label,onclick:()=>{tab=id;paint();}})));
    body.replaceChildren();
    const matches=(k,r)=> (script==="all"||scriptOf(k)===script)&&(!query||(k+" "+(r.ru||dict.get(k)||"")).toLowerCase().includes(query));
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
      for(const mode of Object.keys(names))body.append(block(names[mode],metrics(mode)));
      body.append(block("Общая история печати",historyGraph(p.hist)),el("p",{className:"kn-muted",textContent:"Раздельные показатели начинают накапливаться после обновления. Старые общие счётчики и истории сохранены."}));
    }else if(tab==="type"||tab==="check"){
      body.append(block(names[tab],metrics(tab)),block("По слогам и азбукам",modeTable("scriptKana",tab)),block("По словам",modeTable("words",tab)),block("Общая история уроков (все азбуки)",historyGraph(p.hist)));
    }else if(tab==="exam"){
      const hist=p.examHist;
      body.append(block("Экзамены",metrics("exam"),el("p",{textContent:"Завершено экзаменов (вся история): "+hist.length}),trendGraph(hist,"Результаты экзаменов · все азбуки",[{name:"Верно",color:"#82aaff",value:r=>Math.round(r.ok/r.total*100)}],100,"%")),
        block("История экзаменов",table(["Дата","Верно / всего","Время"],hist.slice().reverse().map(r=>[date(r.at),r.ok+"/"+r.total,time(r.ms)]))),block("Слова на экзамене",modeTable("words","exam")),block("Слоги на экзамене",modeTable("scriptKana","exam")));
    }else if(tab==="writing"){
      const rows=Object.entries(p.writing).filter(([k,r])=>matches(k,r)&&(!onlyWeak||n(r.err)+n(r.skipped)>0)).sort((a,b)=>n(b[1].err)-n(a[1].err));
      const hist=p.writingHist;
      body.append(block("Рукописное письмо",metrics("writing"),trendGraph(hist,"Чистые глифы за занятие · все азбуки",[{name:"Без ошибок",color:"#79d6a5",value:r=>Math.round(r.ok/r.total*100)}],100,"%")),
        block("Освоение глифов",table(["Глиф","Чистых","Без контура","На слух","Ошибки штрихов","Пропуск","Этап"],rows.map(([k,r])=>[k,n(r.ok),n(r.unguided),n(r.audioOk),n(r.err),n(r.skipped),["Эталон","По образцу","На слух"][writingStage(k,r,true)]]))),
        block("История письма",table(["Дата","Чистых / всего","Завершено","Ошибки штрихов","Время"],hist.slice().reverse().map(r=>[date(r.at),r.ok+"/"+r.total,r.completed,r.strokeErr,time(r.ms)]))));
    }else if(tab==="words"){
      body.append(block("Словарный запас",el("p",{textContent:"Слов в словаре: "+dict.size+" · встречалось: "+[...dict.keys()].filter(k=>p.words[k]).length}),allTable("words")));
    }else{
      body.append(block("Точные знаки с разделением азбук",allTable("scriptKana")),block("Старая общая статистика (объединена в хирагану)",allTable("kana")));
    }
  }
  paint();
}
