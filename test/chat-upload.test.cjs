const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  MAX_FILE_BYTES,MAX_IMAGE_BYTES,MAX_PER_TURN,MAX_PER_SESSION,COMPOSER_EXPAND_LINES,COMPOSER_EXPAND_CHARS,validateSelection,normalizeUploadFiles,maxBytesFor,buildChips,sentAttachments,
  formatSize,kindOf,fileKindClass,middleEllipsis,summaryText,composerLayout,rejectionText,uploadsUrl,deleteUrl,uploadErrorMessage,createUploader,UploadError,randomId
}=require('../chat-upload.js');

class FakeXHR{
  static instances=[];
  constructor(){FakeXHR.instances.push(this);this.upload={};this.headers={};this.status=0;this.responseText='';this.aborted=false}
  open(method,url){this.method=method;this.url=url}
  setRequestHeader(key,value){this.headers[String(key).toLowerCase()]=value}
  send(body){this.body=body}
  abort(){this.aborted=true;this.onabort?.()}
  respond(status,payload){this.status=status;this.responseText=JSON.stringify(payload);this.onload?.()}
  fail(){this.onerror?.()}
}
function uploaderWith(){FakeXHR.instances=[];const uploader=createUploader({xhrFactory:()=>new FakeXHR()});return {uploader,last:()=>FakeXHR.instances.at(-1)}}

test('recognizes Word/PDF extensions and formats sizes for chips',()=>{
  assert.equal(kindOf('简历.DOCX'),'docx');assert.equal(kindOf('作品.pdf'),'pdf');
  assert.equal(kindOf('a.doc'),null);assert.equal(kindOf('a.exe'),null);assert.equal(kindOf(''),null);
  assert.equal(formatSize(0),'0 B');assert.equal(formatSize(1024),'1 KB');assert.equal(formatSize(1536),'2 KB');
  assert.equal(formatSize(1024*1024),'1.0 MB');assert.equal(formatSize(MAX_FILE_BYTES),'50.0 MB');assert.equal(formatSize(-1),'');
});

test('middle-ellipsizes long names while keeping the extension visible',()=>{
  assert.equal(middleEllipsis('短.pdf',20),'短.pdf');
  assert.equal(middleEllipsis('',12),'');
  const long=middleEllipsis('2026年暑期实习总结报告最终版.docx',18);
  assert.ok(long.length<=18,long);assert.ok(long.includes('…'));assert.ok(long.endsWith('.docx'));assert.ok(long.startsWith('2026'));
  const pdf=middleEllipsis('01-报告-python-docx.pdf',18);
  assert.ok(pdf.length<=18,pdf);assert.ok(pdf.endsWith('.pdf'));assert.ok(pdf.includes('…'));
  assert.ok(middleEllipsis('a'.repeat(30),8).endsWith('aaaa'));
});

test('summarizes multi-file selections with count and total size',()=>{
  const summary=summaryText([{name:'a.pdf',size:1024*1024},{name:'b.docx',size:512*1024}]);
  assert.equal(summary.count,2);assert.equal(summary.total,1572864);assert.equal(summary.totalLabel,'1.5 MB');
  assert.equal(summary.text,'2 个文件 · 共 1.5 MB');assert.equal(summary.limitReached,false);
  assert.equal(summaryText([{serverName:'x.pdf',serverSize:2048},{name:'y.pdf',size:1024}]).total,3072);
  assert.equal(summaryText(Array.from({length:MAX_PER_SESSION},()=>({name:'a.pdf',size:1}))).limitReached,true);
});

test('maps file names to Word/PDF/image icon color classes',()=>{
  assert.equal(fileKindClass('简历.DOCX'),'is-word');assert.equal(fileKindClass('作品.pdf'),'is-pdf');assert.equal(fileKindClass('截图.png'),'is-image');assert.equal(fileKindClass('照片.JPEG'),'is-image');assert.equal(fileKindClass('a.txt'),'');
});

