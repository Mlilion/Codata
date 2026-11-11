"use client";

import { api } from "@/lib/api";
import { useExecutionTraceStore } from "@/stores/execution-trace-store";
import type { ExecutionTrace, LiveTrace, TraceSpan, TraceTiming } from "@/types/execution-trace";
import type { SSEEventData } from "@/types/streaming";
import {traceViewSpans} from './trace-view-spans';

const store = useExecutionTraceStore;
const calibrations = new Map<string, Promise<void>>();
const finalizing = new Set<string>();

export function beginClientTrace(sessionId: string, traceId: string, startedPerf: number, startedEpoch: number) {
  store.getState().ensure(sessionId, traceId);
  store.getState().patch(traceId, { clientStartPerfMs: startedPerf, clientStartEpochMs: startedEpoch });
}

/** Abort acknowledgements must close the trace before the SSE stream is torn down. */
export function cancelClientTrace(sessionId: string, traceId: string, snapshot?: ExecutionTrace, missing = false) {
  if (snapshot?.trace_id === traceId && snapshot.completed) {
    store.getState().hydrate(sessionId, snapshot);
    return;
  }
  const current=store.getState().traces[traceId];
  if (!current || current.completed) return;
  const now=performance.now();
  const elapsed=Math.max(current.duration_ms,(current.receivedServerMs??0)+Math.max(0,now-(current.receivedPerfMs??now)));
  store.getState().patch(traceId,{completed:true,duration_ms:elapsed,
    spans:current.spans.map(span=>span.status==='running'?{...span,status:missing?'incomplete':'cancelled',
      durationMs:Math.max(span.durationMs,elapsed-span.startMs),attributes:{...span.attributes,
        cancel_boundary:missing?'server job no longer exists':'browser received abort acknowledgement; server boundary unavailable'}}:span),
    metrics:{...current.metrics,...(current.clientStartPerfMs===undefined?{}:{end_to_end_ms:Math.max(0,now-current.clientStartPerfMs)})},
  });
}

export function calibrateTrace(traceId: string): Promise<void> {
  const existing = calibrations.get(traceId); if (existing) return existing;
  const task = (async () => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      try {
        const start = performance.now(), epoch = performance.timeOrigin + start;
        const result = await api.get<{server_epoch_ms: number}>("/api/chat/clock", { timeoutMs: 3000 });
        const rtt = performance.now() - start;
        if (rtt < best) {
          best = rtt;
          store.getState().patch(traceId, { offsetMs: result.server_epoch_ms - (epoch + rtt / 2), uncertaintyMs: rtt / 2 });
        }
      } catch { /* Uncalibrated clocks remain explicitly unavailable. */ }
    }
  })();
  calibrations.set(traceId, task);
  if (calibrations.size > 50) calibrations.delete(calibrations.keys().next().value!);
  return task;
}

function addClientSpan(traceId: string, span: TraceSpan) {
  const t = store.getState().traces[traceId]; if (!t) return;
  const items = t.clientSpans.filter(s => s.id !== span.id);
  store.getState().patch(traceId, { clientSpans: [...items.slice(-198), span] });
}

export function ingestTraceSpan(sessionId: string, traceId: string, data: SSEEventData) {
  store.getState().ensure(sessionId, traceId);
  const payload = data as SSEEventData & { span?: TraceSpan; origin_epoch_ms?: number; elapsed_ms?: number };
  const current=store.getState().traces[traceId];
  if(current.completed)return;
  if (payload.span && Number.isFinite(payload.span.startMs)) store.getState().upsert(traceId, payload.span);
  if (payload.origin_epoch_ms) store.getState().patch(traceId, {
    origin_epoch_ms: payload.origin_epoch_ms, receivedPerfMs: performance.now(),
    receivedServerMs: payload.elapsed_ms ?? 0, duration_ms: store.getState().traces[traceId].completed
      ?store.getState().traces[traceId].spans.find(s=>s.kind==='request')?.durationMs??payload.elapsed_ms??0:payload.elapsed_ms??0,
  });
}

