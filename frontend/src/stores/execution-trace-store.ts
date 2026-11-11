"use client";

import { create } from "zustand";
import type { ExecutionTrace, LiveTrace, TraceEvent, TraceSpan } from "@/types/execution-trace";

interface TraceState {
  traces: Record<string, LiveTrace>;
  activeBySession: Record<string, string>;
  ensure: (sessionId: string, traceId: string, activate?:boolean) => void;
  patch: (traceId: string, patch: Partial<LiveTrace>) => void;
  upsert: (traceId: string, span: TraceSpan) => void;
  event: (traceId: string, event: TraceEvent) => void;
  hydrate: (sessionId: string, snapshot: ExecutionTrace, recoverLive?:boolean) => void;
}

export const useExecutionTraceStore = create<TraceState>((set, get) => ({
  traces: {}, activeBySession: {},
  ensure: (sessionId, traceId, activate=true) => {
    if (get().traces[traceId]) {
      if(activate&&get().activeBySession[sessionId]!==traceId)set(s=>({activeBySession:{...s.activeBySession,[sessionId]:traceId}}));
      return;
    }
    set(s => {
      // A bounded cache; historical traces are recoverable from the database.
      const entries = Object.entries(s.traces);
      const expired = entries.filter(([, t]) => t.completed).slice(0, Math.max(0, entries.length - 19));
      const traces = { ...s.traces };
      expired.forEach(([id]) => delete traces[id]);
      traces[traceId] = { version: 1, trace_id: traceId, sessionId, origin_epoch_ms: 0,
        duration_ms: 0, completed: false, spans: [], events: [], clientSpans: [], metrics: {} };
      return { traces, ...(activate?{activeBySession: { ...s.activeBySession, [sessionId]: traceId }}:{}) };
    });
  },
  patch: (id, patch) => set(s => s.traces[id] ? { traces: { ...s.traces, [id]: { ...s.traces[id], ...patch } } } : s),
  upsert: (id, span) => set(s => {
    const trace = s.traces[id]; if (!trace) return s;
    if (trace.completed && span.status==='running') return s;
    const index = trace.spans.findIndex(p => p.id === span.id);
    if (index < 0 && trace.spans.length >= 2000) return s;
    const spans = [...trace.spans];
    if (index >= 0) spans[index] = { ...span, attributes: { ...spans[index].attributes, ...span.attributes } };
    else spans.push(span);
    return { traces: { ...s.traces, [id]: { ...trace, spans,
      completed: span.id === "request" && span.status !== "running" ? true : trace.completed } } };
  }),
  event: (id, event) => set(s => {
    const trace = s.traces[id]; if (!trace || trace.events.some(e => e.id === event.id)) return s;
    return { traces: { ...s.traces, [id]: { ...trace, events: [...trace.events.slice(-199), event] } } };
  }),
  hydrate: (sessionId, snapshot, recoverLive=false) => {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.spans)) return;
    get().ensure(sessionId, snapshot.trace_id, false);
    const current = get().traces[snapshot.trace_id];
    if (current.completed && !snapshot.completed) return;
    // Never overwrite a live stream or local paint measurements with stale DB data.
    if (current.spans.length && !snapshot.completed && !recoverLive) return;
    const recovered=recoverLive&&!snapshot.completed?[
      ...snapshot.spans.map(span=>{
        const latest=current.spans.find(s=>s.id===span.id);
        return latest&&latest.status!=='running'&&span.status==='running'?latest:span;
      }),...current.spans.filter(span=>!snapshot.spans.some(s=>s.id===span.id)),
    ]:snapshot.spans;
    get().patch(snapshot.trace_id, { ...snapshot, sessionId,
      duration_ms:Math.max(snapshot.duration_ms,current.duration_ms),
      spans: recovered.map(span => ({ ...span, attributes: {
        ...span.attributes, ...current.spans.find(s => s.id === span.id)?.attributes,
        ...(snapshot.client?.deliveries?.[span.id] ? {delivery: snapshot.client.deliveries[span.id]} : {}), } })),
      clientSpans: current.clientSpans.length ? current.clientSpans : snapshot.client?.spans ?? [],
      metrics: { ...snapshot.client?.metrics, ...current.metrics },
    });
  },
}));
