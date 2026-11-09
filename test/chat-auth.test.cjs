const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAuthClient}=require('../chat-auth.js');

test('login sends credentials to backend and returns the authenticated user',async()=>{
 const calls=[];
 const auth=createAuthClient(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({user:{id:'alice',displayName:'Alice',role:'student'}})};});
 const user=await auth.login('alice','a secure password');
 assert.equal(user.id,'alice');assert.equal(calls[0].url,'/auth/login');
 assert.deepEqual(JSON.parse(calls[0].options.body),{account:'alice',password:'a secure password'});
 assert.equal(calls[0].options.credentials,'same-origin');
});
test('invalid login is surfaced and logout calls backend',async()=>{
 const calls=[];const auth=createAuthClient(async(url)=>{calls.push(url);return {ok:url==='/auth/logout',json:async()=>({error:'账号或密码错误'})};});
 await assert.rejects(()=>auth.login('alice','wrong'),/账号或密码错误/);
 await auth.logout();assert.deepEqual(calls,['/auth/login','/auth/logout']);
});

test('routes demo roles to their own pages without granting student access',()=>{
 const {resolveEntryPath}=require('../chat-auth.js');
 assert.equal(resolveEntryPath(null,null,'teacher/dashboard'),'login');
 assert.equal(resolveEntryPath(null,'teacher','login'),'teacher/dashboard');
 assert.equal(resolveEntryPath(null,'enterprise','enterprise/scoring'),'enterprise/scoring');
 assert.equal(resolveEntryPath(null,'teacher','student/chat'),'teacher/dashboard');
 assert.equal(resolveEntryPath(null,'enterprise','teacher/students'),'enterprise/jobs');
 assert.equal(resolveEntryPath({role:'student'},null,'teacher/dashboard'),'student/chat');
 assert.equal(resolveEntryPath({role:'student'},null,'student/chat'),'student/chat');
 assert.equal(resolveEntryPath(null,'unknown','teacher/dashboard'),'login');
});
