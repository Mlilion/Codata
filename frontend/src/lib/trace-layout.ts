import type { TraceSpan } from '@/types/execution-trace';

export function durationLabel(ms: number): string {
  if (ms > 0 && ms < 1) return `${Math.round(ms * 1000)} µs`;
  return ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Queue time is deliberately excluded from concurrency detection. */
export function executionGroups(tools: TraceSpan[], all: TraceSpan[]): TraceSpan[][] {
  const executionOf = (tool:TraceSpan) => all.find(s => s.parentId === tool.id && s.name === '工具执行') ?? tool;
  const ordered = [...tools].sort((a,b) => executionOf(a).startMs - executionOf(b).startMs);
  const groups: TraceSpan[][] = [];
  const recorded=new Set<string>();
  let until = -Infinity;
  for (const tool of ordered) {
    const dispatchGroup=tool.attributes.parallel_group_id;
    if(typeof dispatchGroup==='string'){
      if(!recorded.has(dispatchGroup)){groups.push(ordered.filter(s=>s.attributes.parallel_group_id===dispatchGroup));recorded.add(dispatchGroup);}
      until=-Infinity;
      continue;
    }
    const execution = executionOf(tool);
    if (tool.attributes.concurrent === true && groups.length && execution.startMs < until
        && groups.at(-1)!.every(s => s.attributes.concurrent === true)) {
      groups.at(-1)!.push(tool);
    } else groups.push([tool]);
    until = Math.max(execution.startMs + execution.durationMs, groups.at(-1)!.length > 1 ? until : -Infinity);
  }
  return groups;
}

export interface GraphNode { id: string; span: TraceSpan; label: string; x: number; y: number }
export interface GraphEdge { from: string; to: string; retry?: boolean }

export function graphLabel(span:TraceSpan):string{
  const input=span.attributes.input;
  if(span.kind==='tool'&&input&&typeof input==='object'&&'title' in input&&typeof input.title==='string'&&input.title.trim())return input.title;
  return span.name;
}

export function truncateGraphLabel(label:string,maxWidth:number):string{
  let width=0,result='';
  for(const char of label){const next=/[\u0000-\u00ff]/.test(char)?6.5:12;if(width+next>maxWidth-12)return result+'…';result+=char;width+=next;}
  return result;
}

export function layoutTrace(spans: TraceSpan[]): { nodes: GraphNode[]; edges: GraphEdge[]; height: number; minX:number; maxX:number; width:number } {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], used = new Set<string>();
  let previous: string[] = [], row = 0;
  const append = (items: TraceSpan[], labels?: string[]) => {
    if (!items.length) return;
    const ids: string[] = [];
    items.forEach((span,i) => {
      const x = 425 + (i-(items.length-1)/2)*330;
      nodes.push({ id: span.id, span, label: labels?.[i] ?? graphLabel(span), x, y: 60 + row*100 });
      previous.forEach(from => edges.push({ from, to: span.id }));
      ids.push(span.id); used.add(span.id);
    });
    previous = ids; row++;
  };
  const sorted = spans.filter(s=>s.kind!=='sse'&&s.kind!=='frontend'&&s.service!=='SSE'&&s.service!=='前端').sort((a,b) => a.startMs-b.startMs);
  append(sorted.filter(s => s.kind === 'request'));
  const models = sorted.filter(s => s.kind === 'model');
  const rootPhases=sorted.filter(s=>s.kind==='phase'&&s.parentId==='request'&&s.attributes.group_kind!=='parallel');
  rootPhases.filter(s=>s.startMs<(models[0]?.startMs??Infinity)).forEach(s=>append([s]));
  const tools = sorted.filter(s => s.kind === 'tool');
  const appendTools=(group:TraceSpan[])=>{
    const groupId=group[0]?.attributes.parallel_group_id;
    const parallel=typeof groupId==='string'&&group.every(s=>s.attributes.parallel_group_id===groupId)
      ?spans.find(s=>s.id===groupId&&s.attributes.group_kind==='parallel'):undefined;
    if(parallel)append([parallel],['并行分支']);
    append(group);
    const join=parallel&&spans.find(s=>s.id===parallel.attributes.join_span_id);
    if(join)append([join],['结果汇合']);
  };
  models.forEach((model, index) => {
    append([model], [`${model.attributes.source_session_id?'子智能体 · ':''}模型调用 ${index + 1}`]);
    rootPhases.filter(s=>s.startMs>=model.startMs&&s.startMs<(models[index+1]?.startMs??Infinity)).forEach(s=>append([s]));
    for (const group of executionGroups(tools.filter(t => t.attributes.producer_span_id === model.id), spans)) appendTools(group);
  });
  for (const group of executionGroups(tools.filter(t => !used.has(t.id)), spans)) appendTools(group);
  // This is the Agent execution graph. SSE transport and browser rendering
  // stay in the complete waterfall and span details, not the graph's spine.
  // Retry edges are only marked when the collector explicitly recorded a retry.
  for (const node of nodes) {
    const retryOf = node.span.attributes.retry_of;
    if (typeof retryOf === 'string' && used.has(retryOf)) {
      const producer=node.span.attributes.producer_span_id;
      const paths=typeof producer==='string'&&nodes.some(n=>n.id===producer&&n.span.kind==='model')&&producer!==retryOf
        ?[[retryOf,producer],[producer,node.id]]:[[retryOf,node.id]];
      for(const [from,to] of paths){
        // Replace the ordinary edge; do not leave a solid line behind the dash.
        for(let i=edges.length-1;i>=0;i--)if(edges[i].from===from&&edges[i].to===to)edges.splice(i,1);
        edges.push({from,to,retry:true});
      }
    }
  }
  const minX=Math.min(0,...nodes.map(n=>n.x)),maxX=Math.max(850,...nodes.map(n=>n.x));
  return { nodes, edges, height: Math.max(300, row*100 + 80), minX, maxX, width:maxX-minX };
}

