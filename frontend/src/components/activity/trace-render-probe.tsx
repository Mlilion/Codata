"use client";
import { Profiler, useLayoutEffect, useRef, type ReactNode } from 'react';
import { recordArtifactCommit } from '@/lib/execution-trace';

/** In production without React profiling, layout effect still measures delivery-to-frame. */
export function TraceRenderProbe({traceId,callId,children}:{traceId?:string;callId:string;children:ReactNode}){
  const element=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(traceId)recordArtifactCommit(traceId,callId,element.current);},[traceId,callId,children]);
  return <Profiler id={callId} onRender={(_id,_phase,actualDuration)=>{
    if(traceId)recordArtifactCommit(traceId,callId,element.current,actualDuration);
  }}><div ref={element}>{children}</div></Profiler>;
}
