"""Tests for runtime channel manager behavior."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.channels.base import BaseChannel
from app.channels.bus.events import OutboundMessage
from app.channels.bus.queue import MessageBus
from app.channels.config import ChannelsConfig
from app.channels.manager import ChannelManager

pytestmark = pytest.mark.asyncio


class DummyChannel(BaseChannel):
    name = "dummy"
    display_name = "Dummy"

    def __init__(self, config: Any, bus: MessageBus):
        super().__init__(config, bus)
        self.sent: list[OutboundMessage] = []
        self.sent_event = asyncio.Event()
        self.stop_event = asyncio.Event()

    async def start(self) -> None:
        self._running = True
        await self.stop_event.wait()

    async def stop(self) -> None:
        self._running = False
        self.stop_event.set()

    async def send(self, msg: OutboundMessage) -> None:
        self.sent.append(msg)
        self.sent_event.set()


async def test_dynamic_channel_starts_outbound_dispatcher():
    bus = MessageBus()
    manager = ChannelManager(ChannelsConfig(), bus)

    await manager.start_all()
    assert manager._dispatch_task is None

    channel = DummyChannel({}, bus)
    await manager.add_and_start_channel("dummy", channel)

    assert manager._dispatch_task is not None
    assert not manager._dispatch_task.done()

    await bus.publish_outbound(
        OutboundMessage(channel="dummy", chat_id="chat-1", content="hello")
    )

    await asyncio.wait_for(channel.sent_event.wait(), timeout=1)
    assert channel.sent[0].chat_id == "chat-1"
    assert channel.sent[0].content == "hello"

    await manager.stop_all()
