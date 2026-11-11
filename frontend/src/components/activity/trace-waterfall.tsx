"use client";

import { memo,useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { TraceSpan } from '@/types/execution-trace';
import {saveTraceViewState} from '@/lib/trace-view-state';
import {defaultCollapsedCalls,expandSpanAncestors} from '@/lib/trace-waterfall-state';

type ViewState = Record<string, unknown>;
interface WaterfallElement extends HTMLElement {
  spans: unknown[];
  durationMs: number;
  viewState: ViewState;
  ready: Promise<void>;
}
let loading: Promise<void> | undefined;
function loadViewer() {
  if (customElements.get('viz-waterfall')) return Promise.resolve();
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module'; script.src = '/vendor/1.0.59/request-waterfall.js';
    script.onload = () => { customElements.whenDefined('viz-waterfall').then(() => resolve()); };
    script.onerror = () => { loading = undefined; script.remove(); reject(new Error('瀑布组件加载失败')); };
    document.head.append(script);
  });
  return loading;
}

export const TraceWaterfall=memo(function TraceWaterfall({ cacheKey,spans, active, selectedId, onSelect, follow, onPauseFollow, savedView, locateVersion = 0 }: {
  cacheKey:string;
  spans: TraceSpan[]; active: boolean; selectedId: string | null; onSelect: (id: string) => void;
  follow: boolean; onPauseFollow: () => void; savedView: MutableRefObject<ViewState>;
  locateVersion?: number;
}) {
  const host = useRef<HTMLDivElement>(null), viewer = useRef<WaterfallElement | null>(null);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const callbacks = useRef({ onSelect, onPauseFollow, selectedId }); callbacks.current = { onSelect, onPauseFollow, selectedId };
  const latest=useRef({selectedId,follow,spans,active});latest.current={selectedId,follow,spans,active};
  const syncing = useRef(false), version = useRef(0), lastLocate = useRef(0);
  const restored=useRef(false);
  const knownCallGroups=useRef(new Set<string>());
  const interacting=useRef(false),appliedSpans=useRef<TraceSpan[]|null>(null);
  const nativeSelection=useRef<string|null>(null);
  const [interactionVersion,setInteractionVersion]=useState(0);
  useEffect(() => {
    let disposed = false;
    const knownGroups=knownCallGroups.current;
    let removeGestureBridge:(()=>void)|undefined;
    loadViewer().then(() => {
      if (disposed || !host.current) return;
      const el = document.createElement('viz-waterfall') as WaterfallElement;
      el.id = 'codata-request-waterfall';
      el.setAttribute('title', '调用性能');
      el.setAttribute('description', '真实采集 · 服务端单调时钟；跨端对齐误差见节点详情');
      el.addEventListener('viz-state-change', event => {
        const detail = (event as CustomEvent<{state: ViewState; selection?: {spanId: string}}>).detail;
        const selected=detail.selection?.spanId??null;
        const changed=selected!==nativeSelection.current;nativeSelection.current=selected;
        if (syncing.current) return;
        savedView.current = { ...detail.state, details: false };
        saveTraceViewState(cacheKey,{waterfall:savedView.current});
        if (selected&&(changed||detail.state.details===true)&&selected!==callbacks.current.selectedId)callbacks.current.onSelect(selected);
        if (detail.state.details) {
          syncing.current = true; el.viewState = { ...el.viewState, details: false }; syncing.current = false;
        }
      });
      el.addEventListener('pointerdown', () => callbacks.current.onPauseFollow());
      el.addEventListener('wheel', () => callbacks.current.onPauseFollow(), { passive: true });
      el.addEventListener('viz-error', event => setError((event as CustomEvent).detail.message));
      // Opening the shared inspector changes the track width after the first
      // click. Keep a genuine double-click anchored to its FIRST span even if
      // the second pointer lands in the newly opened inspector. Focus still
      // uses the original viewer's dblclick algorithm, not a replacement.
      let firstClick:{id:string;x:number;y:number;at:number}|null=null;
      let suppressNativeUntil=0;
      let releaseFrame=0;
      const releasePointer=()=>{if(!interacting.current)return;cancelAnimationFrame(releaseFrame);releaseFrame=requestAnimationFrame(()=>{interacting.current=false;setInteractionVersion(n=>n+1);});};
      const beginPointer=()=>{cancelAnimationFrame(releaseFrame);interacting.current=true;};
      const abortPointer=()=>{if(interacting.current){cancelAnimationFrame(releaseFrame);interacting.current=false;setInteractionVersion(n=>n+1);}};
      const clearClick=()=>{firstClick=null;};
      const clickCapture=(event:MouseEvent)=>{
        if(!latest.current.active||event.detail===0)return;
        const now=performance.now();
        if(firstClick&&now-firstClick.at<500&&Math.hypot(event.clientX-firstClick.x,event.clientY-firstClick.y)<5){
          const rows=el.shadowRoot?.querySelectorAll<HTMLElement>('[data-span-id]');
          const row=rows&&Array.from(rows).find(item=>item.dataset.spanId===firstClick!.id);
          if(row){
            event.preventDefault();event.stopImmediatePropagation();suppressNativeUntil=now+100;
            row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,composed:true,detail:2,clientX:event.clientX,clientY:event.clientY}));
          }
          firstClick=null;return;
        }
        const path=event.composedPath();
        const disclosure=path.some(item=>item instanceof Element&&item.classList.contains('wf-disclosure'));
        const row=path.find(item=>item instanceof Element&&item.hasAttribute('data-span-id')) as HTMLElement|undefined;
        firstClick=!disclosure&&row&&el.shadowRoot?.contains(row)?{id:row.dataset.spanId!,x:event.clientX,y:event.clientY,at:now}:null;
      };
      const doubleCapture=(event:MouseEvent)=>{if(event.isTrusted&&performance.now()<suppressNativeUntil)event.stopImmediatePropagation();};
      el.ownerDocument.addEventListener('click',clickCapture,true);
      el.ownerDocument.addEventListener('dblclick',doubleCapture,true);
      el.addEventListener('pointerdown',beginPointer,true);
      el.ownerDocument.addEventListener('pointerup',releasePointer,true);
      el.ownerDocument.addEventListener('pointercancel',releasePointer,true);
      el.ownerDocument.addEventListener('wheel',clearClick,{capture:true,passive:true});
      el.ownerDocument.defaultView?.addEventListener('blur',abortPointer);
      removeGestureBridge=()=>{cancelAnimationFrame(releaseFrame);interacting.current=false;el.ownerDocument.removeEventListener('click',clickCapture,true);el.ownerDocument.removeEventListener('dblclick',doubleCapture,true);el.ownerDocument.removeEventListener('pointerup',releasePointer,true);el.ownerDocument.removeEventListener('pointercancel',releasePointer,true);el.ownerDocument.removeEventListener('wheel',clearClick,true);el.ownerDocument.defaultView?.removeEventListener('blur',abortPointer);};
      host.current.append(el); viewer.current = el; setError(''); setLoaded(true);
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true;removeGestureBridge?.();viewer.current?.remove(); viewer.current = null;restored.current=false;knownGroups.clear();appliedSpans.current=null; };
  }, [savedView,cacheKey]);

  useEffect(() => {
    const el = viewer.current;
    if (!el || !loaded || !active||interacting.current||appliedSpans.current===spans) return;
    appliedSpans.current=spans;
    const update = ++version.current;
    const duration = Math.max(1, ...spans.map(s => s.startMs + s.durationMs));
    syncing.current=true;
    el.spans = spans.map(s => ({ ...s,
      name: s.name + (s.status === 'running' ? ' · 执行中' : s.status === 'cancelled' ? ' · 已取消' : ''),
      status: s.status === 'error' ? 'error' : s.status === 'incomplete' || s.status === 'cancelled' ? 'warning' : 'ok',
      attributes: Object.fromEntries(Object.entries(s.attributes).map(([k,v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v ?? '未采集'])),
    }));
    el.durationMs = duration;
    void el.ready.then(async () => {
      if (update !== version.current) return;
      const state={...el.viewState,...(!restored.current?savedView.current:{})};
      const collapsed=defaultCollapsedCalls(spans,Array.isArray(state.collapsed)?state.collapsed:[],knownCallGroups.current,
        !restored.current&&Array.isArray(savedView.current.collapsed));
      el.viewState = { ...state, collapsed, selectedSpanId: latest.current.selectedId, details: false,
        ...(latest.current.follow ? { startMs: 0, endMs: duration } : {}) };
      restored.current=true;
      savedView.current={...el.viewState,details:false};
      saveTraceViewState(cacheKey,{waterfall:savedView.current});
      syncing.current = false;
    });
  }, [spans, active, loaded, savedView,interactionVersion,cacheKey]);
  useEffect(()=>{
    const el=viewer.current;if(!el||!active||!loaded)return;
    void el.ready.then(()=>{
      if(viewer.current!==el||!latest.current.active)return;
      if(el.viewState.selectedSpanId!==latest.current.selectedId){syncing.current=true;el.viewState={...el.viewState,selectedSpanId:latest.current.selectedId,details:false};syncing.current=false;}
    });
  },[selectedId,active,loaded]);
  useEffect(()=>{
    const el=viewer.current;if(!el||!active||!loaded||!follow)return;
    void el.ready.then(()=>{
      if(viewer.current!==el||!latest.current.follow)return;
      const duration=Math.max(1,...latest.current.spans.map(s=>s.startMs+s.durationMs));
      syncing.current=true;el.viewState={...el.viewState,startMs:0,endMs:duration,details:false};syncing.current=false;
    });
  },[follow,active,loaded]);
  useEffect(()=>{
    const el=viewer.current;if(!el||!active||!loaded||locateVersion===lastLocate.current)return;
    lastLocate.current=locateVersion;
    void el.ready.then(async()=>{
      const state=el.viewState;
      const collapsed=expandSpanAncestors(latest.current.spans,Array.isArray(state.collapsed)?state.collapsed:[],latest.current.selectedId);
      syncing.current=true;el.viewState={...state,selectedSpanId:latest.current.selectedId,details:false,query:'',collapsed};syncing.current=false;
      savedView.current={...el.viewState,details:false};saveTraceViewState(cacheKey,{waterfall:savedView.current});
      await el.ready;
      const rows=el.shadowRoot?.querySelectorAll<HTMLElement>('[data-span-id]');
      const row=rows&&Array.from(rows).find(r=>r.dataset.spanId===latest.current.selectedId);
      const panel=host.current?.parentElement;
      if(row&&panel)panel.scrollTop+=row.getBoundingClientRect().top-panel.getBoundingClientRect().top-60;
    });
  },[locateVersion,active,loaded,savedView,cacheKey]);
  return <div>{error && <div role="alert">{error}</div>}<div ref={host} data-testid="trace-waterfall" /></div>;
});
