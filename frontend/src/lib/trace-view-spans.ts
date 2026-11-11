import type {TraceSpan} from '@/types/execution-trace';

/** The original viewer estimates paths only for a single rooted tree.
 * A view-only envelope associates independently collected server/browser roots.
 * Recorded durations and IDs are untouched; raw parentage stays inspectable.
 */
export function traceViewSpans(spans:TraceSpan[],options:{clientStartMs?:number;endToEndMs?:number}={}):TraceSpan[]{
  if(!spans.length)return [];
  const ids=new Set(spans.map(s=>s.id));
  const roots=spans.filter(s=>!s.parentId||!ids.has(s.parentId));
  const earliest=Math.min(...spans.map(s=>s.startMs));
  const first=Math.min(0,earliest);
  const last=Math.max(...spans.map(s=>s.startMs+s.durationMs));
  const browser=spans.some(s=>s.kind==='frontend'||s.kind==='sse');
  const missing=spans.some(s=>s.parentId&&!ids.has(s.parentId));
  const needEnvelope=browser||missing||roots.length!==1||roots.some(s=>s.startMs>earliest||s.startMs+s.durationMs<last);
  const finalPaint=spans.find(s=>s.id==='client-final-paint'&&s.status==='ok');
  const browserStart=options.clientStartMs??(finalPaint&&options.endToEndMs!==undefined
    ?finalPaint.startMs+finalPaint.durationMs-options.endToEndMs:undefined);
  const origin=Math.min(first,browserStart??0);
  const id='view-request-envelope';
  const shifted=spans.map(span=>{
    const external=span.kind==='frontend'||span.kind==='sse';
    const parent=needEnvelope&&(external||!span.parentId||!ids.has(span.parentId))?id:span.parentId;
    return {...span,startMs:span.startMs-origin,parentId:parent,
      attributes:parent!==span.parentId?{...span.attributes,__recorded_parent_id:span.parentId??null}:span.attributes};
  });
  if(!needEnvelope)return shifted;
  const anchor=spans.find(s=>s.kind==='request');
  const status=spans.some(s=>s.status==='running')?'running':anchor?.status??'ok';
  const envelope:TraceSpan={id,parentId:null,name:'全链路观测范围',service:'请求',kind:'phase',startMs:0,
    durationMs:Math.max(...shifted.map(s=>s.startMs+s.durationMs)),status,
    attributes:{__view_derived:true,__view_graph_anchor:anchor?.id,
      timing_basis:'view container calculated from collected interval bounds; not an extra model/tool invocation',
      recorded_spans:spans.length,axis_shift_ms:-origin,
      ...(options.endToEndMs===undefined?{}:{measured_browser_end_to_end_ms:options.endToEndMs})}};
  return [envelope,...shifted];
}
