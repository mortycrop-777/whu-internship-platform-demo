(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatTask=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const terminal=new Set(['done','stopped','error']);
 function defaultWait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Aborted','AbortError'));const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve()}function abort(){clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))}signal?.addEventListener('abort',abort,{once:true})})}
 function createTaskClient(fetcher,{wait=defaultWait,retryDelay=1000}={}){
  async function request(url,options,signal,onRetry){
   for(;;){
    let response;try{response=await fetcher(url,{...options,signal})}catch(error){if(signal?.aborted)throw error;onRetry?.();await wait(retryDelay,signal);continue}
    if(response.ok)return response;
    const data=await response.json().catch(()=>({}));const error=new Error(data.error||'服务暂时不可用');error.status=response.status;
    if(response.status<500)throw error;
    onRetry?.();await wait(retryDelay,signal);
   }
  }
  return {
   async submit(input,{signal,onRetry}={}){const res=await request('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)},signal,onRetry);return res.json()},
   async follow(id,{after=0,signal,onEvent=()=>{},onRetry}={}){
    let cursor=after;
    for(;;){
     const response=await request('/api/tasks/'+encodeURIComponent(id)+'/events?after='+cursor,{},signal,onRetry);
     if(!response.body)throw new Error('无法接收任务进度');
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',ended=false;
     try{
      for(;;){let chunk;try{chunk=await reader.read()}catch(error){if(signal?.aborted)throw error;break}if(chunk.done)break;
       buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>20*1024*1024)throw new Error('任务事件过大');
       buffer=buffer.replace(/\r\n/g,'\n');let end;
       while((end=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const idLine=block.split('\n').find(line=>line.startsWith('id:'));
        const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data)continue;const seq=Number(idLine?.slice(3).trim());if(!Number.isSafeInteger(seq)||seq<=cursor)continue;
        const event=JSON.parse(data);await onEvent(event,seq);cursor=seq;if(terminal.has(event.type)){ended=true;break}
       }
       if(ended)break;
      }
     }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
     if(ended)return {cursor};
     if(signal?.aborted)throw new DOMException('Aborted','AbortError');
     onRetry?.();await wait(retryDelay,signal);
    }
   },
  };
 }
 function buildTaskMessages(task,history,files,stream,baseMessageCount){
  const prior=Array.isArray(history)?history:[];
  const count=Number.isSafeInteger(baseMessageCount)&&baseMessageCount>=0?Math.min(baseMessageCount,prior.length):prior.length;
  const messages=stream.fromHistory(prior.slice(0,count),files||[]);
  const attachments=Array.isArray(task.input?.attachments)?task.input.attachments:[];
  messages.push({role:'user',text:task.input?.message||'',...(attachments.length?{attachments}:{})},stream.createMessage());
  return messages;
 }
 return {createTaskClient,buildTaskMessages};
});