test('accepts only Word/PDF within limits and keeps the original file objects',()=>{
  const docx={name:'简历.docx',size:1024},pdf={name:'作品.PDF',size:2048};
  const result=validateSelection([docx,pdf]);
  assert.deepEqual(result.accepted,[docx,pdf]);assert.equal(result.accepted[0],docx);assert.deepEqual(result.rejected,[]);
});

test('rejects unsupported types, empty files, oversized files and duplicate names',()=>{
  const result=validateSelection([{name:'a.doc',size:10},{name:'b.exe',size:10},{name:'c.pdf',size:0},{name:'d.pdf',size:MAX_FILE_BYTES+1},{name:'e.docx',size:10},{name:'E.DOCX',size:10}]);
  assert.deepEqual(result.rejected.map(item=>[item.name,item.reason]),[['a.doc','type'],['b.exe','type'],['c.pdf','empty'],['d.pdf','size'],['E.DOCX','duplicate']]);
  assert.deepEqual(result.accepted.map(file=>file.name),['e.docx']);
});

test('accepts files up to the 50MB boundary and rejects one byte over',()=>{
  assert.equal(MAX_FILE_BYTES,50*1024*1024);
  const atLimit=validateSelection([{name:'limit.pdf',size:MAX_FILE_BYTES}]);
  assert.equal(atLimit.accepted.length,1);assert.deepEqual(atLimit.rejected,[]);
  const over=validateSelection([{name:'over.pdf',size:MAX_FILE_BYTES+1}]);
  assert.equal(over.accepted.length,0);assert.deepEqual(over.rejected.map(item=>item.reason),['size']);
});

test('recognizes image extensions, kind and icon class',()=>{
  for(const name of ['a.png','a.PNG','a.jpg','a.JPEG','a.webp'])assert.equal(kindOf(name),'image',name);
  assert.equal(MAX_IMAGE_BYTES,20*1024*1024);
  assert.equal(maxBytesFor('image'),MAX_IMAGE_BYTES);assert.equal(maxBytesFor('docx'),MAX_FILE_BYTES);assert.equal(maxBytesFor('pdf'),MAX_FILE_BYTES);
  assert.equal(sentAttachments([{name:'截图.png',size:1024,status:'done'}])[0].kind,'image');
  assert.equal(buildChips([{name:'截图.webp',size:1024,status:'uploading'}])[0].kind,'image');
});

test('applies the 20MB image limit while keeping documents at 50MB',()=>{
  assert.equal(validateSelection([{name:'shot.png',size:MAX_IMAGE_BYTES}]).accepted.length,1);
  assert.deepEqual(validateSelection([{name:'shot.webp',size:MAX_IMAGE_BYTES+1}]).rejected.map(item=>[item.name,item.reason]),[['shot.webp','size']]);
  assert.equal(validateSelection([{name:'report.pdf',size:MAX_FILE_BYTES}]).accepted.length,1);
  assert.equal(validateSelection([{name:'scan.jpg',size:MAX_FILE_BYTES}]).rejected[0].reason,'size');
});

test('rejects GIF and HEIC picks as unsupported types',()=>{
  const result=validateSelection([{name:'动画.gif',size:1024},{name:'photo.heic',size:1024},{name:'ok.jpeg',size:1024}]);
  assert.deepEqual(result.rejected.map(item=>[item.name,item.reason]),[['动画.gif','type'],['photo.heic','type']]);
  assert.deepEqual(result.accepted.map(file=>file.name),['ok.jpeg']);
});

