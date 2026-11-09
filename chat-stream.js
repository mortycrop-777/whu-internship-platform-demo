(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatStream=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // Only combine consecutive successful knowledge-search cycles; failures and active steps remain visible.
  function summarizeActivitySteps(steps){
    const out=[];let i=0;
    while(i<steps.length){
      let j=i,count=0,firstThinking=null,firstSearch=null;
      while(j<steps.length){
        if(steps[j]?.kind==='thinking'&&steps[j].status==='done'&&steps[j+1]?.kind==='tool'&&steps[j+1].name==='search_internship_knowledge'&&steps[j+1].status==='done'){
          firstThinking??=steps[j];firstSearch??=steps[j+1];count++;j+=2;
        }else if(steps[j]?.kind==='tool'&&steps[j].name==='search_internship_knowledge'&&steps[j].status==='done'){
          firstSearch??=steps[j];count++;j++;
        }else break;
      }
      if(count>=2){if(firstThinking)out.push(firstThinking);out.push({...firstSearch,count});i=j}
      else {out.push(steps[i]);i++}
    }
    return out;
  }
  function generationStatus(message){return message.running&&!message.question?(message.reconnecting?'连接中断，正在重新连接':message.queued?'等待空闲的助手':message.compacting?'正在整理较早的对话':'正在生成'):null}
  function createMessage(){return {role:'assistant',parts:[],running:true,done:false,animateIn:true}}
  function closeThinking(message){for(const part of message.parts)if(part.type==='activity')for(const step of part.steps)if(step.kind==='thinking'&&step.status==='running')step.status='done'}
  function activity(message){let part=message.parts.at(-1);if(!part||part.type!=='activity'){part={type:'activity',steps:[],open:!!message.running};message.parts.push(part)}return part}
  function normalizeMemoryItems(items){
    if(!Array.isArray(items))return[];
    const output=[],seen=new Set();
    for(const item of items){
      if(!item||typeof item!=='object')continue;
      const memory=typeof item.memory==='string'?item.memory.trim():'';
      if(!memory)continue;
      const action=item.action==='added'||item.action==='updated'?item.action:'';
      if(!action)continue;
      const key=memory.toLocaleLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      output.push({memory,action});
      if(output.length>=5)break;
    }
    return output;
  }
  function appendMemory(message,items){
    const incoming=normalizeMemoryItems(items);
    if(!incoming.length)return;
    const existing=Array.isArray(message.memory)?message.memory:[];
    const seen=new Set(existing.map(item=>String(item&&item.memory||'').toLocaleLowerCase()));
    const merged=existing.slice(0,5);
    for(const item of incoming){
      const key=item.memory.toLocaleLowerCase();
      if(seen.has(key))continue;
      seen.add(key);merged.push(item);
      if(merged.length>=5)break;
    }
    message.memory=merged.slice(0,5);
  }
  function applyEvent(message,event){
    if(event.type==='compaction_start'){message.compacting=true;
    }else if(event.type==='compaction_done'||event.type==='compaction_failed'){message.compacting=false;
    }else if(event.type==='thinking_end'){closeThinking(message);
    }else if(event.type==='thinking'){
      const part=activity(message);if(!part.steps.some(step=>step.kind==='thinking'&&step.status==='running'))part.steps.push({kind:'thinking',status:'running'});
    }else if(event.type==='text_delta'){
      closeThinking(message);let part=message.parts.at(-1);if(!part||part.type!=='text'){part={type:'text',text:''};message.parts.push(part)}part.text+=event.text;
    }else if(event.type==='tool_start'){
      closeThinking(message);activity(message).steps.push({kind:'tool',id:event.id,name:event.name,status:'running',...(event.target?{target:event.target}:{})});
    }else if(event.type==='tool_end'){
      for(const part of message.parts){if(part.type==='activity'){const step=part.steps.find(item=>item.kind==='tool'&&item.id===event.id);if(step){step.status=event.stopped?'stopped':event.failed?'failed':'done';if(event.target)step.target=event.target}}else if(part.type==='confirmation'&&part.id===event.id)part.status=event.stopped?'stopped':event.failed?'incomplete':'done'}
    }else if(event.type==='file'){
      closeThinking(message);(message.pendingFiles??=[]).push({type:'file',name:event.name,url:event.url});
    }else if(event.type==='memory'){
      appendMemory(message,event.items);
    }else if(event.type==='question'){
      closeThinking(message);if(event.kind==='confirmation')for(const part of message.parts)if(part.type==='activity')for(const step of part.steps)if(step.kind==='tool'&&step.status==='running')step.status='waiting';message.question=event;
    }
  }
  function finishMessage(message,{answer,stopped=false,failed=false,deliverables,memoryWarning}={}){
    if(['failed','unchanged'].includes(memoryWarning))message.memoryWarning=memoryWarning;
    closeThinking(message);for(const part of message.parts)if(part.type==='activity')for(const step of part.steps)if(step.status==='running'||(step.status==='waiting'&&(stopped||failed)))step.status=stopped?'stopped':failed?'failed':'unknown';
    if(answer){const last=message.parts.at(-1);if(last?.type==='text'&&answer.startsWith(last.text))last.text=answer;else if(!message.parts.some(part=>part.type==='text'&&part.text))message.parts.push({type:'text',text:answer})}
    if(!stopped&&!failed){const chosen=Array.isArray(deliverables)?deliverables:message.pendingFiles||[];const existing=new Set(message.parts.filter(part=>part.type==='file').map(part=>part.url));for(const file of chosen)if(file&&typeof file.name==='string'&&typeof file.url==='string'&&!existing.has(file.url)){message.parts.push({type:'file',name:file.name,url:file.url});existing.add(file.url)}}message.pendingFiles=[];
    for(const part of message.parts)if(part.type==='activity'&&!part.userToggled)part.open=false;
    message.compacting=false;message.running=false;message.done=!stopped&&!failed;
  }
  function recordAnsweredQuestion(message,question){if(question.kind==='confirmation'||typeof question.question!=='string'||!question.question.trim())return;const text=question.question.trim();const last=message.parts.at(-1);if(last?.type==='text'&&last.text.trim().endsWith(text))return;const part={type:'text',text};message.parts.push(part);return part}
  function recordConfirmation(message,question){if(question.kind!=='confirmation'||!question.confirmation)return;const step=message.parts.flatMap(part=>part.type==='activity'?part.steps:[]).findLast(item=>item.kind==='tool'&&item.status==='waiting');message.parts.push({type:'confirmation',id:step?.id,confirmation:question.confirmation,status:'pending',replayed:false})}
  function applyStoppedSession(session,event){session.continuationBlocked=!!event.historySaveFailed||!event.sessionId;if(event.sessionId&&!event.historySaveFailed){session.id=event.sessionId;session.local=false}}
  function historyAttachments(list){
    if(!Array.isArray(list))return[];
    const output=[];
    for(const item of list){
      if(!item||typeof item.name!=='string')continue;
      const name=item.name.trim();if(!name)continue;
      const kind=item.kind==='pdf'?'pdf':item.kind==='docx'?'docx':item.kind==='image'?'image':/\.pdf$/i.test(name)?'pdf':/\.docx$/i.test(name)?'docx':/\.(png|jpe?g|webp)$/i.test(name)?'image':'';
      if(!kind)continue;
      const size=Number(item.size);
      output.push({name,size:Number.isFinite(size)&&size>=0?size:0,kind});
    }
    return output;
  }
  function fromHistory(messages,files=[]){
    const output=[],delivered=new Set();let current=null;
    const assistant=()=>{if(!current){current=createMessage();current.running=false;current.done=true;current.animateIn=false;output.push(current)}return current};
    for(const m of messages||[]){
      if(m.role==='user'){current=null;const text=typeof m.content==='string'?m.content:(m.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('');const attachments=historyAttachments(m.attachments);if(text||attachments.length)output.push({role:'user',text,...(attachments.length?{attachments}:{})})}
      else if(m.role==='assistant'){
        if(m.uiStopped){const stopped=assistant();stopped.stopped=true;stopped.error='已停止'}
        if(['failed','unchanged'].includes(m.uiMemoryWarning))assistant().memoryWarning=m.uiMemoryWarning;
        if(m.delivery?.warning==='unclassified_artifacts'&&Array.isArray(m.delivery.unpublishedArtifacts)&&m.delivery.unpublishedArtifacts.length)assistant().deliveryNotice='已生成文件，但尚未确定交付：'+m.delivery.unpublishedArtifacts.join('、')+'。请告诉助手需要哪一份。';
        for(const part of m.content||[]){if(part.type==='text'&&part.text)applyEvent(assistant(),{type:'text_delta',text:part.text});else if(part.type==='thinking')applyEvent(assistant(),{type:'thinking'});else if(part.type==='toolCall'&&part.name!=='ask_question'){applyEvent(assistant(),{type:'tool_start',id:part.id,name:part.name,target:part.target});if(part.uiConfirmation)assistant().parts.push({type:'confirmation',id:part.id,confirmation:part.uiConfirmation,status:'unknown',replayed:true})}else if(part.type==='toolCall'&&part.name==='ask_question'&&part.arguments?.question)recordAnsweredQuestion(assistant(),{question:part.arguments.question})}
        if(normalizeMemoryItems(m.memory).length)appendMemory(assistant(),m.memory);
      }else if(m.role==='toolResult'){
        if(m.toolName==='ask_question'){if(!m.isError&&typeof m.details?.answer==='string'){current=null;output.push({role:'user',text:m.details.answer})}continue}
        if(current){applyEvent(current,{type:'tool_end',id:m.toolCallId,failed:!!m.isError,target:m.target});const confirm=current.parts.find(part=>part.type==='confirmation'&&part.id===m.toolCallId);if(confirm)confirm.status=m.isError?'incomplete':'done'}
        const names=m.toolName==='deliver_files'?(Array.isArray(m.details?.deliverables)?m.details.deliverables:[]):[m.details?.name,m.details?.pdf].filter(Boolean);for(const file of files){const explicit=file.delivery==='explicit';if(names.includes(file.name)&&(explicit?m.toolName==='deliver_files':!delivered.has(file.url))){applyEvent(assistant(),{type:'file',...file});delivered.add(file.url)}}
      }
    }
    for(const file of files)if(!delivered.has(file.url))applyEvent(assistant(),{type:'file',...file});
    for(const item of output)if(item.role==='assistant')finishMessage(item,{stopped:!!item.stopped});
    return output;
  }
  return {summarizeActivitySteps,createMessage,applyEvent,finishMessage,fromHistory,normalizeMemoryItems,appendMemory,recordConfirmation,recordAnsweredQuestion,applyStoppedSession,generationStatus};
});