export function observeSSE(sessionId: string, traceId: string, type: string, data: SSEEventData, id: number, timing: TraceTiming) {
  store.getState().ensure(sessionId, traceId);
  const t = store.getState().traces[traceId];
  const meta = data._trace;
  const delivery = data._delivery;
  if (!meta) return; // Older deployments have no fabricated server/SSE measurements.
  const publishedMs = meta.published_ms;
  const arrivalMs = t.offsetMs === undefined ? publishedMs + (delivery?.server_queue_ms ?? 0)
    : timing.receivedEpochMs + t.offsetMs - meta.origin_epoch_ms;
  const transfer = delivery && t.offsetMs !== undefined ? timing.receivedEpochMs + t.offsetMs - delivery.sent_epoch_ms : undefined;
  const attrs = {
    call_id: data.call_id ?? undefined,
    event_seq: id, event_type: type, received_epoch_ms: timing.receivedEpochMs,
    server_queue_ms: delivery?.server_queue_ms, parse_ms: timing.parseMs, handler_ms: timing.handlerMs,
    encode_ms: delivery?.encode_ms,
    transfer_estimate_ms: transfer, clock_uncertainty_ms: t.uncertaintyMs,
    clock: t.offsetMs === undefined ? "未校准：不展示单向传输耗时" : "发送准备→浏览器回调：含传输与回调排队，跨端校准误差至少 RTT/2",
  };
  if (type === "trace-span") {
    const span = (data as SSEEventData & { span?: TraceSpan }).span;
    const current = span && store.getState().traces[traceId].spans.find(s => s.id === span.id);
    if (current) store.getState().upsert(traceId, { ...current, attributes: { ...current.attributes, delivery: attrs } });
  }
  store.getState().event(traceId, { id, type, receivedEpochMs: timing.receivedEpochMs, parseMs: timing.parseMs, handlerMs: timing.handlerMs });
  const current = store.getState().traces[traceId];
  store.getState().patch(traceId, { origin_epoch_ms: meta.origin_epoch_ms,
    receivedPerfMs: timing.receivedPerfMs, receivedServerMs: publishedMs + (delivery?.server_queue_ms ?? 0),
    duration_ms: current.completed?current.duration_ms:Math.max(current.duration_ms, publishedMs),
    metrics: { ...current.metrics, sse_events: (current.metrics.sse_events ?? 0) + 1,
      sse_parse_ms: (current.metrics.sse_parse_ms ?? 0) + timing.parseMs,
      sse_encode_ms: (current.metrics.sse_encode_ms ?? 0) + (delivery?.encode_ms ?? 0),
      sse_handler_ms: (current.metrics.sse_handler_ms ?? 0) + timing.handlerMs },
  });
  if(type==='tool-result'&&data.call_id)store.getState().patch(traceId,{toolReceipts:{...store.getState().traces[traceId].toolReceipts,[data.call_id]:timing.receivedPerfMs}});
  // Sample delivery spans only at meaningful output boundaries, never per token.
  if (current.spans.find(s=>s.kind==='request')?.status!=='cancelled'&&((type === 'text-delta' && !current.clientSpans.some(s => s.attributes.event_type === type))
      || ['tool-result', 'tool-error', 'done', 'agent-error'].includes(type))) {
    const measured = t.offsetMs !== undefined && arrivalMs >= publishedMs;
    addClientSpan(traceId, { id: `client-sse-${id}`, parentId: 'request', name: `SSE 到达 · ${type}`,
      service: 'SSE', kind: 'sse', startMs: publishedMs, durationMs: measured ? arrivalMs - publishedMs : delivery?.server_queue_ms ?? 0,
      status: measured ? 'ok' : 'incomplete', attributes: attrs });
  }
  if (type === 'done' || type === 'agent-error') {
    if(type==='done'&&data.finish_reason==='aborted')cancelClientTrace(sessionId,traceId);
    store.getState().patch(traceId, { completed: true, metrics: { ...store.getState().traces[traceId].metrics, done_received_perf_ms: timing.receivedPerfMs } });
  }
}

function browserStartOffset(t: LiveTrace, perf: number) {
  return performance.timeOrigin + perf + (t.offsetMs ?? 0) - t.origin_epoch_ms;
}

const pendingArtifacts = new Set<string>();
export function recordArtifactCommit(traceId:string, callId:string, element:HTMLElement|null, reactMs?:number) {
  const t=store.getState().traces[traceId], received=t?.toolReceipts?.[callId];
  const key=`${traceId}:${callId}`, spanId=`client-artifact-${callId}`;
  if(!t||t.completed||received===undefined||!element?.isConnected||element.getBoundingClientRect().width<=0
    ||document.visibilityState!=='visible'||pendingArtifacts.has(key)||t.clientSpans.some(s=>s.id===spanId))return;
  pendingArtifacts.add(key);
  const committed=performance.now();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    pendingArtifacts.delete(key);
    if(!element.isConnected||document.visibilityState!=='visible')return;
    const painted=performance.now(), current=store.getState().traces[traceId];if(!current||current.completed)return;
    addClientSpan(traceId,{id:spanId,parentId:'request',name:'数据卡片 · SSE 接收 → 挂载与帧确认',service:'前端',kind:'frontend',
      startMs:browserStartOffset(current,received),durationMs:painted-received,status:'ok',attributes:{call_id:callId,
        clock:'browser performance.now()',receive_to_commit_ms:committed-received,commit_to_frame_ms:painted-committed,
        ...(reactMs===undefined?{}:{react_actual_duration_ms:reactMs}),boundary:'含事件缓冲、React 调度与双帧确认；非 GPU 精确绘制'}});
  }));
}

