const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  SUGGESTION_VERSION,SUGGESTION_ICONS,SUGGESTION_ACCENTS,defaultCatalog,
  normalizeSuggestion,normalizeAction,normalizeCatalog,pickBatch,nextSeed,resolveSuggestion
}=require('../chat-suggestions.js');

test('ships six default suggestions for the student home scene',()=>{
  assert.equal(defaultCatalog.length,6);
  assert.equal(defaultCatalog.filter(item=>item.kind==='prompt').length,4);
  assert.equal(defaultCatalog.filter(item=>item.kind==='action').length,2);
  for(const item of defaultCatalog){
    assert.equal(item.scene,'student_home');assert.equal(item.version,SUGGESTION_VERSION);
    assert.ok(item.title);assert.ok(SUGGESTION_ICONS.includes(item.icon));assert.ok(SUGGESTION_ACCENTS.includes(item.accent));
  }
  const navigatePaths=defaultCatalog.filter(item=>item.kind==='action').map(item=>item.action.path);
  assert.deepEqual(navigatePaths,['/student/volunteer','/student/internship']);
});

test('normalizes prompt, action and link suggestions safely',()=>{
  const prompt=normalizeSuggestion({title:'准备实习',prompt:'实习前我需要准备什么？',icon:'briefcase',accent:'blue'});
  assert.equal(prompt.kind,'prompt');assert.equal(prompt.prompt,'实习前我需要准备什么？');
  assert.equal(prompt.version,1);assert.equal(prompt.scene,'student_home');assert.equal(prompt.weight,1);assert.equal(prompt.badge,'');assert.ok(prompt.id);
  const action=normalizeSuggestion({title:'去填志愿',kind:'action',action:{type:'navigate',path:'/student/volunteer'},icon:'list',accent:'sky'});
  assert.deepEqual(action.action,{type:'navigate',path:'/student/volunteer'});
  const link=normalizeSuggestion({title:'学院官网',kind:'link',url:'https://journal.whu.edu.cn/'});
  assert.equal(link.url,'https://journal.whu.edu.cn/');
  assert.equal(normalizeSuggestion({title:'',prompt:'内容'}),null);
  assert.equal(normalizeSuggestion({title:'缺内容'}),null);
  assert.equal(normalizeSuggestion({title:'坏路径',kind:'action',action:{type:'navigate',path:'javascript:alert(1)'}}),null);
  assert.equal(normalizeSuggestion({title:'坏链接',kind:'link',url:'javascript:alert(1)'}),null);
  assert.equal(normalizeSuggestion(null),null);assert.equal(normalizeSuggestion([]),null);
});

test('infers kinds and falls back for unknown icon/accent values',()=>{
  const inferredPrompt=normalizeSuggestion({title:'题',prompt:'内容'});
  assert.equal(inferredPrompt.kind,'prompt');
  const inferredAction=normalizeSuggestion({title:'动作',action:{type:'navigate',path:'/student/volunteer'}});
  assert.equal(inferredAction.kind,'action');
  const inferredLink=normalizeSuggestion({title:'链接',url:'https://example.com/a'});
  assert.equal(inferredLink.kind,'link');
  const fallback=normalizeSuggestion({title:'兜底',prompt:'内容',icon:'unknown-icon',accent:'unknown-accent'});
  assert.equal(fallback.icon,'spark');assert.equal(fallback.accent,'blue');
  const toastAction=normalizeSuggestion({title:'提示',kind:'action',action:{type:'toast',message:'暂未开放'}});
  assert.deepEqual(toastAction.action,{type:'toast',message:'暂未开放'});
  assert.equal(normalizeAction({type:'navigate'}),null);
  assert.equal(normalizeAction({type:'toast'}),null);
  assert.equal(normalizeAction({type:'Bad Type',path:'/a'}),null);
});

test('first screen keeps the three familiar prompt cards and actions only appear after swap',()=>{
  const firstScreen=normalizeCatalog(defaultCatalog).filter(item=>item.kind==='prompt').slice(0,3);
  assert.deepEqual(firstScreen.map(item=>item.id),['prepare-internship','organize-experience','explore-direction']);
  assert.ok(firstScreen.every(item=>item.kind==='prompt'));
  const afterSwap=pickBatch(defaultCatalog,{size:3,seed:nextSeed(0),excludeIds:firstScreen.map(item=>item.id)});
  assert.equal(afterSwap.items.length,3);
  assert.ok(afterSwap.items.every(item=>!firstScreen.some(previous=>previous.id===item.id)));
  assert.ok(afterSwap.items.some(item=>item.kind==='action'));
});

test('pickBatch is seeded, unique and avoids repeating the previous batch',()=>{
  const first=pickBatch(defaultCatalog,{size:3,seed:0});
  assert.equal(first.items.length,3);assert.equal(first.seed,0);
  assert.equal(new Set(first.items.map(item=>item.id)).size,3);
  assert.deepEqual(pickBatch(defaultCatalog,{size:3,seed:0}).items.map(item=>item.id),first.items.map(item=>item.id));
  const second=pickBatch(defaultCatalog,{size:3,seed:nextSeed(first.seed),excludeIds:first.items.map(item=>item.id)});
  assert.equal(second.items.length,3);
  assert.ok(second.items.every(item=>!first.items.some(previous=>previous.id===item.id)),'second batch must avoid the first batch when possible');
  assert.equal(pickBatch(defaultCatalog,{size:99}).items.length,6);
  assert.equal(pickBatch(defaultCatalog,{size:0}).items.length,1);
  assert.deepEqual(pickBatch([],{size:3}),{items:[],seed:0});
});

test('nextSeed advances deterministic integer seeds',()=>{
  assert.equal(nextSeed(0),1);assert.equal(nextSeed(7),8);assert.equal(nextSeed('3'),4);assert.equal(nextSeed('bad'),1);
});

test('resolveSuggestion returns typed payloads for click handling',()=>{
  const prompt=resolveSuggestion(defaultCatalog[0]);
  assert.deepEqual({type:prompt.type,text:prompt.text},{type:'prompt',text:'实习前我需要准备什么？'});
  const action=resolveSuggestion(defaultCatalog[4]);
  assert.equal(action.type,'action');assert.equal(action.actionType,'navigate');assert.equal(action.path,'/student/volunteer');
  const link=resolveSuggestion({title:'官网',kind:'link',url:'https://example.com/'});
  assert.equal(link.type,'link');assert.equal(link.url,'https://example.com/');
  assert.equal(resolveSuggestion({title:'',prompt:'x'}),null);
  assert.equal(resolveSuggestion(null),null);
});

test('index.html loads the suggestions module and wires cards, swap and cross-board actions',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const script=html.indexOf('<script src="chat-suggestions.js"></script>');
  assert.ok(script>0,'chat-suggestions.js script tag missing');
  assert.ok(script<html.indexOf('const ICONS'),'chat-suggestions.js must load before the inline assistant script');
  for(const marker of ['ChatSuggestions.defaultCatalog','ChatSuggestions.pickBatch','ChatSuggestions.resolveSuggestion','assistant-suggestions','assistant-suggestion-pill','assistant-suggestion-label','scheduleSuggestionEntranceCleanup',"fresh.classList.remove('is-entering','is-dealing-out')",'assistant-suggestions-refresh','tiltSuggestion','resetSuggestionTilt','shuffleSuggestions','suggestionCardsHtml','activateSuggestion','is-suggestion-flash','换一批',"location.hash='#'+resolved.path"])assert.ok(html.includes(marker),'missing suggestions hook: '+marker);
});
