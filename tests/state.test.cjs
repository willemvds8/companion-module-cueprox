const {test}=require('node:test');
const assert=require('node:assert/strict');
const {activeAlertText,resolvedQaOpen,broadcastRequest}=require('../dist/state');
const {CueProxApi}=require('../dist/api');
test('resolved Auto Q&A state wins; older servers retain manual override support',()=>{
 assert.equal(resolvedQaOpen({status:'open',qa_open_override:null}),true);
 assert.equal(resolvedQaOpen({status:'closed',qa_open_override:1}),false);
 assert.equal(resolvedQaOpen({qa_open_override:1}),true);
});
test('current remaining alert drives text; empty snapshot clears stale text',()=>{
 assert.equal(activeAlertText([{id:1,text:'First'},{id:2,text:'Second'}]),'Second');
 assert.equal(activeAlertText([{id:1,text:'First'}]),'First');assert.equal(activeAlertText([]),'');
});
test('broadcast API uses the scene field understood by the app',()=>{
 assert.deepEqual(broadcastRequest({scene:'Camera 2',streaming:true,recording:false,source:'OBS'}),{current_scene:'Camera 2',streaming:true,recording:false,source:'OBS'});
});
test('real API client serializes broadcast and keeps action endpoint compatible',async()=>{
 const previous=global.fetch;let sent;
 global.fetch=async(url,options)=>{sent={url,options};return new Response(JSON.stringify({ok:true}),{status:200})};
 try{const api=new CueProxApi('http://localhost:3000','disposable');await api.updateBroadcastState(7,{scene:'Wide',streaming:true,recording:true,source:'OBS'});assert.equal(JSON.parse(sent.options.body).current_scene,'Wide');assert(sent.url.endsWith('/rooms/7/integrations/broadcast/state'))}finally{global.fetch=previous}
});
