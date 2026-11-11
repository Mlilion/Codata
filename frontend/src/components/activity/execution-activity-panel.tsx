"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ChartNoAxesGantt, GitBranch, Info, List, Maximize2, Minimize2, Radio, X, Play, Pause, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { api } from '@/lib/api';
import { displaySpans } from '@/lib/execution-trace';
import { durationLabel,layoutTrace,relatedToolSpans } from '@/lib/trace-layout';
import { replaySpans, replayBoundaries, nextReplayTime } from '@/lib/trace-replay';
import {readTraceViewState,saveTraceViewState} from '@/lib/trace-view-state';
import { useExecutionTraceStore } from '@/stores/execution-trace-store';
import type { ActivityData } from '@/stores/activity-store';
import type { ExecutionTrace, LiveTrace, TraceSpan } from '@/types/execution-trace';
import type { ToolPart } from '@/types/message';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ToolCallRow } from './tool-call-row';
import { TraceWaterfall } from './trace-waterfall';
import { TraceGraph } from './trace-graph';
import styles from './trace-studio.module.css';

type View = 'tools' | 'waterfall' | 'graph';
const statusText: Record<TraceSpan['status'],string> = {running:'执行中',ok:'已完成',error:'失败',cancelled:'已取消',incomplete:'未完整采集'};
const dump = (value:unknown) => { const text=JSON.stringify(value,null,2)??'未采集';return text.length>30000?text.slice(0,30000)+'\n… 内容已截断':text; };

