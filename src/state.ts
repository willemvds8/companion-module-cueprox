export interface LiveAlert { id:number; text:string; timestamp?:number }
export function activeAlertText(alerts:readonly LiveAlert[]):string {
  return alerts.length ? alerts[alerts.length-1].text : ''
}
export function resolvedQaOpen(qa:{status?:'open'|'closed'|'no_event';qa_open_override:number|null}):boolean {
  return qa.status ? qa.status==='open' : qa.qa_open_override===1
}
export function broadcastRequest(payload:{streaming:boolean;recording:boolean;scene:string|null;source:string}) {
  return {streaming:payload.streaming,recording:payload.recording,current_scene:payload.scene,source:payload.source}
}
