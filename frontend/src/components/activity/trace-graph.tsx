"use client";

import { memo,useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {readTraceViewState,saveTraceViewState} from '@/lib/trace-view-state';
import { Minus, Plus, Scan, LocateFixed } from 'lucide-react';
import { layoutTrace, nearestGraphNode, durationLabel,truncateGraphLabel } from '@/lib/trace-layout';
import type { TraceSpan } from '@/types/execution-trace';
import styles from './trace-studio.module.css';

export const TraceGraph=memo(function TraceGraph({ cacheKey,active, spans, selectedId, onSelect, follow, onPauseFollow, onResumeFollow, locateVersion }: {
  cacheKey:string;
  active: boolean;
  spans: TraceSpan[]; selectedId: string | null; onSelect: (id: string) => void;
  follow: boolean; onPauseFollow: () => void; onResumeFollow:()=>void; locateVersion: number;
}) {
  const layout = useMemo(() => active?layoutTrace(spans):{nodes:[],edges:[],height:300,minX:0,maxX:850,width:850}, [active,spans]);
  const [camera, setCamera] = useState(()=>readTraceViewState(cacheKey)?.graphCamera??{x:0,y:0,w:850});
  useLayoutEffect(()=>saveTraceViewState(cacheKey,{graphCamera:camera}),[cacheKey,camera]);
  const lastLocate=useRef(locateVersion);
  const [size, setSize] = useState({w:600,h:520});
  const stage = useRef<HTMLDivElement>(null), drag = useRef<{x:number;y:number;cx:number;cy:number} | null>(null);
  const graphElement=useRef<SVGSVGElement>(null);
  const focused = nearestGraphNode(selectedId, spans, layout.nodes);
  const map = new Map(layout.nodes.map(n => [n.id,n]));
  const scale = camera.w / Math.max(1,size.w), height = size.h * scale, overview = 100/scale < 64;
  const r = (overview?Math.min(5,35/scale):8)*scale;
  const labelStride=Math.max(1,Math.ceil(18*scale/100));
  const peers=new Map<number,number>();
  const last = layout.nodes.findLast(n => n.span.status === 'running') ?? layout.nodes.at(-1);
  const lastY=last?.y;
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if(entry.contentRect.width>0&&entry.contentRect.height>0)setSize({w:entry.contentRect.width,h:entry.contentRect.height});
    });
    observer.observe(stage.current); return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    if (active && follow && lastY!==undefined) setCamera(c => ({...c,x:425-c.w/2,y:Math.max(0,lastY-size.h*c.w/size.w*.65)}));
  }, [active,follow, lastY, size.h, size.w]);
  useEffect(() => {
    if(lastLocate.current===locateVersion)return;
    lastLocate.current=locateVersion;
    if (locateVersion && focused) {
      const n = layout.nodes.find(n=>n.id===focused);
      if(n) setCamera(c=>({...c,x:n.x-c.w/2,y:Math.max(0,n.y-150*scale)}));
    }
  // A deliberate locate action, not every clock tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateVersion]);
  useEffect(()=>{
    const svg=graphElement.current;if(!active||!svg)return;
    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();onPauseFollow();
      setCamera(c=>{
        if(e.ctrlKey||e.metaKey){const w=Math.max(350,Math.min(Math.max(5000,layout.width+200),c.w*(e.deltaY>0?1.1:.9)));return {...c,x:c.x+(c.w-w)/2,y:c.y+(c.w-w)*size.h/size.w/2,w};}
        return {...c,y:c.y+e.deltaY*c.w/size.w};
      });
    };
    svg.addEventListener('wheel',onWheel,{passive:false});return()=>svg.removeEventListener('wheel',onWheel);
  },[active,onPauseFollow,size.h,size.w,layout.width]);
  function zoom(factor:number){onPauseFollow();setCamera(c=>{const w=Math.max(350,Math.min(Math.max(5000,layout.width+200),c.w*factor));return {...c,x:c.x+(c.w-w)/2,y:c.y+(c.w-w)*size.h/size.w/2,w};});}
  function fit(){onPauseFollow();const w=Math.max(layout.width+100,layout.height/size.h*size.w);setCamera({x:(layout.minX+layout.maxX)/2-w/2,y:0,w});}
  function color(s:TraceSpan){return s.status==='error'?'var(--trace-red)':s.status==='cancelled'?'var(--text-tertiary)':s.kind==='model'?'var(--trace-purple)':s.kind==='tool'?'var(--trace-green)':s.kind==='frontend'||s.kind==='sse'?'var(--trace-blue)':'var(--text-tertiary)';}
  const viewBox=`${camera.x} ${camera.y} ${camera.w} ${height}`;
  if(!active)return null;
  return <div className={styles.graph} data-testid="trace-graph">
    <div className={styles.graphToolbar}>
      <select aria-label="选择调用节点" value={focused??''} onChange={e=>{if(e.target.value){onPauseFollow();onSelect(e.target.value);const n=map.get(e.target.value);if(n)setCamera(c=>({...c,x:n.x-c.w/2,y:Math.max(0,n.y-160*scale)}));}}}>
        <option value="">选择节点查看详情</option>{layout.nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
      </select>
      <div className={styles.actions}><button aria-label="缩小" onClick={()=>zoom(1.25)}><Minus/></button><button aria-label="放大" onClick={()=>zoom(.8)}><Plus/></button><button aria-label="适应全图" onClick={fit}><Scan/></button><button aria-label="定位当前执行节点" onClick={()=>{onResumeFollow();if(last)setCamera({x:0,y:Math.max(0,last.y-size.h*850/size.w*.65),w:850});}}><LocateFixed/></button></div>
    </div>
    <div className={styles.graphStage} ref={stage}>
      <svg ref={graphElement} viewBox={viewBox} role="img" aria-label="真实调用节点图：串行调用、并发调度分支、结果汇合和明确修正" className={styles.graphSvg}
        onPointerDown={e=>{if((e.target as Element).closest('[data-node]'))return;e.preventDefault();onPauseFollow();drag.current={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{const d=drag.current;if(d)setCamera(c=>({...c,x:d.cx-(e.clientX-d.x)*scale,y:d.cy-(e.clientY-d.y)*scale}));}}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
        {layout.edges.map((edge,i)=>{const a=map.get(edge.from)!,b=map.get(edge.to)!;return <path key={`${edge.from}:${edge.to}:${i}`} className={edge.retry?styles.retryEdge:styles.edge} vectorEffect="non-scaling-stroke" d={`M${a.x},${a.y} L${a.x},${(a.y+b.y)/2} L${b.x},${b.y}`}/>;})}
        {layout.nodes.map(n=>{
          const selected=focused===n.id, left=n.x<425, c=color(n.span), running=n.span.status==='running';
          const queued=n.span.kind==='tool'&&spans.some(s=>s.parentId===n.id&&s.service==='工具排队'&&s.status==='running');
          const peer=peers.get(n.y)??0;peers.set(n.y,peer+1);
          const showLabel=!overview||selected||n.id===last?.id||(Math.round((n.y-60)/100)%labelStride===0&&peer%Math.max(1,Math.ceil(140*scale/330))===0);
          return <g key={n.id} data-node={n.id} role="button" tabIndex={0} aria-label={`${n.label} ${durationLabel(n.span.durationMs)} ${running?'执行中':n.span.status==='error'?'失败':'已结束'}`} onClick={()=>onSelect(n.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(n.id);}}} className={styles.graphNode}>
            <title>{n.label} · {n.span.status} · {durationLabel(n.span.durationMs)}</title>
            <circle cx={n.x} cy={n.y} r={r+10*scale} fill="transparent"/>
            <circle className={styles.graphFocusRing} cx={n.x} cy={n.y} r={r+8*scale} fill="none" stroke="var(--trace-blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
            {selected&&<circle cx={n.x} cy={n.y} r={r+5*scale} fill="var(--data-accent-soft)"/>}
            <circle cx={n.x} cy={n.y} r={r} fill="var(--surface-primary)" stroke={c} strokeWidth={selected?2.5:1.5} vectorEffect="non-scaling-stroke"/>
            <circle cx={n.x} cy={n.y} r={(overview?2:3)*scale} fill={c}/>
            {showLabel&&<text className={styles.graphLabel} x={overview?n.x+(left?-14:14)*scale:n.x} y={n.y+(overview?4:25)*scale} textAnchor={overview?(left?'end':'start'):'middle'} fontSize={(overview?11:12)*scale}>{truncateGraphLabel(n.label,Math.min(220,330/scale-18))}</text>}
            {!overview&&<text className={styles.graphDuration} x={n.x} y={n.y+42*scale} textAnchor="middle" fontSize={11*scale}>{running?(queued?'排队中':n.span.attributes.checkpoint==='join'?'等待汇合':'执行中'):n.span.status==='ok'?'已完成':n.span.status==='error'?'失败':n.span.status==='cancelled'?'已取消':'未完整采集'} · {durationLabel(n.span.durationMs)}</text>}
          </g>;
        })}
      </svg>
      <button aria-label="调用链缩略图，点击定位" className={styles.minimap} onClick={e=>{onPauseFollow();const matrix=e.currentTarget.querySelector('svg')?.getScreenCTM();if(matrix){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());setCamera(c=>({...c,x:p.x-c.w/2,y:Math.max(0,p.y-height/2)}));}}}>
        <svg viewBox={`${layout.minX-80} 0 ${layout.width+160} ${layout.height}`} aria-hidden="true">{layout.edges.map((e,i)=>{const a=map.get(e.from)!,b=map.get(e.to)!;return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text-tertiary)" strokeWidth="5"/>;})}{layout.nodes.map(n=><circle key={n.id} cx={n.x} cy={n.y} r="13" fill={color(n.span)}/>)}<rect x={Math.max(layout.minX-80,camera.x)} y={camera.y} width={Math.min(layout.width+160,camera.w)} height={height} fill="var(--data-accent-soft)" fillOpacity=".5" stroke="var(--trace-blue)" strokeWidth="8"/></svg>
      </button>
    </div>
    <div className={styles.legend}><span>● 用户 / 检查点</span><span style={{color:'var(--trace-purple)'}}>● 模型</span><span style={{color:'var(--trace-green)'}}>● 工具 / SQL</span><span>虚线：失败后修正</span></div>
  </div>;
});