export function ExecutionActivityPanel({ data, onClose, showClose = true, reasoning }: {
  data: ActivityData; onClose: () => void; showClose?: boolean; reasoning?: ReactNode;
}) {
  const traceId = data.traceId ?? data.executionTrace?.trace_id;
  const cacheKey=traceId??data.sourceKey??'pending';
  const initial=useRef(readTraceViewState(cacheKey));
  const trace = useExecutionTraceStore(s => traceId ? s.traces[traceId] : undefined);
  const [view,setView] = useState<View>(initial.current?.view??'tools');
  const [selected,setSelected] = useState<string|null>(initial.current?.selected??null), [expanded,setExpanded]=useState(initial.current?.expanded??false);
  const [follow,setFollow]=useState(initial.current?.follow??true), [clockHelp,setClockHelp]=useState(initial.current?.clockHelp??false);
  const [tab,setTab]=useState<'summary'|'io'|'events'>(initial.current?.tab??'summary'), [now,setNow]=useState(0);
  const [locate,setLocate]=useState(initial.current?.locate??0), [loading,setLoading]=useState(false), [loadError,setLoadError]=useState('');
  const [replayMs,setReplayMs]=useState<number|null>(initial.current?.replayMs??null),[playing,setPlaying]=useState(initial.current?.playing??false),[speed,setSpeed]=useState(initial.current?.speed??1);
  const waterfallState = useRef<Record<string,unknown>>(initial.current?.waterfall??{});
  const [expandedToolIds,setExpandedToolIds]=useState<string[]>(initial.current?.expandedToolIds??[]);
  const [toolTargets,setToolTargets]=useState<string[]>(initial.current?.toolTargets??[]);
  const toolsSection=useRef<HTMLElement>(null),toolElements=useRef(new Map<string,HTMLDivElement>());
  useLayoutEffect(()=>saveTraceViewState(cacheKey,{view,selected,expanded,follow,clockHelp,tab,locate,replayMs,playing,speed,expandedToolIds,toolTargets,waterfall:waterfallState.current}),
    [cacheKey,view,selected,expanded,follow,clockHelp,tab,locate,replayMs,playing,speed,expandedToolIds,toolTargets]);
  useEffect(()=>{
    if(initial.current?.view)return;
    const saved=localStorage.getItem('codata-activity-view');
    if(saved==='tools'||saved==='waterfall'||saved==='graph')setView(saved);
  },[]);
  useEffect(()=>{
    setLoadError('');
    if(!traceId||!data.sessionId)return;
    const store=useExecutionTraceStore.getState();
    if(data.executionTrace){store.hydrate(data.sessionId,data.executionTrace);return;}
    if(store.traces[traceId]?.spans.length)return;
    let alive=true;setLoading(true);
    api.get<ExecutionTrace>(`/api/chat/trace/${encodeURIComponent(traceId)}?session_id=${encodeURIComponent(data.sessionId)}`)
      .then(snapshot=>{if(alive)useExecutionTraceStore.getState().hydrate(data.sessionId!,snapshot);})
      .catch(()=>{if(alive)setLoadError('未找到该次执行的计时记录，旧会话可能尚未采集。');})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[traceId,data.sessionId,data.executionTrace]);
  const running=!!trace&&!trace.completed;
  useEffect(()=>{
    setNow(performance.now());
    if(!running)return;
    const timer=setInterval(()=>setNow(performance.now()),250);
    return()=>clearInterval(timer);
  },[traceId,running]);
  const completed=trace?.completed;
  // Collection remains per-event. Heavy views consume at most four live
  // snapshots/second, with immediate final/history flushes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frameTrace=useMemo(()=>trace,[traceId,now,completed,completed?trace?.spans:null,completed?trace?.clientSpans:null]);
  const completeSpans=useMemo(()=>frameTrace?displaySpans(frameTrace,now):[],[frameTrace,now]);
  const spans=useMemo(()=>replayMs===null?completeSpans:replaySpans(completeSpans,replayMs),[completeSpans,replayMs]);
  const replayTotal=useMemo(()=>Math.max(0,...completeSpans.map(s=>s.startMs+s.durationMs)),[completeSpans]);
  const boundaries=useMemo(()=>replayBoundaries(view==='graph'?layoutTrace(completeSpans).nodes.map(n=>n.span):view==='tools'?completeSpans.filter(s=>s.kind==='tool'):completeSpans),[completeSpans,view]);
  const replaying=replayMs!==null;
  const emptyMessage=replaying?'回放开始，等待首个阶段…':loading?'正在读取计时记录…':loadError||'该历史记录未采集细分计时。新执行会实时记录，缺失项不会补造。';
  useEffect(()=>{
    if(!playing||replayMs===null)return;
    let last=performance.now();
    const timer=setInterval(()=>{const at=performance.now(),delta=(at-last)*speed;last=at;
      setReplayMs(current=>{if(current===null)return null;const next=Math.min(replayTotal,current+delta);if(next>=replayTotal)setPlaying(false);return next;});
    },100);
    return()=>clearInterval(timer);
  // Cursor advances inside the interval; seeking should not recreate it per frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,speed,replayTotal,replaying]);
  const chosen=spans.find(s=>s.id===selected);
  const related=useMemo(()=>relatedToolSpans(selected,spans),[selected,spans]);
  const scrollToTool=useCallback(()=>{
    const target=toolElements.current.get(toolTargets[0]),section=toolsSection.current;
    if(target&&section)section.scrollTo({top:section.scrollTop+target.getBoundingClientRect().top-section.getBoundingClientRect().top-12,behavior:'smooth'});
  },[toolTargets]);
  useEffect(()=>{
    if(view!=='tools'||!toolTargets.length)return;
    const frame=requestAnimationFrame(scrollToTool);
    return()=>cancelAnimationFrame(frame);
  },[view,toolTargets,expanded,scrollToTool]);
  const toolSpans=spans.filter(s=>s.kind==='tool');
  const firstToken=spans.find(s=>s.name==='请求发出 → 首 token'&&s.status==='ok');
  const rootSpan=spans.find(s=>s.kind==='request');
  const modelCount=spans.filter(s=>s.kind==='model').length;
  const elapsed=replayMs??trace?.metrics.end_to_end_ms??(trace?.completed?trace.duration_ms:rootSpan?.durationMs);
  const allTools=useMemo<ToolPart[]>(()=>[...data.toolParts,...completeSpans.filter(s=>s.kind==='tool'&&s.attributes.source_session_id&&s.attributes.source_session_id!==data.sessionId).map(s=>({
    type:'tool' as const,tool:s.name,call_id:String(s.attributes.call_id??s.id),state:{
      status:s.status==='running'?'running' as const:s.status==='error'||s.status==='cancelled'?'error' as const:'completed' as const,
      input:(s.attributes.input??{}) as Record<string,unknown>,output:String(s.attributes.output_preview||s.attributes.error_preview||''),
      title:`子智能体 · ${s.name}`,time_start:null,time_end:null,time_compacted:null,
      metadata:{__trace_span_id:s.id,source_session_id:s.attributes.source_session_id,trace_output_preview:true},
    },
  }))],[data.toolParts,data.sessionId,completeSpans]);
  const visibleTools=useMemo(()=>!replaying?allTools:allTools.flatMap(tool=>{
    const span=spans.find(s=>s.kind==='tool'&&(tool.state.metadata?.__trace_span_id?s.id===tool.state.metadata.__trace_span_id:s.attributes.call_id===tool.call_id&&!s.attributes.source_session_id));if(!span)return [];
    return [{...tool,state:{...tool.state,status:span.status==='running'?'running' as const:span.status==='error'||span.status==='cancelled'?'error' as const:'completed' as const,
      output:span.status==='running'?null:tool.state.output,metadata:span.status==='running'?(tool.state.metadata?.__trace_span_id?{__trace_span_id:tool.state.metadata.__trace_span_id,source_session_id:tool.state.metadata.source_session_id,trace_output_preview:true}:null):tool.state.metadata}}];
  }),[allTools,replaying,spans]);
  const inspectorData=useMemo(()=>({...data,toolParts:visibleTools}),[data,visibleTools]);
  function changeView(v:View){
    setView(v);localStorage.setItem('codata-activity-view',v);
    if(v==='tools'){
      const targets=relatedToolSpans(selected,spans).map(s=>s.id);
      setToolTargets(targets);
      if(targets.length)setExpandedToolIds(previous=>[...new Set([...previous,...targets])]);
    }
  }
  const choose=useCallback((id:string)=>{if(selected!==id)setTab('summary');setSelected(id);setFollow(false);},[selected]);
  const pauseFollow=useCallback(()=>setFollow(false),[]);
  const resumeFollow=useCallback(()=>setFollow(true),[]);
  function locateIn(v:View){changeView(v);if(v!=='tools')setLocate(n=>n+1);}
  const panel=<div className={styles.studio} data-testid="execution-activity-panel" data-trace-id={traceId??''}>
    <header className={styles.heading}><div><h2>活动</h2><p>工具调用、执行链路与端到端性能</p></div><div className={styles.actions}>
      <span className={styles.state}>{replaying?(playing?'历史回放中':'历史回放已暂停'):trace?(trace.completed?(rootSpan?.status==='error'?'执行失败':rootSpan?.status==='cancelled'?'已取消':'执行完成'):'执行中 · 实时更新'):'调用记录'}</span>
      {trace?.completed&&completeSpans.length>0&&<button aria-label={replaying?'退出历史回放':'回放历史执行'} data-active={replaying} onClick={()=>{if(replaying){setReplayMs(null);setPlaying(false);}else{setReplayMs(0);setPlaying(true);setFollow(true);setSelected(null);waterfallState.current={};}}}><Play/>回放</button>}
      <button onClick={()=>setExpanded(!expanded)} aria-label={expanded?'退出展开':'展开活动面板'}>{expanded?<Minimize2/>:<Maximize2/>}</button>
      {showClose&&<button aria-label="关闭活动面板" onClick={()=>{setExpanded(false);onClose();}}><X/></button>}
    </div></header>
    <div className={styles.tabs}>
      <div role="tablist" aria-label="活动视图" className={styles.tabgroup}>
        {([{id:'tools',label:'工具调用',Icon:List},{id:'waterfall',label:'性能瀑布',Icon:ChartNoAxesGantt},{id:'graph',label:'调用节点',Icon:GitBranch}] as const).map(({id,label,Icon})=><button key={id} id={`trace-tab-${id}`} role="tab" aria-selected={view===id} aria-controls={`trace-view-${id}`} data-active={view===id} onClick={()=>changeView(id)}><Icon/>{label}</button>)}
      </div>
      <button data-active={follow} onClick={()=>setFollow(!follow)} title="跟随最新时间范围和活动节点；暂停跟随不影响计时采集"><Radio/>跟随最新</button>
    </div>
    <div className={styles.metrics}>
      <span>{replaying?'回放位置':'总耗时'} <b>{elapsed===undefined?'未采集':durationLabel(elapsed)}</b></span>
      <span title="SDK 请求发出到首个有效内容、推理或工具 delta；不同于用户看到文本">模型首 token <b>{firstToken?durationLabel(firstToken.durationMs):replaying&&completeSpans.some(s=>s.name==='请求发出 → 首 token'&&s.status==='ok')?'等待中':trace?.completed?'未采集':'等待中'}</b></span>
      <span>首文本上屏 <b>{replaying&&!spans.some(s=>s.id==='client-first-paint'&&s.status==='ok')&&trace?.metrics.first_text_paint_ms!==undefined?'等待中':trace?.metrics.first_text_paint_ms!==undefined?durationLabel(trace.metrics.first_text_paint_ms):trace?.completed?'未采集':'等待中'}</b></span>
      <span>工具执行中 <b>{spans.filter(s=>s.name==='工具执行'&&s.status==='running').length}</b></span>
      <button className={styles.infoButton} aria-expanded={clockHelp} onClick={()=>setClockHelp(!clockHelp)}><Info/>计时口径</button>
    </div>
    {replaying&&<div className={styles.replayToolbar} data-testid="trace-replay-controls">
      <div className={styles.replayActions}><button aria-label={playing?'暂停回放':'播放回放'} onClick={()=>{if((replayMs??0)>=replayTotal)setReplayMs(0);setPlaying(!playing);}}>{playing?<Pause/>:<Play/>}{playing?'暂停':'播放'}</button>
        <button aria-label="从头回放" onClick={()=>{setReplayMs(0);setPlaying(false);setFollow(true);setSelected(null);waterfallState.current={};}}><RotateCcw/></button>
        <button aria-label="上一个记录事件" onClick={()=>{setPlaying(false);setReplayMs(nextReplayTime(boundaries,replayMs??0,-1));}}><SkipBack/></button>
        <button aria-label="下一个记录事件" onClick={()=>{setPlaying(false);setReplayMs(nextReplayTime(boundaries,replayMs??0,1));}}><SkipForward/></button>
        <label>倍速 <select aria-label="回放倍速" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,2,4,8].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
        <button onClick={()=>{setReplayMs(null);setPlaying(false);}}>查看完整记录</button>
      </div>
      <div className={styles.replayTrack}><input aria-label="回放进度" type="range" min={0} max={replayTotal||1} step="any" value={replayMs??0} onChange={e=>{setPlaying(false);setReplayMs(Number(e.target.value));}}/><span>{durationLabel(replayMs??0)} / {durationLabel(replayTotal)}</span></div>
      <p>按真实跨度时间回放 · 不重新调用模型或工具</p>
    </div>}
    {clockHelp&&<div className={styles.clockHelp}>总耗时优先使用点击发送到最终交接绘制的浏览器单调时钟；其他端或后台页未采到绘制时显示服务端耗时。首 token 包含提供商排队、网络与预填充，无法从客户端单独拆分。模型总跨度含本地流消费，等待提供商分块的累计时间在详情中单列。工具排队与执行分别测量；SQL 驱动的执行可能包含接收缓冲，连接获取包含连接池等待、建连与预检。SSE 从发送准备到浏览器回调的间隔含 ASGI、传输与回调排队，不能当作纯网络延迟；跨端校准误差至少 RTT/2。语义服务跨度在各自单调时钟内测量，位置对齐误差见详情。双帧回调近似绘制。并行子项不能直接相加；历史缺失项显示“未采集”。</div>}
    <div className={`${styles.body} ${chosen?styles.withDetail:''}`}>
      <div className={styles.views}>
        <section ref={toolsSection} role="tabpanel" id="trace-view-tools" aria-labelledby="trace-tab-tools" hidden={view!=='tools'} className={styles.view}>
          <div className={styles.toolsSummary}>{visibleTools.length} 次工具调用 · {replaying?'历史回放':trace?'真实执行记录':'历史调用记录'}</div>
          <div className={styles.toolList}>{visibleTools.map(tool=>{
            const span=toolSpans.find(s=>tool.state.metadata?.__trace_span_id?s.id===tool.state.metadata.__trace_span_id:s.attributes.call_id===tool.call_id&&!s.attributes.source_session_id);
            const queue=span&&spans.find(s=>s.parentId===span.id&&s.service==='工具排队');
            const execution=span&&spans.find(s=>s.parentId===span.id&&s.name==='工具执行');
            const cardId=span?.id??String(tool.state.metadata?.__trace_span_id??tool.call_id);
            return <div key={cardId} data-tool-span={cardId} ref={element=>{if(element)toolElements.current.set(cardId,element);else toolElements.current.delete(cardId);}}><ToolCallRow tool={tool}
              expanded={expandedToolIds.includes(cardId)} onExpandedChange={open=>setExpandedToolIds(previous=>open?[...new Set([...previous,cardId])]:previous.filter(id=>id!==cardId))}
              onExpansionComplete={open=>{if(open&&view==='tools'&&toolTargets.includes(cardId))scrollToTool();}}
              highlighted={related.some(item=>item.id===cardId)} timing={span?{durationMs:span.durationMs,queueMs:queue?.durationMs,executionMs:execution?.durationMs,queued:queue?.status==='running',status:span.status}:undefined} onInspect={span?()=>choose(span.id):undefined}/></div>;
          })}</div>
          {!visibleTools.length&&<div className={styles.empty}>{replaying?'等待回放中的工具调用…':trace&&!trace.completed?'正在准备模型与工具调用…':'此轮未调用工具'}</div>}
          {!replaying&&view==='tools'&&reasoning}
        </section>
        <section role="tabpanel" id="trace-view-waterfall" aria-labelledby="trace-tab-waterfall" hidden={view!=='waterfall'} className={styles.view}>
          {spans.length?<TraceWaterfall key={traceId} cacheKey={cacheKey} spans={spans} active={view==='waterfall'} selectedId={selected} onSelect={choose} follow={follow} onPauseFollow={pauseFollow} savedView={waterfallState} locateVersion={locate}/>:<div className={styles.empty}>{emptyMessage}</div>}
        </section>
        <section role="tabpanel" id="trace-view-graph" aria-labelledby="trace-tab-graph" hidden={view!=='graph'} className={`${styles.view} ${styles.nodeView}`}>
          {spans.length?<TraceGraph key={traceId} cacheKey={cacheKey} active={view==='graph'} spans={spans} selectedId={selected} onSelect={choose} follow={follow} onPauseFollow={pauseFollow} onResumeFollow={resumeFollow} locateVersion={locate}/>:<div className={styles.empty}>{emptyMessage}</div>}
        </section>
      </div>
      {chosen&&<TraceInspector span={chosen} spans={spans} trace={frameTrace} data={inspectorData} tab={tab} setTab={setTab} onSelect={choose} onClose={()=>setSelected(null)} onLocate={locateIn}/>}
    </div>
    <footer className={styles.footer}><span><Activity/>{spans.filter(s=>!s.attributes.__view_derived).length} spans{spans.some(s=>s.attributes.__view_derived)?' + 1 范围容器':''} · {modelCount} 次模型 · {toolSpans.length} 次工具{trace?.dropped_spans?` · ${trace.dropped_spans} 项超限未记录`:''}</span><span title={traceId}>{traceId??'历史记录 · 未采集 trace'}</span></footer>
  </div>;
  return expanded?<Dialog open onOpenChange={open=>setExpanded(open)}><DialogContent className="h-[94vh] w-[96vw] max-w-none gap-0 overflow-hidden rounded-xl p-0 [&>button:last-child]:hidden"><DialogTitle className="sr-only">活动与性能分析</DialogTitle><DialogDescription className="sr-only">工具调用、性能瀑布和调用节点三种视图</DialogDescription>{panel}</DialogContent></Dialog>:panel;
}

function TraceInspector({span,spans,trace,data,tab,setTab,onSelect,onClose,onLocate}:{
  span:TraceSpan;spans:TraceSpan[];trace:LiveTrace|undefined;data:ActivityData;
  tab:'summary'|'io'|'events';setTab:(tab:'summary'|'io'|'events')=>void;
  onSelect:(id:string)=>void;onClose:()=>void;onLocate:(v:View)=>void;
}) {
  const inspectorElement=useRef<HTMLElement>(null);
  useEffect(()=>{inspectorElement.current?.scrollTo({top:0});},[span.id,tab]);
  const children=spans.filter(s=>s.parentId===span.id).sort((a,b)=>a.startMs-b.startMs);
  const queue=children.find(s=>s.service==='工具排队'),execution=children.find(s=>s.name==='工具执行');
  let owner:TraceSpan|undefined=span;
  const seen=new Set<string>();
  while(owner&&owner.kind!=='tool'&&!seen.has(owner.id)){seen.add(owner.id);owner=spans.find(s=>s.id===owner?.parentId);}
  const tool=owner&&data.toolParts.find(t=>t.state.metadata?.__trace_span_id?t.state.metadata.__trace_span_id===owner?.id:t.call_id===owner?.attributes.call_id&&!owner?.attributes.source_session_id);
  const sourceSession=span.attributes.source_session_id??owner?.attributes.source_session_id;
  const related=relatedToolSpans(span.id,spans);
  const derived=span.attributes.__view_derived===true;
  const recordedParent=Object.prototype.hasOwnProperty.call(span.attributes,'__recorded_parent_id')?span.attributes.__recorded_parent_id:span.parentId;
  const events=trace?.events.filter(e=>e.id===Number((span.attributes.delivery as {event_seq?:number}|undefined)?.event_seq))??[];
  return <aside ref={inspectorElement} className={styles.inspector} aria-label="节点详情" data-testid="trace-inspector">
    <div className={styles.detailHead}><strong>{span.name}</strong><button aria-label="关闭节点详情" onClick={onClose}><X/></button></div>
    <div className={styles.detailKind}>{span.service} · {span.id}{derived?' · 视图范围（非额外调用）':''}</div>
    <div className={styles.detailTabs}>{([{id:'summary',label:'耗时'},{id:'io',label:'输入 / 输出'},{id:'events',label:'事件'}] as const).map(x=><button key={x.id} data-active={tab===x.id} onClick={()=>setTab(x.id)}>{x.label}</button>)}</div>
    <div className={styles.detailBody}>
      {tab==='summary'&&<><dl><dt>状态</dt><dd data-status={span.status}>{queue?.status==='running'?'排队中':statusText[span.status]}</dd><dt>已耗时</dt><dd>{durationLabel(span.durationMs)}{span.status==='running'?' · 持续更新':''}</dd><dt>起止</dt><dd>+{durationLabel(span.startMs)} → {span.status==='running'?'尚未结束':'+'+durationLabel(span.startMs+span.durationMs)}</dd><dt>服务</dt><dd>{span.service}</dd>{span.kind==='tool'&&<><dt>排队 / 执行</dt><dd>{queue?durationLabel(queue.durationMs):'未采集'} / {execution?durationLabel(execution.durationMs):queue?.status==='running'?'未开始':'未采集'}</dd></>}</dl>
        <h3>分阶段耗时</h3>{children.length?children.map(s=><button key={s.id} className={styles.phase} onClick={()=>onSelect(s.id)}><span>{s.name}{s.status==='running'?' · 执行中':''}</span><span>{durationLabel(s.durationMs)}</span></button>):<p className={styles.muted}>叶子节点，无下级跨度。</p>}
        <h3>采集依据</h3><pre>{dump(span.attributes)}</pre><p className={styles.evidence}>服务内耗时来自单调时钟。跨进程起始位置可能存在对齐误差；未测量的数据不会显示为 0。</p></>}
      {tab==='io'&&<>{owner?<><h3>输入参数</h3><pre>{dump(tool?.state.input??owner.attributes.input??'未采集')}</pre><h3>输出结果</h3><pre>{tool?.state.output||String(owner.attributes.output_preview||owner.attributes.error_preview||(owner.status==='running'?'等待本步骤返回，不提前展示结果。':'未采集输出，请查看关联工具调用。'))}</pre>{tool?.state.metadata&&<><h3>结构化结果与 SQL</h3><pre>{dump(tool.state.metadata)}</pre></>}</>:<><p className={styles.muted}>本节点无工具入参；模型节点仅展示调用元数据。</p><pre>{dump(span.attributes)}</pre></>}</>}
      {tab==='events'&&<><dl><dt>Trace ID</dt><dd>{trace?.trace_id??'未采集'}</dd><dt>{derived?'View ID':'Span ID'}</dt><dd>{span.id}</dd>{span.attributes.call_id!==undefined&&<><dt>调用 ID</dt><dd>{String(span.attributes.call_id)}</dd></>}<dt>Parent ID</dt><dd>{String(recordedParent??'—')}</dd></dl><h3>节点事件</h3>{derived?<p className={styles.evidence}>此项由采集跨度的起止计算，只用于组织全链路视图，不是独立执行或独立 SSE 事件。</p>:<><p className={styles.event}>+{durationLabel(span.startMs)} · span.started</p><p className={styles.event}>{span.status==='running'?'等待结束事件…':`+${durationLabel(span.startMs+span.durationMs)} · span.${span.status==='error'?'failed':span.status==='cancelled'?'cancelled':'completed'}`}</p></>}<h3>SSE 到达与处理</h3><pre>{dump(span.attributes.delivery??(span.status==='running'&&trace?.completed?'回放尚未收到此步骤的结束事件。':'历史记录未保留此节点的 SSE 细节'))}</pre>{events.map(e=><p key={e.id} className={styles.event}>事件 #{e.id} · {e.type}<br/>解析 {durationLabel(e.parseMs)} · 同步处理 {durationLabel(e.handlerMs)}</p>)}<p className={styles.evidence}>事件以 event ID 去重；断线后重放。SSE 同步处理不包含异步任务完成时间，最终内容交接另行计时。</p></>}
    </div>
    <div className={styles.detailActions}>{span.parentId&&<button onClick={()=>onSelect(span.parentId!)}>上级节点</button>}<button onClick={()=>onLocate('tools')} title={related.length?'展开并滚动到关联的工具调用':'本阶段无直接工具关联，返回工具列表'}>{related.length?'定位工具调用':'工具调用'}</button><button onClick={()=>onLocate('waterfall')}>定位瀑布</button><button onClick={()=>onLocate('graph')}>定位节点</button>{typeof sourceSession==='string'&&sourceSession!==data.sessionId&&<a className={styles.sourceLink} href={`/c/${encodeURIComponent(sourceSession)}`} target="_blank" rel="noopener noreferrer">完整子会话</a>}</div>
  </aside>;
}
