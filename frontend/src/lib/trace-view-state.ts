/** Per-record presentation state survives desktop/sidebar/sheet remounts.
 * Ephemeral UI only: never changes measurements or restarts execution.
 */
export interface TraceViewState {
  view:'tools'|'waterfall'|'graph';selected:string|null;expanded:boolean;follow:boolean;clockHelp:boolean;
  tab:'summary'|'io'|'events';locate:number;replayMs:number|null;playing:boolean;speed:number;
  waterfall:Record<string,unknown>;graphCamera:{x:number;y:number;w:number};
  expandedToolIds:string[];toolTargets:string[];
}
const cache=new Map<string,Partial<TraceViewState>>();
export function readTraceViewState(key:string):Partial<TraceViewState>|undefined{return cache.get(key);}
export function saveTraceViewState(key:string,patch:Partial<TraceViewState>):void{
  const previous=cache.get(key);cache.delete(key);cache.set(key,{...previous,...patch});
  if(cache.size>50)cache.delete(cache.keys().next().value!);
}
