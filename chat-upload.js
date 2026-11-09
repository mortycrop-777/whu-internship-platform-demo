(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChatUpload=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const MAX_FILE_BYTES=50*1024*1024;
  const MAX_IMAGE_BYTES=20*1024*1024;
  const MAX_PER_TURN=20;
  const MAX_PER_SESSION=20;
  const EXTENSIONS=['.docx','.pdf','.png','.jpg','.jpeg','.webp'];
  const IMAGE_MIME_EXTENSIONS={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
  const REJECTIONS={type:'仅支持 Word、PDF、PNG、JPG、WebP 文件',size:'超过大小限制（图片 20MB，文档 50MB）',empty:'不支持空文件',invalid:'文件无效，请重新选择',duplicate:'同一文件不能重复添加',limit:'每个会话最多上传 20 个文件',network:'上传失败，请检查服务连接'};
  const STATUS_MESSAGES={400:'文件无法上传，请检查文件内容',404:'上传目标不存在，请刷新后重试',409:'文件重名或会话状态已变化，请重试',413:'超过大小限制（图片 20MB，文档 50MB）',415:'仅支持 Word、PDF、PNG、JPG、WebP 文件'};
  function extensionOf(name){const match=/\.([a-z0-9]+)$/i.exec(String(name||'').trim());return match?'.'+match[1].toLowerCase():''}
  function kindOf(name){const extension=extensionOf(name);if(extension==='.docx')return 'docx';if(extension==='.pdf')return 'pdf';if(extension==='.png'||extension==='.jpg'||extension==='.jpeg'||extension==='.webp')return 'image';return null}
  function maxBytesFor(kind){return kind==='image'?MAX_IMAGE_BYTES:MAX_FILE_BYTES}
  function formatSize(bytes){const value=Number(bytes);if(!Number.isFinite(value)||value<0)return '';if(value<1024)return Math.round(value)+' B';if(value<1024*1024)return Math.max(1,Math.round(value/1024))+' KB';return (value/1024/1024).toFixed(1)+' MB'}
  function fileKindClass(name){const kind=kindOf(name);return kind==='image'?'is-image':kind==='docx'?'is-word':kind==='pdf'?'is-pdf':''}
  function middleEllipsis(name,maxChars){
    const text=String(name||'');
    const limit=Math.max(8,Math.floor(Number(maxChars)||0));
    if(text.length<=limit)return text;
    const dot=text.lastIndexOf('.');
    const extension=dot>0&&dot<text.length-1?text.slice(dot):'';
    const tailLength=Math.min(Math.max(extension.length,4),Math.max(4,limit-3));
    const headLength=Math.max(2,limit-1-tailLength);
    return text.slice(0,headLength)+'…'+text.slice(text.length-tailLength);
  }
  function summaryText(items){
    const list=Array.from(items||[]);
    const total=list.reduce((sum,item)=>{const size=Number(item&&(item.serverSize!==undefined?item.serverSize:item.size));return sum+(Number.isFinite(size)&&size>0?size:0)},0);
    return {count:list.length,total,totalLabel:formatSize(total),text:list.length+' 个文件 · 共 '+formatSize(total),limitReached:list.length>=MAX_PER_SESSION};
  }
  const COMPOSER_EXPAND_LINES=8;
  const COMPOSER_EXPAND_CHARS=300;
  function composerLayout({text='',lineCount=1,uploadCount=0}={}){
    const value=String(text==null?'':text);
    const lines=Math.max(1,Math.floor(Number(lineCount)||1));
    const chars=Array.from(value).length;
    const multiline=lines>1||value.includes('\n')||Number(uploadCount)>0;
    const expandable=multiline&&(lines>=COMPOSER_EXPAND_LINES||chars>=COMPOSER_EXPAND_CHARS);
    return {multiline,expandable,lineCount:lines,chars};
  }
  function rejectionText(reason){return REJECTIONS[reason]||'文件未添加'}
  function validateSelection(files,{turnCount=0,sessionCount=0}={}){
    const accepted=[],rejected=[],seen=new Set();
    const used=Math.max(Number(sessionCount)||0,Number(turnCount)||0);
    const remaining=Math.max(0,MAX_PER_SESSION-used);
    for(const file of Array.from(files||[])){
      const name=file&&typeof file.name==='string'?file.name.trim():'';
      if(!name){rejected.push({name:'',reason:'invalid'});continue}
      const kind=kindOf(name);
      if(!kind){rejected.push({name,reason:'type'});continue}
      const size=Number(file.size);
      if(!Number.isFinite(size)||size<=0){rejected.push({name,reason:'empty'});continue}
      if(size>maxBytesFor(kind)){rejected.push({name,reason:'size'});continue}
      const key=name.toLocaleLowerCase();
      if(seen.has(key)){rejected.push({name,reason:'duplicate'});continue}
      if(accepted.length>=remaining){rejected.push({name,reason:'limit'});continue}
      seen.add(key);accepted.push(file);
    }
    return {accepted,rejected};
  }
  function normalizeUploadFiles(files){
    const stamp=Date.now();
    return Array.from(files||[]).map((file,index)=>{
      if(!file)return file;
      const name=typeof file.name==='string'?file.name.trim():'';
      if(name&&extensionOf(name))return file;
      const mime=typeof file.type==='string'?file.type.toLowerCase():'';
      const extension=IMAGE_MIME_EXTENSIONS[mime];
      if(!extension)return file;
      const fallback='粘贴图片-'+stamp+'-'+(index+1)+extension;
      const source=file;
      try{
        if(typeof File==='function')return new File([source],fallback,{type:source.type||mime,lastModified:Number.isFinite(source.lastModified)?source.lastModified:stamp});
      }catch{}
      return {name:fallback,size:source.size,type:source.type||mime,lastModified:Number.isFinite(source.lastModified)?source.lastModified:stamp,__file:source};
    });
  }
  function buildChips(items){
    return Array.from(items||[]).map((item,index)=>{
      const source=item||{};
      const name=String(source.serverName||source.name||'').trim();
      const size=Number(source.serverSize!==undefined?source.serverSize:source.size);
      const status=source.status==='done'?'done':source.status==='error'?'error':'uploading';
      const hasProgress=status==='uploading'&&Number.isFinite(Number(source.progress));
      const progress=status==='done'?100:status==='error'?0:hasProgress?Math.max(0,Math.min(100,Math.round(Number(source.progress)))):null;
      return {id:String(source.id??index),index,name,sizeLabel:formatSize(size),kind:kindOf(name),status,progress,statusLabel:status==='done'?'已上传':status==='error'?'上传失败':hasProgress?'上传中 '+progress+'%':'上传中',error:status==='error'?String(source.error||'上传失败，请重试'):'',canRetry:status==='error',canRemove:true};
    });
  }
  function sentAttachments(items){
    return Array.from(items||[]).filter(item=>item&&item.status==='done').map(item=>{
      const name=String(item.serverName||item.name||'').trim();
      const size=Number(item.serverSize!==undefined?item.serverSize:item.size);
      const kind=kindOf(name)||(item.kind==='pdf'?'pdf':item.kind==='docx'?'docx':item.kind==='image'?'image':'');
      return {name,size:Number.isFinite(size)&&size>=0?size:0,kind};
    });
  }
  function targetQuery(target){if(target&&target.sessionId)return 'session='+encodeURIComponent(target.sessionId);if(target&&target.workspaceId)return 'workspace='+encodeURIComponent(target.workspaceId);return ''}
  function uploadsUrl(target){const query=targetQuery(target);return '/api/uploads'+(query?'?'+query:'')}
  function deleteUrl(target,name){const query=targetQuery(target);return '/api/uploads?'+[query,'name='+encodeURIComponent(String(name||''))].filter(Boolean).join('&')}
  function uploadErrorMessage(status,serverMessage){if(status===413||status===415)return STATUS_MESSAGES[status];const message=typeof serverMessage==='string'?serverMessage.trim():'';if(message)return message;return STATUS_MESSAGES[status]||('上传失败（'+status+'）')}
  class UploadError extends Error{
    constructor(message,{status=0,fileName=''}={}){super(message);this.name='UploadError';this.status=status;this.fileName=fileName}
  }
  function createUploader({xhrFactory}={}){
    const factory=typeof xhrFactory==='function'?xhrFactory:()=>new XMLHttpRequest();
    function request(method,url,{headers={},body=null,onProgress,fileName=''}={}){
      const xhr=factory();
      const promise=new Promise((resolve,reject)=>{
        let settled=false;
        xhr.open(method,url);
        for(const [key,value] of Object.entries(headers))xhr.setRequestHeader(key,value);
        if(xhr.upload&&typeof onProgress==='function')xhr.upload.onprogress=event=>{if(event&&event.lengthComputable&&event.total)onProgress(Math.round(event.loaded/event.total*100));else onProgress(null)};
        xhr.onload=()=>{
          if(settled)return;settled=true;
          let data=null;try{data=JSON.parse(xhr.responseText)}catch{}
          if(xhr.status>=200&&xhr.status<300)resolve(data||{});
          else reject(new UploadError(uploadErrorMessage(xhr.status,data&&data.error),{status:xhr.status,fileName}));
        };
        xhr.onerror=()=>{if(settled)return;settled=true;reject(new UploadError(REJECTIONS.network,{status:0,fileName}))};
        xhr.onabort=()=>{if(settled)return;settled=true;const error=new UploadError('上传已取消',{status:0,fileName});error.aborted=true;reject(error)};
        try{xhr.send(body)}catch(error){if(settled)return;settled=true;reject(new UploadError(error&&error.message||REJECTIONS.network,{status:0,fileName}))}
      });
      return {promise,abort:()=>{try{xhr.abort()}catch{}}};
    }
    function uploadFile({file,target,onProgress}={}){
      if(!file||typeof file.name!=='string')return {promise:Promise.reject(new UploadError(REJECTIONS.invalid)),abort(){}};
      if(!targetQuery(target))return {promise:Promise.reject(new UploadError('缺少上传目标')),abort(){}};
      return request('POST',uploadsUrl(target),{headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file,onProgress,fileName:file.name});
    }
    function deleteUpload({name,target}={}){
      if(!targetQuery(target))return Promise.reject(new UploadError('缺少上传目标'));
      return request('DELETE',deleteUrl(target,name),{fileName:name}).promise;
    }
    return {uploadFile,deleteUpload};
  }
  function randomId(){const cryptoObject=typeof globalThis!=='undefined'?globalThis.crypto:undefined;if(cryptoObject&&typeof cryptoObject.randomUUID==='function')return cryptoObject.randomUUID();return 'upload-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}
  return {MAX_FILE_BYTES,MAX_IMAGE_BYTES,MAX_PER_TURN,MAX_PER_SESSION,EXTENSIONS,REJECTIONS,COMPOSER_EXPAND_LINES,COMPOSER_EXPAND_CHARS,extensionOf,kindOf,maxBytesFor,formatSize,fileKindClass,middleEllipsis,summaryText,composerLayout,rejectionText,validateSelection,normalizeUploadFiles,buildChips,sentAttachments,uploadsUrl,deleteUrl,uploadErrorMessage,UploadError,createUploader,randomId};
});
