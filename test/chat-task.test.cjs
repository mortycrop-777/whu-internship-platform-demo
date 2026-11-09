const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTaskClient}=require('../chat-task.js');

function response(body,status=200){return new Response(body,{status,headers:{'content-type':'text/event-stream'}})}
test('reconnects after an interrupted stream with a cursor and does not replay delivered events',async()=>{
 const urls=[],seen=[];
 const fetcher=async url=>{urls.push(url);return urls.length===1?response('id: 1\ndata: {"type":"text_delta","text":"你"}\n\n'):response('id: 2\ndata: {"type":"done","answer":"你好"}\n\n')};
 const client=createTaskClient(fetcher,{wait:async()=>{}});
 await client.follow('task-1',{onEvent:event=>seen.push(event)});
 assert.deepEqual(seen.map(x=>x.type),['text_delta','done']);
 assert.match(urls[0],/after=0/);assert.match(urls[1],/after=1/);
});
test('submission retries network failure using the same request id',async()=>{
 const payloads=[];let attempts=0;
 const client=createTaskClient(async(url,options)=>{payloads.push(JSON.parse(options.body));if(!attempts++)throw new Error('network');return new Response(JSON.stringify({id:'task-1',status:'queued'}),{status:202})},{wait:async()=>{}});
 assert.equal((await client.submit({requestId:'same',message:'hello'})).id,'task-1');
 assert.deepEqual(payloads.map(x=>x.requestId),['same','same']);
});
test('does not retry authorization or validation errors forever',async()=>{
 let count=0;const client=createTaskClient(async()=>{count++;return new Response(JSON.stringify({error:'请先登录'}),{status:401})},{wait:async()=>{}});
 await assert.rejects(()=>client.submit({requestId:'x',message:'hello'}),/请先登录/);assert.equal(count,1);
});
test('reconstructs the prior history boundary before replaying the running turn',()=>{
 const {buildTaskMessages}=require('../chat-task.js');const stream=require('../chat-stream.js');
 const history=[{role:'user',content:'之前'},{role:'assistant',content:[{type:'text',text:'旧回复'}]},{role:'user',content:'当前'},{role:'assistant',content:[{type:'text',text:'正在生成'}]}];
 const task={input:{message:'当前',attachments:[{name:'简历.pdf',size:12,kind:'pdf'}]}};
 const messages=buildTaskMessages(task,history,[],stream,2);
 assert.deepEqual(messages.map(x=>x.role),['user','assistant','user','assistant']);
 assert.equal(messages[2].text,'当前');assert.equal(messages[2].attachments[0].name,'简历.pdf');
 assert.equal(messages[3].running,true);
});
test('shows queued and reconnecting states while the task remains active',()=>{
 const stream=require('../chat-stream.js');const message=stream.createMessage();message.queued=true;
 assert.equal(stream.generationStatus(message),'等待空闲的助手');
 message.reconnecting=true;assert.equal(stream.generationStatus(message),'连接中断，正在重新连接');
 message.reconnecting=false;message.queued=false;assert.equal(stream.generationStatus(message),'正在生成');
});
