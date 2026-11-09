const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMessage,applyEvent,finishMessage}=require('../chat-stream.js');
test('preserves interleaved text and tool order and updates the original tool',()=>{
 const m=createMessage();
 for(const event of [{type:'text_delta',text:'先看'}, {type:'tool_start',id:'1',name:'web_search'}, {type:'tool_end',id:'1',failed:false}, {type:'text_delta',text:'结果'}, {type:'tool_start',id:'2',name:'render_pdf'}, {type:'tool_end',id:'2',failed:true}]) applyEvent(m,event);
 assert.deepEqual(m.parts.map(p=>p.type),['text','activity','text','activity']);
 assert.equal(m.parts[0].text,'先看');assert.equal(m.parts[2].text,'结果');assert.equal(m.parts[1].steps[0].status,'done');assert.equal(m.parts[3].steps[0].status,'failed');
});
test('groups adjacent activities, records real thinking without text and keeps final text in place',()=>{
 const m=createMessage(); for(const e of [{type:'thinking'},{type:'thinking'},{type:'tool_start',id:'a',name:'web_search'},{type:'tool_end',id:'a'},{type:'text_delta',text:'回答'}])applyEvent(m,e);
 finishMessage(m,{answer:'回答'});assert.equal(m.parts.length,2);assert.equal(m.parts[0].steps.length,2);assert.deepEqual(m.parts[0].steps.map(s=>s.kind),['thinking','tool']);assert.equal(m.parts[0].steps[0].status,'done');assert.equal(m.parts[1].text,'回答');
});
test('does not duplicate or discard streamed text when the final answer differs',()=>{
 const m=createMessage();applyEvent(m,{type:'text_delta',text:'前文'});applyEvent(m,{type:'tool_start',id:'x',name:'web_search'});applyEvent(m,{type:'tool_end',id:'x'});applyEvent(m,{type:'text_delta',text:'结论'});finishMessage(m,{answer:'结论'});
 assert.deepEqual(m.parts.map(p=>p.type),['text','activity','text']);assert.equal(m.parts[0].text,'前文');assert.equal(m.parts[2].text,'结论');
});
test('interrupted tools cannot remain running and no raw names are required for display',()=>{
 const m=createMessage();applyEvent(m,{type:'tool_start',id:'x',name:'load_skill'});finishMessage(m,{stopped:true});assert.equal(m.parts[0].steps[0].status,'stopped');
});
test('history reconstructs text and tool order and matches delivered files to their tool result',()=>{
 const {fromHistory}=require('../chat-stream.js');const history=[{role:'user',content:'制作'}, {role:'assistant',content:[{type:'text',text:'先处理'},{type:'toolCall',id:'t',name:'create_document'}]}, {role:'toolResult',toolCallId:'t',toolName:'create_document',details:{name:'a.docx'}}, {role:'assistant',content:[{type:'text',text:'完成'}]}];
 const result=fromHistory(history,[{name:'a.docx',url:'/api/files/123/a.docx'}]);assert.deepEqual(result[1].parts.map(x=>x.type),['text','activity','text','file']);assert.equal(result[1].parts[1].steps[0].status,'done');
});
test('reconciles a final answer only with the last text segment when it extends it',()=>{
 const m=createMessage();for(const e of [{type:'text_delta',text:'过程'}, {type:'tool_start',id:'x',name:'web_search'}, {type:'tool_end',id:'x'}, {type:'text_delta',text:'结'}])applyEvent(m,e);finishMessage(m,{answer:'结论'});assert.equal(m.parts[0].text,'过程');assert.equal(m.parts[2].text,'结论');
});
test('a tool pauses while confirmation awaits input and finishes at its original position',()=>{
 const m=createMessage();applyEvent(m,{type:'tool_start',id:'doc',name:'create_document'});applyEvent(m,{type:'question',kind:'confirmation',question:'确认？'});assert.equal(m.parts[0].steps[0].status,'waiting');applyEvent(m,{type:'tool_end',id:'doc',failed:false});assert.equal(m.parts[0].steps[0].status,'done');
});
test('history retains a read-only confirmation at the tool position',()=>{
 const {fromHistory}=require('../chat-stream.js');const confirmation={files:['a.docx'],format:'docx',content:{blocks:[{type:'paragraph',text:'内容'}]}};
 const result=fromHistory([{role:'user',content:'制作'}, {role:'assistant',content:[{type:'toolCall',id:'t',name:'create_document',uiConfirmation:confirmation}]},{role:'toolResult',toolCallId:'t',toolName:'create_document',details:{name:'a.docx'}},{role:'assistant',content:[{type:'text',text:'完成'}]}],[]);
 assert.deepEqual(result[1].parts.map(x=>x.type),['activity','confirmation','text']);assert.equal(result[1].parts[1].confirmation.files[0],'a.docx');assert.equal(result[1].parts[1].status,'done');
});
test('an unmatched tool call is not reported as completed',()=>{
 const m=createMessage();applyEvent(m,{type:'tool_start',id:'x',name:'web_search'});finishMessage(m,{});assert.equal(m.parts[0].steps[0].status,'unknown');
});
test('a submitted confirmation stays in the ordered transcript and follows its tool outcome',()=>{
 const {recordConfirmation}=require('../chat-stream.js');const m=createMessage();applyEvent(m,{type:'tool_start',id:'doc',name:'create_document'});const question={type:'question',kind:'confirmation',confirmation:{files:['a.docx']}};applyEvent(m,question);recordConfirmation(m,question);assert.deepEqual(m.parts.map(p=>p.type),['activity','confirmation']);applyEvent(m,{type:'tool_end',id:'doc',failed:false});assert.equal(m.parts[1].status,'done');
});
test('a cancelled confirmation is shown as stopped, not a tool failure',()=>{
 const m=createMessage();applyEvent(m,{type:'tool_start',id:'doc',name:'create_document'});applyEvent(m,{type:'question',kind:'confirmation'});applyEvent(m,{type:'tool_end',id:'doc',failed:true,stopped:true});assert.equal(m.parts[0].steps[0].status,'stopped');
});
test('generation remains visible through text, thinking and tools, and pauses only for a question',()=>{
 const {generationStatus}=require('../chat-stream.js');const m=createMessage();assert.equal(generationStatus(m),'正在生成');applyEvent(m,{type:'text_delta',text:'说明'});assert.equal(generationStatus(m),'正在生成');applyEvent(m,{type:'thinking'});assert.equal(generationStatus(m),'正在生成');applyEvent(m,{type:'tool_start',id:'a',name:'web_search'});assert.equal(generationStatus(m),'正在生成');applyEvent(m,{type:'question',question:'选择'});assert.equal(generationStatus(m),null);finishMessage(m,{});assert.equal(generationStatus(m),null);
});
test('final deliverables appear after the last response text, not among intermediate events',()=>{
 const m=createMessage();applyEvent(m,{type:'text_delta',text:'先处理'});applyEvent(m,{type:'tool_start',id:'t',name:'create_document'});applyEvent(m,{type:'tool_end',id:'t'});applyEvent(m,{type:'text_delta',text:'已经完成'});finishMessage(m,{answer:'已经完成',deliverables:[{name:'最终.pdf',url:'/api/files/x/最终.pdf'}]});assert.deepEqual(m.parts.map(p=>p.type),['text','activity','text','file']);assert.equal(m.parts.at(-1).name,'最终.pdf');
});
test('undelivered intermediate files are not shown as final cards',()=>{
 const m=createMessage();applyEvent(m,{type:'file',name:'中间.pdf',url:'/api/files/x/中间.pdf'});applyEvent(m,{type:'text_delta',text:'结束'});finishMessage(m,{answer:'结束',deliverables:[{name:'最终.pdf',url:'/api/files/x/最终.pdf'}]});assert.deepEqual(m.parts.filter(p=>p.type==='file').map(p=>p.name),['最终.pdf']);
});
test('history associates explicit delivery with its publishing turn rather than creation turn',()=>{
 const {fromHistory}=require('../chat-stream.js');const file={name:'final.pdf',url:'/api/files/x/final.pdf',delivery:'explicit'};
 const result=fromHistory([{role:'user',content:'先制作'},{role:'assistant',content:[{type:'toolCall',id:'c',name:'export_pdf'}]},{role:'toolResult',toolCallId:'c',toolName:'export_pdf',details:{name:'final.pdf'}},{role:'assistant',content:[{type:'text',text:'已准备'}]},{role:'user',content:'交付'},{role:'assistant',content:[{type:'toolCall',id:'d',name:'deliver_files'}]},{role:'toolResult',toolCallId:'d',toolName:'deliver_files',details:{deliverables:['final.pdf']}},{role:'assistant',content:[{type:'text',text:'文件在这里'}]}],[file]);
 assert.equal(result[1].parts.some(p=>p.type==='file'),false);assert.equal(result[3].parts.at(-1).name,'final.pdf');assert.equal(result[3].parts.at(-2).text,'文件在这里');
});
test('history preserves a warning when files were created but no delivery was specified',()=>{
 const {fromHistory}=require('../chat-stream.js');const result=fromHistory([{role:'user',content:'生成'},{role:'assistant',content:[{type:'text',text:'完成'}],delivery:{warning:'unclassified_artifacts',unpublishedArtifacts:['draft.pdf']}}],[]);assert.match(result[1].deliveryNotice,/draft\.pdf/);assert.equal(result[1].parts.some(p=>p.type==='file'),false);
});

