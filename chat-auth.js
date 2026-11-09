(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatAuth=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function createAuthClient(fetcher){
    async function request(url,options={}){
      const response=await fetcher(url,{credentials:'same-origin',...options});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'服务暂时不可用，请重试');
      return body;
    }
    return {
      async login(account,password){return (await request('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,password})})).user;},
      async me(){return (await request('/auth/me')).user;},
      async logout(){await request('/auth/logout',{method:'POST'});},
    };
  }
  function resolveEntryPath(user,demoRole,path){
    if(user)return path==='settings'||path.startsWith('student/')?path:'student/chat';
    const homes={teacher:'teacher/dashboard',enterprise:'enterprise/jobs'};
    if(!Object.hasOwn(homes,demoRole))return 'login';
    return path==='settings'||path.startsWith(demoRole+'/')?path:homes[demoRole];
  }
  return {createAuthClient,resolveEntryPath};
});