test('names extensionless pasted images by MIME and keeps file metadata',()=>{
  const png=new File([new Uint8Array([1,2,3])],'',{type:'image/png',lastModified:1700000000000});
  const jpeg=new File([new Uint8Array([4])],'image',{type:'image/jpeg',lastModified:1700000000001});
  const webp=new File([new Uint8Array([5])],'blob',{type:'image/webp'});
  const named=new File([new Uint8Array([6])],'截图.webp',{type:'image/webp'});
  const gif=new File([new Uint8Array([7])],'',{type:'image/gif'});
  const normalized=normalizeUploadFiles([png,jpeg,webp,named,gif]);
  assert.equal(normalized.length,5);
  assert.match(normalized[0].name,/^粘贴图片-\d+-1\.png$/);
  assert.match(normalized[1].name,/^粘贴图片-\d+-2\.jpg$/);
  assert.match(normalized[2].name,/^粘贴图片-\d+-3\.webp$/);
  assert.equal(normalized[3].name,'截图.webp');assert.equal(normalized[3],named);
  assert.equal(normalized[4].name,'');
  assert.ok(normalized[0] instanceof File);assert.equal(normalized[0].type,'image/png');assert.equal(normalized[0].lastModified,1700000000000);
  assert.equal(normalized[1].type,'image/jpeg');
  const result=validateSelection(normalized);
  assert.deepEqual(result.accepted.map(file=>file.name),[normalized[0].name,normalized[1].name,normalized[2].name,'截图.webp']);
  assert.deepEqual(result.rejected.map(item=>[item.name,item.reason]),[['','invalid']]);
});

test('enforces the shared 20-file quota without a separate per-turn cap',()=>{
  assert.equal(MAX_PER_TURN,20);assert.equal(MAX_PER_SESSION,20);
  const files=Array.from({length:22},(_,index)=>({name:'f'+index+'.pdf',size:1}));
  const full=validateSelection(files,{sessionCount:0});
  assert.equal(full.accepted.length,MAX_PER_SESSION);
  assert.deepEqual(full.rejected.map(item=>item.reason),['limit','limit']);
  const nearlyFull=validateSelection([{name:'a.pdf',size:1},{name:'b.pdf',size:1}],{sessionCount:MAX_PER_SESSION-1});
  assert.equal(nearlyFull.accepted.length,1);assert.deepEqual(nearlyFull.rejected.map(item=>item.reason),['limit']);
  assert.equal(validateSelection([{name:'a.pdf',size:1}],{turnCount:MAX_PER_TURN}).accepted.length,0);
});

test('reports the new size and session limits in Chinese',()=>{
  assert.match(rejectionText('type'),/Word/);assert.match(rejectionText('type'),/PDF/);assert.match(rejectionText('type'),/PNG/);assert.match(rejectionText('type'),/JPG/);assert.match(rejectionText('type'),/WebP/);
  assert.match(rejectionText('size'),/图片 20MB/);assert.match(rejectionText('size'),/文档 50MB/);assert.doesNotMatch(rejectionText('size'),/单个文件不能超过 50MB/);
  assert.match(rejectionText('limit'),/每个会话最多上传 20 个文件/);assert.match(rejectionText('empty'),/空文件/);
  assert.equal(rejectionText('unknown'),'文件未添加');
});

test('builds chip view models for uploading, uploaded and failed files',()=>{
  const chips=buildChips([{id:'u1',name:'简历.pdf',size:2048,status:'uploading',progress:37.6},{id:'u2',name:'原名.docx',serverName:'报告 (2).docx',serverSize:1048576,status:'done'},{id:'u3',name:'失败.pdf',size:1024,status:'error',error:'服务未连接'}]);
  assert.deepEqual(chips.map(chip=>chip.status),['uploading','done','error']);
  assert.equal(chips[0].statusLabel,'上传中 38%');assert.equal(chips[0].progress,38);assert.equal(chips[0].name,'简历.pdf');assert.equal(chips[0].kind,'pdf');
  assert.equal(chips[1].name,'报告 (2).docx');assert.equal(chips[1].sizeLabel,'1.0 MB');assert.equal(chips[1].progress,100);assert.equal(chips[1].statusLabel,'已上传');
  assert.equal(chips[2].canRetry,true);assert.equal(chips[2].error,'服务未连接');assert.equal(chips[2].progress,0);assert.equal(chips[2].statusLabel,'上传失败');
  assert.equal(chips[0].canRetry,false);assert.equal(chips[1].canRetry,false);
});

test('clamps progress and tolerates unknown progress',()=>{
  const [over,unknown]=buildChips([{name:'a.pdf',size:1,status:'uploading',progress:150},{name:'b.pdf',size:1,status:'uploading'}]);
  assert.equal(over.progress,100);assert.equal(over.statusLabel,'上传中 100%');
  assert.equal(unknown.progress,null);assert.equal(unknown.statusLabel,'上传中');
});