test('shows compaction only while it runs and resumes generating afterwards',()=>{
 const {generationStatus}=require('../chat-stream.js');const m=createMessage();
 applyEvent(m,{type:'compaction_start'});assert.equal(generationStatus(m),'正在整理较早的对话');
 applyEvent(m,{type:'compaction_done'});assert.equal(generationStatus(m),'正在生成');
 applyEvent(m,{type:'compaction_start'});finishMessage(m,{failed:true});assert.equal(generationStatus(m),null);
});

test('retains tool targets across streaming and historical replay',()=>{
 const {fromHistory}=require('../chat-stream.js');const m=createMessage();const target={kind:'skill',name:'frontend-design'};
 applyEvent(m,{type:'tool_start',id:'a',name:'load_skill',target});applyEvent(m,{type:'tool_end',id:'a'});assert.deepEqual(m.parts[0].steps[0].target,target);
 const history=fromHistory([{role:'user',content:'制作'},{role:'assistant',content:[{type:'toolCall',id:'a',name:'load_skill',target}]},{role:'toolResult',toolCallId:'a',toolName:'load_skill',details:{}}],[]);
 assert.deepEqual(history[1].parts[0].steps[0].target,target);assert.equal(history[1].parts[0].steps[0].status,'done');
});

test('uses confirmed output target from completed tool for both stream and history',()=>{
 const {fromHistory}=require('../chat-stream.js'),target={kind:'file',name:'成品.pdf'};const m=createMessage();
 applyEvent(m,{type:'tool_start',id:'p',name:'create_html_document'});applyEvent(m,{type:'tool_end',id:'p',target});assert.deepEqual(m.parts[0].steps[0].target,target);
 const history=fromHistory([{role:'user',content:'制作'},{role:'assistant',content:[{type:'toolCall',id:'p',name:'create_html_document'}]},{role:'toolResult',toolCallId:'p',toolName:'create_html_document',target,details:{}}],[]);assert.deepEqual(history[1].parts[0].steps[0].target,target);
});

