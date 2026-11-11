import type { TraceSpan } from '@/types/execution-trace';

const END_ATTRIBUTES=new Set(['output_preview','error_preview','time_start','time_end','timed_out','failed_count','provider_await_ms','delivery','active_count','peak_concurrency',
 'received_epoch_ms','parse_ms','handler_ms','transfer_estimate_ms','receive_to_commit_ms','commit_to_frame_ms','react_actual_duration_ms','encode_ms','server_queue_ms']);

/** Replay measured intervals only. Does not issue requests or fabricate tokens. */
export function replaySpans(spans:TraceSpan[], cursor:number):TraceSpan[]{
  return spans.filter(s=>s.startMs<=cursor).map(s=>{
    const finished=cursor>=s.startMs+s.durationMs;
    return {...s,durationMs:Math.max(0,Math.min(s.durationMs,cursor-s.startMs)),
      status:finished?s.status:'running',
      attributes:finished?s.attributes:Object.fromEntries(Object.entries(s.attributes).filter(([key])=>!END_ATTRIBUTES.has(key)))};
  });
}

export function replayBoundaries(spans:TraceSpan[]):number[]{
  return [...new Set([0,...spans.flatMap(s=>[s.startMs,s.startMs+s.durationMs])])].sort((a,b)=>a-b);
}

export function nextReplayTime(times:number[],cursor:number,direction:1|-1):number{
  return direction===1?(times.find(t=>t>cursor+.000001)??times.at(-1)??0)
    :([...times].reverse().find(t=>t<cursor-.000001)??0);
}