test('sends only uploaded files and uses server-confirmed metadata',()=>{
  const attachments=sentAttachments([{name:'a.pdf',size:1,status:'done'},{name:'b.docx',size:100,status:'done',serverName:'b (2).docx',serverSize:120},{name:'c.pdf',size:2,status:'error'},{name:'d.pdf',size:2,status:'uploading',progress:10}]);
  assert.deepEqual(attachments,[{name:'a.pdf',size:1,kind:'pdf'},{name:'b (2).docx',size:120,kind:'docx'}]);
});

test('builds upload and delete URLs for both session and workspace targets',()=>{
  assert.equal(uploadsUrl({sessionId:'s 1'}),'/api/uploads?session=s%201');
  assert.equal(uploadsUrl({workspaceId:'abc-123'}),'/api/uploads?workspace=abc-123');
  assert.equal(deleteUrl({sessionId:'s 1'},'简历 (2).pdf'),'/api/uploads?session=s%201&name=%E7%AE%80%E5%8E%86%20(2).pdf');
  assert.equal(deleteUrl({workspaceId:'w'},'a.pdf'),'/api/uploads?workspace=w&name=a.pdf');
});

test('uploads raw bytes with octet-stream and an encoded file name, then reports progress',async()=>{
  const {uploader,last}=uploaderWith();const file={name:'简历 终稿.docx',size:2048};const progress=[];
  const stored={name:'简历 终稿.docx',size:2048,kind:'docx',uploadedAt:'2026-11-03T00:00:00.000Z'};
  const handle=uploader.uploadFile({file,target:{sessionId:'s1'},onProgress:value=>progress.push(value)});
  const xhr=last();
  assert.equal(xhr.method,'POST');assert.equal(xhr.url,'/api/uploads?session=s1');
  assert.equal(xhr.headers['content-type'],'application/octet-stream');
  assert.equal(xhr.headers['x-file-name'],encodeURIComponent('简历 终稿.docx'));
  assert.equal(xhr.body,file);
  xhr.upload.onprogress({lengthComputable:true,loaded:1,total:4});
  xhr.respond(201,stored);
  assert.deepEqual(await handle.promise,stored);assert.deepEqual(progress,[25]);
});

test('uses the workspace id while a new session has no server session id',async()=>{
  const {uploader,last}=uploaderWith();
  const handle=uploader.uploadFile({file:{name:'a.pdf',size:10},target:{workspaceId:'uuid-1234'}});
  assert.equal(last().url,'/api/uploads?workspace=uuid-1234');
  last().respond(201,{name:'a.pdf',size:10,kind:'pdf',uploadedAt:'now'});
  assert.equal((await handle.promise).name,'a.pdf');
});

test('maps upload failures to Chinese messages and keeps the HTTP status',async()=>{
  const rejection=async(status,payload)=>{const {uploader,last}=uploaderWith();const handle=uploader.uploadFile({file:{name:'a.pdf',size:1},target:{sessionId:'s'}});last().respond(status,payload);return handle.promise};
  await assert.rejects(rejection(413,{error:'too large'}),error=>error instanceof UploadError&&error.status===413&&/50MB/.test(error.message));
  await assert.rejects(rejection(415,{error:'bad type'}),error=>error.status===415&&/Word/.test(error.message)&&/PDF/.test(error.message));
  await assert.rejects(rejection(400,{error:'文件内容不完整'}),error=>error.status===400&&error.message==='文件内容不完整');
  await assert.rejects(rejection(409,{}),error=>error.status===409&&/重名/.test(error.message));
  await assert.rejects(rejection(409,{error:'会话上传总字节超过 500MB'}),error=>error.status===409&&error.message==='会话上传总字节超过 500MB');
  await assert.rejects(rejection(404,{error:'会话不存在'}),error=>error.status===404&&error.message==='会话不存在');
  assert.equal(uploadErrorMessage(400,'自定义错误'),'自定义错误');
  assert.match(uploadErrorMessage(500,''),/500/);
});