test('thinking end closes the active step before any later content arrives',()=>{
 const m=createMessage();applyEvent(m,{type:'thinking'});applyEvent(m,{type:'thinking_end'});assert.equal(m.parts[0].steps[0].status,'done');assert.equal(m.running,true);
});
test('answered questions remain visible as assistant text without repeating existing text',()=>{
 const {recordAnsweredQuestion}=require('../chat-stream.js');const m=createMessage();
 const part=recordAnsweredQuestion(m,{kind:'question',question:'你想投什么岗位？'});assert.equal(part.text,'你想投什么岗位？');assert.equal(m.parts[0],part);
 assert.equal(recordAnsweredQuestion(m,{kind:'question',question:'你想投什么岗位？'}),undefined);assert.equal(m.parts.length,1);
});

test('history keeps the question before its answer without repeating matching prose',()=>{
 const {fromHistory}=require('../chat-stream.js');const items=fromHistory([{role:'user',content:'做简历'},{role:'assistant',content:[{type:'text',text:'你想投什么岗位？'},{type:'toolCall',name:'ask_question',id:'q',arguments:{question:'你想投什么岗位？'}}]},{role:'toolResult',toolName:'ask_question',toolCallId:'q',details:{answer:'技术岗'}}],[]);
 assert.equal(items[1].parts.filter(p=>p.type==='text').map(p=>p.text).join(''),'你想投什么岗位？');assert.equal(items[2].text,'技术岗');
});

