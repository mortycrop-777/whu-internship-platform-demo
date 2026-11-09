(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatHistory=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function groupSessions(sessions,query='',now=new Date()){
    const labels=['今天','昨天','最近 7 天','更早'];
    const groups=labels.map(label=>({label,items:[]}));
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const dayNumber=date=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000;
    const needle=query.trim().toLocaleLowerCase();
    for(const item of sessions){
      if(item.local||!String(item.title||'').toLocaleLowerCase().includes(needle))continue;
      const date=new Date(item.updatedAt||item.createdAt);const days=Number.isNaN(date.getTime())?Infinity:dayNumber(start)-dayNumber(date);
      const index=days<=0?0:days===1?1:days<7?2:3;groups[index].items.push(item);
    }
    return groups.filter(group=>group.items.length);
  }
  function emptyMessage({online,loading,query}){if(loading||online===null)return '正在加载对话…';if(!online)return '无法连接服务，请检查服务后重试';return query.trim()?'没有找到相关对话':'暂无对话'}
  return {groupSessions,emptyMessage};
});