test('reports a connection failure when the request cannot complete',async()=>{
  const {uploader,last}=uploaderWith();
  const handle=uploader.uploadFile({file:{name:'a.pdf',size:1},target:{sessionId:'s'}});
  last().fail();
  await assert.rejects(handle.promise,error=>/服务连接/.test(error.message));
});

test('aborting an upload rejects with a cancelled error instead of resolving',async()=>{
  const {uploader,last}=uploaderWith();
  const handle=uploader.uploadFile({file:{name:'a.pdf',size:1},target:{sessionId:'s'}});
  handle.abort();
  assert.equal(last().aborted,true);
  await assert.rejects(handle.promise,error=>error.aborted===true&&/取消/.test(error.message));
});

test('deletes an uploaded file by name with the frozen query contract',async()=>{
  const {uploader,last}=uploaderWith();
  const promise=uploader.deleteUpload({name:'简历 (2).pdf',target:{sessionId:'s1'}});
  const xhr=last();
  assert.equal(xhr.method,'DELETE');assert.equal(xhr.url,'/api/uploads?session=s1&name='+encodeURIComponent('简历 (2).pdf'));
  xhr.respond(200,{ok:true});
  assert.deepEqual(await promise,{ok:true});
});

test('refuses to upload or delete without a session or workspace target',async()=>{
  const {uploader}=uploaderWith();
  await assert.rejects(uploader.uploadFile({file:{name:'a.pdf',size:1}}).promise,/缺少上传目标/);
  await assert.rejects(uploader.deleteUpload({name:'a.pdf'}),/缺少上传目标/);
  await assert.rejects(uploader.uploadFile({file:{},target:{sessionId:'s'}}).promise,/文件无效/);
});

test('generates a distinct upload group id for unclaimed new-session workspaces',()=>{
  const first=randomId(),second=randomId();
  assert.equal(typeof first,'string');assert.ok(first.length>=8);assert.notEqual(first,second);
});

test('composer stays single-line until a newline, wrap or attachment appears',()=>{
  assert.equal(composerLayout({text:'',lineCount:1,uploadCount:0}).multiline,false);
  assert.equal(composerLayout({text:'你好',lineCount:1,uploadCount:0}).multiline,false);
  assert.equal(composerLayout({text:'第一行\n第二行',lineCount:2,uploadCount:0}).multiline,true);
  assert.equal(composerLayout({text:'',lineCount:1,uploadCount:1}).multiline,true);
  assert.equal(composerLayout({text:'自动折行后的文本',lineCount:2,uploadCount:0}).multiline,true);
});

test('composer expand control appears only past the 8-line or 300-char threshold',()=>{
  const sevenLines=Array.from({length:7},(_,index)=>'第'+index+'行').join('\n');
  const eightLines=Array.from({length:8},(_,index)=>'第'+index+'行').join('\n');
  const seven=composerLayout({text:sevenLines,lineCount:7,uploadCount:0});
  assert.equal(seven.multiline,true);assert.equal(seven.expandable,false);
  assert.equal(composerLayout({text:eightLines,lineCount:8,uploadCount:0}).expandable,true);
  const justUnder='字'.repeat(COMPOSER_EXPAND_CHARS-1);
  const atLimit='字'.repeat(COMPOSER_EXPAND_CHARS);
  assert.equal(composerLayout({text:justUnder,lineCount:2,uploadCount:0}).expandable,false);
  assert.equal(composerLayout({text:atLimit,lineCount:2,uploadCount:0}).expandable,true);
  assert.equal(composerLayout({text:atLimit,lineCount:1,uploadCount:0}).expandable,false);
  assert.equal(COMPOSER_EXPAND_LINES,8);assert.equal(COMPOSER_EXPAND_CHARS,300);
});