export function recordTextCommit(sessionId: string, hasText: boolean) {
  const traceId = store.getState().activeBySession[sessionId];
  const t = store.getState().traces[traceId];
  if (!hasText || !t?.origin_epoch_ms || t.completed || t.metrics.first_text_commit_perf_ms !== undefined || t.metrics.paint_pending) return;
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  const commitPerf = performance.now();
  store.getState().patch(traceId, { metrics: { ...t.metrics, paint_pending: 1 } });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const current = store.getState().traces[traceId]; if (!current||current.completed) return;
    const painted = performance.now();
    const firstText = current.clientStartPerfMs === undefined ? undefined : painted - current.clientStartPerfMs;
    store.getState().patch(traceId, { metrics: { ...current.metrics, paint_pending: 0,
      ...(firstText === undefined ? {} : { first_text_paint_ms: firstText }), first_text_commit_perf_ms: commitPerf } });
    addClientSpan(traceId, { id: 'client-first-paint', parentId: 'request', name: '首段文本 · React 提交 → 绘制确认',
      service: '前端', kind: 'frontend', startMs: browserStartOffset(current, commitPerf), durationMs: painted - commitPerf,
      status: 'ok', attributes: { clock: 'browser performance.now()', boundary: 'useLayoutEffect → 双帧回调（近似绘制）' } });
  }));
}

export async function finalizeClientTrace(sessionId: string, traceId: string) {
  if (finalizing.has(traceId)) return;
  const initial = store.getState().traces[traceId]; if (!initial?.origin_epoch_ms) return;
  if (initial.spans.find(s=>s.kind==='request')?.status==='cancelled') return;
  if (initial.metrics.done_received_perf_ms === undefined) return;
  finalizing.add(traceId);
  if (document.visibilityState === 'visible') await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const t = store.getState().traces[traceId];
  const now = performance.now();
  if (document.visibilityState === 'visible' && t.metrics.done_received_perf_ms !== undefined) {
    const received = t.metrics.done_received_perf_ms;
    addClientSpan(traceId, { id: 'client-final-paint', parentId: 'request', name: '完成事件 → 最终内容交接与绘制',
      service: '前端', kind: 'frontend', startMs: browserStartOffset(t, received), durationMs: now - received,
      status: 'ok', attributes: { clock: 'browser performance.now()', boundary: '含缓冲刷新 / DB 交接 / React 提交 / 双帧确认' } });
    const current = store.getState().traces[traceId];
    store.getState().patch(traceId, { metrics: { ...current.metrics,
      ...(t.clientStartPerfMs === undefined ? {} : { end_to_end_ms: now - t.clientStartPerfMs }) } });
  }
  const report = store.getState().traces[traceId];
  const deliveries = Object.fromEntries(report.spans.filter(s => s.attributes.delivery).map(s => [s.id,
    Object.fromEntries(Object.entries(s.attributes.delivery as Record<string,unknown>).filter(([,v])=>v!==undefined))]));
  const spans = report.clientSpans.filter(s => s.startMs >= -60000 && Number.isFinite(s.startMs + s.durationMs)).map(s => ({
    ...s, attributes: Object.fromEntries(Object.entries(s.attributes).filter(([,v]) => v !== undefined)) }));
  // The server may still be committing its trace; retry observation only.
  for (const delay of [0, 300, 1000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try { await api.post(`/api/chat/trace/${encodeURIComponent(traceId)}/client`, { session_id: sessionId, spans, metrics: report.metrics, deliveries }); return; }
    catch { /* Keep local evidence even when uploading is unavailable. */ }
  }
  finalizing.delete(traceId);
}

export function displaySpans(t: LiveTrace, nowPerf: number): TraceSpan[] {
  const elapsed = t.completed ? t.duration_ms : Math.max(t.duration_ms,
    (t.receivedServerMs ?? 0) + Math.max(0, nowPerf - (t.receivedPerfMs ?? nowPerf)));
  const all = [...t.spans, ...t.clientSpans];
  const projected=all.map(s => ({ ...s,
    durationMs: s.status === 'running' ? Math.max(s.durationMs, elapsed - s.startMs) : s.durationMs }));
  return traceViewSpans(projected,{
    clientStartMs:t.clientStartEpochMs!==undefined&&t.offsetMs!==undefined&&t.origin_epoch_ms
      ?t.clientStartEpochMs+t.offsetMs-t.origin_epoch_ms:undefined,
    endToEndMs:t.metrics.end_to_end_ms,
  });
}
