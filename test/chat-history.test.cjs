const test=require('node:test');
const assert=require('node:assert/strict');
const {groupSessions}=require('../chat-history.js');

test('filters titles and groups conversations by their local update date',()=>{
 const now=new Date(2026,10,2,12);
 const sessions=[{id:'1',title:'简历',updatedAt:new Date(2026,10,2,8).toISOString()},{id:'2',title:'简历修改',updatedAt:new Date(2026,10,1,8).toISOString()},{id:'3',title:'面试',updatedAt:new Date(2026,9,28,8).toISOString()},{id:'4',title:'旧简历',updatedAt:'bad'}];
 assert.deepEqual(groupSessions(sessions,'简历',now).map(g=>[g.label,g.items.map(i=>i.id)]),[['今天',['1']],['昨天',['2']],['更早',['4']]]);
 assert.deepEqual(groupSessions(sessions,'',now).map(g=>g.label),['今天','昨天','最近 7 天','更早']);
});

test('does not report an empty history while loading or when the service is disconnected',()=>{
 const {emptyMessage}=require('../chat-history.js');
 assert.equal(emptyMessage({online:null,loading:true,query:''}),'正在加载对话…');
 assert.equal(emptyMessage({online:false,loading:false,query:''}),'无法连接服务，请检查服务后重试');
 assert.equal(emptyMessage({online:true,loading:false,query:'简历'}),'没有找到相关对话');
 assert.equal(emptyMessage({online:true,loading:false,query:''}),'暂无对话');
});