export function nearestGraphNode(selectedId: string | null, spans: TraceSpan[], nodes: GraphNode[]): string | null {
  if(selectedId&&nodes.some(n=>n.id===selectedId))return selectedId;
  const owner=relatedToolSpans(selectedId,spans).find(s=>nodes.some(n=>n.id===s.id));
  if(owner)return owner.id;
  let key = selectedId;
  const seen = new Set<string>();
  while (key && !seen.has(key)) {
    if (nodes.some(n => n.id === key)) return key;
    const anchor=spans.find(s=>s.id===key)?.attributes.__view_graph_anchor;
    if(typeof anchor==='string'&&nodes.some(n=>n.id===anchor))return anchor;
    seen.add(key); key = spans.find(s => s.id === key)?.parentId ?? null;
  }
  return null;
}

/** Resolve by recorded IDs/parentage, never by matching tool names. */
export function relatedToolSpans(selectedId:string|null,spans:TraceSpan[]):TraceSpan[]{
  let current=spans.find(s=>s.id===selectedId);
  const seen=new Set<string>();
  while(current&&!seen.has(current.id)){
    seen.add(current.id);
    if(current.kind==='tool')return [current];
    const call=current.attributes.call_id;
    if(typeof call==='string'){
      const owner=spans.find(s=>s.kind==='tool'&&s.attributes.call_id===call
        &&s.attributes.source_session_id===current?.attributes.source_session_id);
      if(owner)return [owner];
    }
    if(current.kind==='model')return spans.filter(s=>s.kind==='tool'&&s.attributes.producer_span_id===current!.id);
    if(current.attributes.group_kind==='parallel'||Array.isArray(current.attributes.group_members)){
      const members=current.attributes.group_members;
      const tools=spans.filter(s=>s.kind==='tool'&&(s.attributes.parallel_group_id===current!.id
        ||(Array.isArray(members)&&members.includes(s.id))));
      if(tools.length)return tools.sort((a,b)=>a.startMs-b.startMs);
    }
    if(current.kind==='request')break;
    current=spans.find(s=>s.id===current?.parentId);
  }
  return [];
}