test('stopped session becomes resumable and history restores the stopped marker',()=>{
 const {applyStoppedSession,fromHistory}=require('../chat-stream.js');const session={id:'local-1',local:true};applyStoppedSession(session,{sessionId:'persisted-1'});assert.equal(session.id,'persisted-1');assert.equal(session.local,false);assert.equal(session.continuationBlocked,false);
 const result=fromHistory([{role:'user',content:'制作简历'},{role:'assistant',content:[{type:'text',text:'已经开始'}],uiStopped:true}],[]);assert.equal(result[1].stopped,true);assert.equal(result[1].error,'已停止');
 const empty=fromHistory([{role:'user',content:'制作简历'},{role:'assistant',content:[],uiStopped:true}],[]);assert.equal(empty[1].stopped,true);
});
test('does not continue silently after stopped history could not be saved',()=>{
 const {applyStoppedSession}=require('../chat-stream.js');const session={id:'local-1',local:true};applyStoppedSession(session,{historySaveFailed:true});assert.equal(session.continuationBlocked,true);assert.equal(session.local,true);
});

test('does not silently start a new chat when a stop event has no saved session id',()=>{
 const {applyStoppedSession}=require('../chat-stream.js');const session={id:'local-1',local:true};applyStoppedSession(session,{});assert.equal(session.continuationBlocked,true);
});

test('history restores uploaded attachments on user messages without trusting extra fields',()=>{
 const {fromHistory}=require('../chat-stream.js');const attachments=[{name:'简历.pdf',size:2048,kind:'pdf',url:'/api/uploads/x',preview:'x',extra:{a:1}},{name:'',size:1,kind:'pdf'},{name:'旧文件.exe',size:1,kind:'exe'},{name:'报告.docx',size:1024,kind:'docx'},{name:'截图.png',size:333,kind:'image'},{name:'照片.JPG',size:444},{name:'动图.gif',size:1}];
 const items=fromHistory([{role:'user',content:'看看这两份材料',attachments}],[]);
 assert.equal(items.length,1);assert.equal(items[0].text,'看看这两份材料');assert.deepEqual(items[0].attachments,[{name:'简历.pdf',size:2048,kind:'pdf'},{name:'报告.docx',size:1024,kind:'docx'},{name:'截图.png',size:333,kind:'image'},{name:'照片.JPG',size:444,kind:'image'}]);
});
test('history keeps an attachment-only user turn and derives the kind from the file name',()=>{
 const {fromHistory}=require('../chat-stream.js');const items=fromHistory([{role:'user',content:'',attachments:[{name:'材料.DOCX',size:12}]}],[]);
 assert.equal(items.length,1);assert.equal(items[0].text,'');assert.deepEqual(items[0].attachments,[{name:'材料.DOCX',size:12,kind:'docx'}]);
});
test('history ignores user turns with neither text nor a valid attachment',()=>{
 const {fromHistory}=require('../chat-stream.js');
 assert.equal(fromHistory([{role:'user',content:'',attachments:[{name:'',size:1}]}],[]).length,0);
 assert.equal(fromHistory([{role:'user',content:'只有文字'}],[])[0].attachments,undefined);
});

test('attaches memory events to the assistant message with filtering and a five item cap',()=>{
 const m=createMessage();
 applyEvent(m,{type:'memory',items:[{memory:'喜欢产品岗',action:'added'},{memory:'周末可实习',action:'updated'}]});
 assert.deepEqual(m.memory,[{memory:'喜欢产品岗',action:'added'},{memory:'周末可实习',action:'updated'}]);
 applyEvent(m,{type:'memory',items:[{memory:'喜欢产品岗',action:'added'},{memory:'',action:'added'},{memory:'x',action:'removed'},{memory:42,action:'added'},null,{memory:'补充三点',action:'added'}]});
 assert.deepEqual(m.memory.map(item=>item.memory),['喜欢产品岗','周末可实习','补充三点']);
 const many=createMessage();applyEvent(many,{type:'memory',items:Array.from({length:8},(_,index)=>({memory:'记忆'+index,action:'added'}))});
 assert.equal(many.memory.length,5);assert.deepEqual(many.memory.map(item=>item.memory),['记忆0','记忆1','记忆2','记忆3','记忆4']);
 assert.equal(createMessage().memory,undefined);
});

