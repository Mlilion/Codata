"""Execution trace APIs, separate from the generation control protocol."""
from __future__ import annotations

import time
from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, FiniteFloat
from sqlalchemy import select
from app.dependencies import SessionFactoryDep, StreamManagerDep
from app.models.message import Message


class TraceRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handle(request: Request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                # NaN is rejected by FiniteFloat, but echoing NaN (or private
                # input) in FastAPI's default error body makes JSONResponse fail.
                errors = [{key: item[key] for key in ('type', 'loc', 'msg') if key in item}
                          for item in exc.errors()]
                return JSONResponse(status_code=422, content={'detail': errors})
        return handle


router = APIRouter(route_class=TraceRoute)


@router.get('/chat/clock')
async def trace_clock() -> dict:
    """Client uses the minimum RTT sample; RTT/2 is an error bound, not a SLA."""
    return {'server_epoch_ms': time.time() * 1000}


class ClientTraceSpan(BaseModel):
    id: str = Field(min_length=1, max_length=100, pattern=r'^client-')
    name: str = Field(max_length=100)
    service: str = Field(pattern=r'^(前端|SSE)$')
    kind: str = Field(pattern=r'^(frontend|sse)$')
    startMs: FiniteFloat = Field(ge=-60_000, le=86_400_000)
    durationMs: FiniteFloat = Field(ge=0, le=86_400_000)
    status: str = Field(pattern=r'^(ok|error|incomplete)$')
    attributes: dict[str, str | FiniteFloat | bool | None] = Field(default_factory=dict, max_length=20)


class ClientDelivery(BaseModel):
    event_seq: int = Field(ge=0)
    event_type: str = Field(max_length=80)
    received_epoch_ms: FiniteFloat
    server_queue_ms: FiniteFloat | None = None
    parse_ms: FiniteFloat = Field(ge=0)
    handler_ms: FiniteFloat = Field(ge=0)
    encode_ms: FiniteFloat | None = None
    transfer_estimate_ms: FiniteFloat | None = None
    clock_uncertainty_ms: FiniteFloat | None = None
    clock: str = Field(max_length=180)


class ClientTraceReport(BaseModel):
    session_id: str = Field(max_length=100)
    spans: list[ClientTraceSpan] = Field(max_length=200)
    metrics: dict[str, FiniteFloat] = Field(default_factory=dict, max_length=20)
    deliveries: dict[str, ClientDelivery] = Field(default_factory=dict, max_length=2000)


async def _trace_message(db, trace_id: str, session_id: str):
    return (await db.execute(select(Message).where(
        Message.session_id == session_id,
        Message.data['trace_id'].as_string() == trace_id,
    ).order_by(Message.time_created.desc(), Message.id.desc()))).scalars().first()


@router.get('/chat/trace/{trace_id}')
async def get_execution_trace(trace_id: str, session_id: str, sm: StreamManagerDep, session_factory: SessionFactoryDep) -> dict:
    job = sm.get_job(trace_id)
    if job is not None and job.session_id == session_id:
        snap = job.trace.snapshot()
        if hasattr(job, '_client_trace'):
            snap['client'] = job._client_trace
        return snap
    async with session_factory() as db:
        row = await _trace_message(db, trace_id, session_id)
        if row and row.data.get('execution_trace'):
            return row.data['execution_trace']
    raise HTTPException(status_code=404, detail='Trace not collected or session does not match')


@router.post('/chat/trace/{trace_id}/client')
async def save_client_trace(trace_id: str, body: ClientTraceReport, sm: StreamManagerDep, session_factory: SessionFactoryDep) -> dict:
    from app.streaming.trace import safe_value
    # Frontend observations are kept separate; they cannot overwrite server spans.
    report = safe_value({'spans': [s.model_dump() for s in body.spans], 'metrics': body.metrics})
    # safe_value limits ordinary lists to 30: this dedicated bounded list keeps all 200.
    report['spans'] = [safe_value(s.model_dump()) for s in body.spans]
    report['deliveries'] = {key[:120]: value.model_dump(exclude_none=True) for key,value in body.deliveries.items()}
    async with session_factory() as db:
        async with db.begin():
            row = await _trace_message(db, trace_id, body.session_id)
            if row is None or not row.data.get('execution_trace'):
                raise HTTPException(status_code=409, detail='Server trace is not persisted yet')
            snapshot = {**row.data['execution_trace'], 'client': report}
            row.data = {**row.data, 'execution_trace': snapshot}
    job = sm.get_job(trace_id)
    if job is not None and job.session_id == body.session_id:
        job._client_trace = report
    return {'saved': True, 'spans': len(report['spans'])}
