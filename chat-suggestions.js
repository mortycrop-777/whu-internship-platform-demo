(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatSuggestions=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SUGGESTION_VERSION=1;
  const SUGGESTION_ICONS=['briefcase','doc','search','clock','flag','star','grid','users','spark','history','compass','pen','list'];
  const SUGGESTION_ACCENTS=['blue','teal','amber','violet','sky','green'];
  const KINDS=['prompt','action','link'];
  const SCENE='student_home';
  function text(value,max=200){if(typeof value!=='string')return '';const trimmed=value.trim();return trimmed.length>max?trimmed.slice(0,max):trimmed}
  function autoId(value){let hash=0;for(const char of String(value))hash=(hash*31+char.codePointAt(0))>>>0;return 's-'+hash.toString(36)}
  function normalizeAction(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const type=text(raw.type,32);
    if(!/^[a-z][a-z0-9_-]{0,31}$/.test(type))return null;
    const action={type};
    if(type==='navigate'){
      const path=text(raw.path,200);
      if(!/^\/[A-Za-z0-9_.\-/]*$/.test(path))return null;
      action.path=path;
    }else if(type==='toast'){
      const message=text(raw.message,80);
      if(!message)return null;
      action.message=message;
    }else{
      const path=text(raw.path,200);
      if(/^\/[A-Za-z0-9_.\-/]*$/.test(path))action.path=path;
      const message=text(raw.message,80);
      if(message)action.message=message;
    }
    return action;
  }
  function normalizeSuggestion(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const title=text(raw.title,60);
    if(!title)return null;
    const prompt=text(raw.prompt,500);
    const action=normalizeAction(raw.action);
    const url=text(raw.url,2048);
    const safeUrl=/^https?:\/\/[^\s]+$/i.test(url)?url:'';
    let kind=KINDS.includes(raw.kind)?raw.kind:null;
    if(!kind){if(prompt&&!action)kind='prompt';else if(action)kind='action';else if(safeUrl)kind='link';else return null}
    if(kind==='prompt'&&!prompt)return null;
    if(kind==='action'&&!action)return null;
    if(kind==='link'&&!safeUrl)return null;
    const entry={
      version:Number.isInteger(raw.version)&&raw.version>0?raw.version:SUGGESTION_VERSION,
      scene:text(raw.scene,40)||SCENE,
      id:text(raw.id,64)||autoId(title+'|'+prompt),
      kind,
      title,
      subtitle:text(raw.subtitle,120),
      icon:SUGGESTION_ICONS.includes(raw.icon)?raw.icon:'spark',
      accent:SUGGESTION_ACCENTS.includes(raw.accent)?raw.accent:'blue',
      weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1,
      badge:text(raw.badge,16)
    };
    if(kind==='prompt')entry.prompt=prompt;
    if(kind==='action')entry.action=action;
    if(kind==='link')entry.url=safeUrl;
    return entry;
  }
  function seededRandom(seed){
    let state=(Number(seed)>>>0)||0;
    return function(){state=(state*1664525+1013904223)>>>0;return state/4294967296};
  }
  function shuffle(list,random){
    const output=Array.from(list);
    for(let index=output.length-1;index>0;index--){const target=Math.floor(random()*(index+1));const swap=output[index];output[index]=output[target];output[target]=swap}
    return output;
  }
  function normalizeCatalog(catalog){return Array.from(catalog||[]).map(item=>normalizeSuggestion(item)).filter(Boolean)}
  function pickBatch(catalog,{size=3,seed=0,excludeIds=[]}={}){
    const normalized=normalizeCatalog(catalog);
    if(!normalized.length)return {items:[],seed:Number(seed)||0};
    const excluded=new Set(Array.from(excludeIds||[]).map(id=>String(id)));
    const shuffled=shuffle(normalized,seededRandom(seed));
    const ordered=shuffled.filter(item=>!excluded.has(item.id)).concat(shuffled.filter(item=>excluded.has(item.id)));
    const requested=Number(size);
    const count=Math.min(ordered.length,Math.max(1,Number.isFinite(requested)?Math.floor(requested):3));
    return {items:ordered.slice(0,count),seed:Number(seed)||0};
  }
  function nextSeed(seed){const value=Number(seed);return Number.isFinite(value)?Math.floor(value)+1:1}
  function resolveSuggestion(item){
    const normalized=normalizeSuggestion(item);
    if(!normalized)return null;
    if(normalized.kind==='prompt')return {type:'prompt',id:normalized.id,title:normalized.title,text:normalized.prompt};
    if(normalized.kind==='action')return {type:'action',id:normalized.id,title:normalized.title,actionType:normalized.action.type,path:normalized.action.path||'',message:normalized.action.message||'',action:normalized.action};
    return {type:'link',id:normalized.id,title:normalized.title,url:normalized.url};
  }
  const defaultCatalog=[
    {version:SUGGESTION_VERSION,scene:SCENE,id:'prepare-internship',kind:'prompt',title:'准备实习',subtitle:'了解实习前需要准备的材料与心态',prompt:'实习前我需要准备什么？',icon:'briefcase',accent:'blue',weight:1,badge:''},
    {version:SUGGESTION_VERSION,scene:SCENE,id:'organize-experience',kind:'prompt',title:'整理经历',subtitle:'把这周的实习内容整理成要点',prompt:'帮我整理这周的实习经历。',icon:'doc',accent:'teal',weight:1,badge:''},
    {version:SUGGESTION_VERSION,scene:SCENE,id:'explore-direction',kind:'prompt',title:'探索方向',subtitle:'找到适合自己的实习方向',prompt:'我想了解适合自己的实习方向。',icon:'compass',accent:'amber',weight:1,badge:''},
    {version:SUGGESTION_VERSION,scene:SCENE,id:'weekly-report',kind:'prompt',title:'写周报',subtitle:'把实习记录整理成周报草稿',prompt:'帮我把这周的实习记录整理成周报。',icon:'pen',accent:'violet',weight:1,badge:''},
    {version:SUGGESTION_VERSION,scene:SCENE,id:'fill-volunteer',kind:'action',title:'去填志愿',subtitle:'打开志愿填报',action:{type:'navigate',path:'/student/volunteer'},icon:'list',accent:'sky',weight:1,badge:''},
    {version:SUGGESTION_VERSION,scene:SCENE,id:'view-internship',kind:'action',title:'看实习记录',subtitle:'打开实习记录',action:{type:'navigate',path:'/student/internship'},icon:'clock',accent:'green',weight:1,badge:''}
  ];
  return {SUGGESTION_VERSION,SUGGESTION_ICONS,SUGGESTION_ACCENTS,KINDS,SCENE,defaultCatalog,normalizeSuggestion,normalizeAction,normalizeCatalog,pickBatch,nextSeed,resolveSuggestion};
});