test('keeps text, tools and files unchanged when a memory event arrives',()=>{
 const m=createMessage();
 applyEvent(m,{type:'text_delta',text:'收到'});applyEvent(m,{type:'tool_start',id:'t',name:'web_search'});applyEvent(m,{type:'tool_end',id:'t'});
 applyEvent(m,{type:'memory',items:[{memory:'意向城市武汉',action:'added'}]});
 applyEvent(m,{type:'text_delta',text:'好'});applyEvent(m,{type:'file',name:'a.pdf',url:'/api/files/x/a.pdf'});
 finishMessage(m,{answer:'好',deliverables:[{name:'a.pdf',url:'/api/files/x/a.pdf'}]});
 assert.deepEqual(m.parts.map(part=>part.type),['text','activity','text','file']);
 assert.deepEqual(m.memory,[{memory:'意向城市武汉',action:'added'}]);
});

test('history replays assistant memory and ignores malformed memory fields',()=>{
 const {fromHistory}=require('../chat-stream.js');
 const items=fromHistory([{role:'user',content:'记住我的偏好'},{role:'assistant',content:[{type:'text',text:'好的'}],memory:[{memory:'偏好产品岗',action:'added'},{memory:'',action:'added'},{memory:'x',action:'removed'},{memory:'目标武汉',action:'updated'}]}],[]);
 assert.deepEqual(items[1].memory.map(entry=>[entry.memory,entry.action]),[['偏好产品岗','added'],['目标武汉','updated']]);
 const plain=fromHistory([{role:'user',content:'你好'},{role:'assistant',content:[{type:'text',text:'你好'}]}],[]);
 assert.equal(plain[1].memory,undefined);
 const malformed=fromHistory([{role:'assistant',content:[{type:'text',text:'收到'}],memory:'not-an-array'}],[]);
 assert.equal(malformed[0].memory,undefined);
});

test('memory chip does not restart an entrance animation when streaming rerenders older messages', () => {
  const fs=require('node:fs');const path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const rule=html.match(/\.assistant-memory-note\s*\{([^}]*)\}/);
  assert.ok(rule,'missing memory chip style');
  assert.doesNotMatch(rule[1],/animation\s*:/);
});

test('memory save failure remains visible in live output and after history reload', () => {
  const ChatStream=require('../chat-stream.js');
  const live=ChatStream.createMessage();
  ChatStream.finishMessage(live,{answer:'已处理',memoryWarning:'failed'});
  assert.equal(live.memoryWarning,'failed');
  const restored=ChatStream.fromHistory([{role:'assistant',content:[{type:'text',text:'已处理'}],uiMemoryWarning:'failed'}]);
  assert.equal(restored[0].memoryWarning,'failed');
});

test('a no-change memory result is visible both live and in history', () => {
  const ChatStream=require('../chat-stream.js');const live=ChatStream.createMessage();
  ChatStream.finishMessage(live,{answer:'已处理',memoryWarning:'unchanged'});
  assert.equal(live.memoryWarning,'unchanged');
  const restored=ChatStream.fromHistory([{role:'assistant',content:[{type:'text',text:'已处理'}],uiMemoryWarning:'unchanged'}]);
  assert.equal(restored[0].memoryWarning,'unchanged');
});

test('a connection failure does not tell a hosted user to start a local server', () => {
  const fs=require('node:fs');const path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.doesNotMatch(html,/服务未连接，请启动本地服务/);
  assert.match(html,/无法连接服务，请检查网络后重试/);
});
test('groups repeated completed knowledge searches without hiding active or failed steps',()=>{
 const {summarizeActivitySteps}=require('../chat-stream.js');
 const steps=[{kind:'thinking',status:'done'},{kind:'tool',name:'search_internship_knowledge',status:'done',id:'1'},{kind:'thinking',status:'done'},{kind:'tool',name:'search_internship_knowledge',status:'done',id:'2'},{kind:'thinking',status:'running'},{kind:'tool',name:'search_internship_knowledge',status:'failed',id:'3'}];
 const shown=summarizeActivitySteps(steps);assert.equal(shown.length,4);assert.equal(shown[1].count,2);assert.equal(shown[2].status,'running');assert.equal(shown[3].status,'failed');assert.equal(steps.length,6);
});