test('index.html loads the upload module before the assistant script and wires the composer hooks',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const script=html.indexOf('<script src="chat-upload.js"></script>');
  assert.ok(script>0,'chat-upload.js script tag missing');
  assert.ok(script<html.indexOf('const ICONS'),'chat-upload.js must load before the inline assistant script');
    // 回归：清空后 tray 不能残留 opacity:0 的离开动画，否则再次上传会出现空白附件区
  assert.ok(!html.includes('.assistant-uploads.is-leaving{'),'tray must not keep a leaving-opacity rule');
  assert.ok(html.includes("box.classList.remove('is-leaving')"),'refreshUploadUi must clear stale leaving class');
  for(const marker of ['id="assistantFileInput"','id="assistantUploads"','id="assistantUploadSummary"','chatDropCount','assistant-drop-mask','assistant-upload-progress','assistant-attachment-icon','uploadGroupId','ChatUpload.validateSelection','ChatUpload.createUploader','ChatUpload.middleEllipsis','clearComposeUploads','assistant-message-attachments','historyArtifactsHtml','assistant-history-artifacts','assistant-history-artifact-more','max-height:132px','overflow-y:auto','scrollbar-color:#c9d8ea','scrollbar-color:#4b5d72','error.status===409','图片不超过 20MB','ChatUpload.normalizeUploadFiles','ICONS.fileImage','assistant-upload-icon.is-image','assistant-attachment-icon.is-image','accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,application/pdf','image/png,image/jpeg,image/webp"','ChatUpload.MAX_PER_SESSION','已达 ','assistant-compose-main','assistant-compose-side','assistant-compose-editor','assistant-compose-expand','id="assistantExpand"','composerLayout','toggleComposerExpand','is-multiline','is-expanded','min(50vh,480px)','ICONS.plus','settings-layout','settings-nav','settings-nav-item','renderSettings','openSettings','closeSettings','setSettingsTab','settingsReturn','settingsTab','实习助手','通用','个人记忆','onclick="showMemory()"','onclick="openSettings()"','onclick="closeSettings()"','返回','aria-label="管理个人记忆"','AGENT_MEMORY_ENABLED',"'settings':renderSettings",'assistant-memory-note','assistant-memory-view','list_memories:\'查看记忆\'','update_memory:\'修改记忆\'','delete_memory:\'删除记忆\'','已记住','已更新记忆','memoryNoteHtml','role="note"','aria-expanded','assistant-suggestion-glare','assistant-suggestion-pill','assistant-suggestion-label','height:34px','border-radius:999px','#eef2f7','#95a2b1','#6f7c8c','aria-label="换一批"','assistant-suggestions-refresh','is-entering','@keyframes assistant-pill-deal','is-dealing-out','is-dealing-in','tiltSuggestion','resetSuggestionTilt','suggestionTiltEnabled','suggestionsEntrancePlayed','perspective:900px','--gx','addEventListener(\'paste\''])assert.ok(html.includes(marker),'missing composer hook: '+marker);
  assert.ok(!html.includes('assistant-suggestions-head'),'M2 must remove the head/kicker row');
  assert.ok(!html.includes('不知道从哪开始？'),'M2 must remove the kicker copy');
  assert.ok(!html.includes('.assistant-suggestion-card{'),'M2 must not style a card rectangle');
  assert.ok(!html.includes('assistant-suggestion-subtitle'),'M2 must not render subtitles');
  assert.ok(!html.includes('id="memoryTrigger"'),'topbar memory trigger must stay removed');
  assert.ok(!html.includes('settings-pop'),'settings must be a page, not a gear popover');
  assert.ok(!html.includes('settingsOpen'),'old settingsOpen state must be removed');
  assert.ok(!html.includes('上下文用量'),'context usage entry must be removed');
  assert.ok(!html.includes('showContext'),'showContext must be removed');
  assert.ok(!html.includes('assistant-context-value'),'context dialog styles must be removed');
  assert.ok(html.includes("'settings':renderSettings"),'settings route must be registered');
  const assistantTab=html.indexOf('onclick="setSettingsTab(\'assistant\')"');
  const generalTab=html.indexOf('onclick="setSettingsTab(\'general\')"');
  assert.ok(assistantTab>0,'assistant settings category missing');
  assert.ok(generalTab>assistantTab,'assistant category must precede general category');
});
