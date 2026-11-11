export interface TraceSpan {
  id: string;
  parentId?: string | null;
  name: string;
  service: string;
  kind: "request" | "phase" | "model" | "tool" | "frontend" | "sse";
  startMs: number;
  durationMs: number;
  status: "running" | "ok" | "error" | "cancelled" | "incomplete";
  attributes: Record<string, unknown>;
}

export interface ExecutionTrace {
  version: number;
  trace_id: string;
  origin_epoch_ms: number;
  duration_ms: number;
  completed: boolean;
  dropped_spans?: number;
  spans: TraceSpan[];
  client?: { spans: TraceSpan[]; metrics: Record<string, number>; deliveries?: Record<string, Record<string, unknown>> };
}

export interface TraceTiming {
  receivedEpochMs: number;
  receivedPerfMs: number;
  parseMs: number;
  handlerMs: number;
}

export interface TraceEvent {
  id: number;
  type: string;
  receivedEpochMs: number;
  parseMs: number;
  handlerMs: number;
}

export interface LiveTrace extends ExecutionTrace {
  sessionId: string;
  events: TraceEvent[];
  receivedPerfMs?: number;
  receivedServerMs?: number;
  clientStartPerfMs?: number;
  clientStartEpochMs?: number;
  offsetMs?: number;
  uncertaintyMs?: number;
  clientSpans: TraceSpan[];
  metrics: Record<string, number>;
  toolReceipts?: Record<string, number>;
}
