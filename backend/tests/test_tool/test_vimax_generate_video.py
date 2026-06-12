"""Tests for the ViMax video generation tool."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.schemas.agent import AgentInfo
from app.models.vimax_task_run import ViMaxTaskRun
from app.tool.builtin.vimax_generate_video import ViMaxGenerateVideoTool
from app.tool.context import ToolContext


def _ctx() -> ToolContext:
    ctx = ToolContext(
        session_id="test-session",
        message_id="test-message",
        agent=AgentInfo(name="test", description="", mode="primary"),
        call_id="test-call",
    )
    ctx._provider_id = "openrouter"  # type: ignore[attr-defined]
    ctx._model_id = "google/gemini-test"  # type: ignore[attr-defined]
    return ctx


class _Settings:
    vimax_runtime_url = "http://127.0.0.1:8765"
    vimax_config_path = "/tmp/vimax.yaml"
    vimax_google_api_key = ""
    vimax_yunwu_api_key = ""
    vimax_media_api_key = ""
    vimax_media_base_url = ""
    vimax_media_preset = ""
    vimax_image_model = ""
    vimax_video_model = ""
    vimax_video_t2v_model = ""
    vimax_video_ff2v_model = ""
    vimax_video_flf2v_model = ""
    vimax_media_api_version = ""
    vimax_image_api_version = ""
    vimax_video_api_version = ""
    google_api_key = "google-key"
    openrouter_api_key = "openrouter-key"
    custom_endpoints = "[]"


class _YunwuSettings(_Settings):
    google_api_key = ""
    custom_endpoints = (
        '[{"id":"custom_yunwu","name":"Yunwu","base_url":"https://yunwu.ai/v1",'
        '"api_key":"yunwu-key","enabled":false}]'
    )


class _DataEyesSettings(_Settings):
    google_api_key = ""
    custom_endpoints = (
        '[{"id":"custom_dataeyes","name":"DataEyes","base_url":"https://cloud.dataeyes.ai/v1",'
        '"api_key":"dataeyes-key","enabled":false}]'
    )


class _MediaOverrideSettings(_Settings):
    vimax_media_api_key = "media-key"
    vimax_media_base_url = "https://yunwu.ai"
    vimax_media_api_version = "v1beta"
    vimax_video_api_version = "v1"


class _PresetSettings(_Settings):
    google_api_key = ""
    vimax_yunwu_api_key = "yunwu-key"


class _PresetVersionedBaseSettings(_PresetSettings):
    vimax_media_base_url = "https://yunwu.ai/v1"


class _ConfiguredDoubaoSettings(_PresetSettings):
    vimax_media_preset = "doubao"
    vimax_image_model = "doubao-seedream-custom"
    vimax_video_model = "doubao-seedance-custom-i2v"
    vimax_video_t2v_model = "doubao-seedance-custom-t2v"


class _Provider:
    id = "openrouter"


class _Registry:
    def resolve_model(self, model_id: str, provider_id: str | None = None):
        return (_Provider(), object())


class TestViMaxGenerateVideoTool:
    def test_validate_action_enum(self) -> None:
        tool = ViMaxGenerateVideoTool()
        error = tool.validate_args({"action": "unknown"})
        assert error is not None
        assert "must be one of" in error

    def test_build_submit_payload_injects_workcraft_keys(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "style": "cinematic",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["chat_model"]["init_args"]["api_key"] == "openrouter-key"
        assert overrides["chat_model"]["init_args"]["base_url"] == "https://openrouter.ai/api/v1"
        assert overrides["image_generator"]["init_args"]["api_key"] == "google-key"
        assert overrides["video_generator"]["init_args"]["api_key"] == "google-key"

    def test_build_submit_payload_uses_custom_endpoint_key_without_replacing_media_classes(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_YunwuSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert "class_path" not in overrides["image_generator"]
        assert "class_path" not in overrides["video_generator"]
        assert overrides["image_generator"]["init_args"]["api_key"] == "yunwu-key"
        assert overrides["video_generator"]["init_args"]["api_key"] == "yunwu-key"

    def test_build_submit_payload_can_inject_generic_media_endpoint_options(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_MediaOverrideSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        image_args = payload["config_overrides"]["image_generator"]["init_args"]
        video_args = payload["config_overrides"]["video_generator"]["init_args"]
        assert image_args["api_key"] == "media-key"
        assert image_args["base_url"] == "https://yunwu.ai"
        assert image_args["api_version"] == "v1beta"
        assert video_args["api_key"] == "media-key"
        assert video_args["base_url"] == "https://yunwu.ai"
        assert video_args["api_version"] == "v1"

    def test_build_submit_payload_can_keep_yaml_media_config(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_provider": "config",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert "image_generator" not in overrides
        assert "video_generator" not in overrides

    def test_build_submit_payload_maps_gemini_media_preset_to_vimax_generators(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_PresetSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "gemini",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorNanobananaYunwuAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "yunwu-key",
            "base_url": "https://yunwu.ai",
            "api_version": "v1beta",
            "model": "gemini-2.5-flash-image-preview",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorVeoYunwuAPI"
        assert overrides["video_generator"]["init_args"]["api_key"] == "yunwu-key"
        assert overrides["video_generator"]["init_args"]["base_url"] == "https://yunwu.ai"
        assert overrides["video_generator"]["init_args"]["api_version"] == "v1"
        assert overrides["video_generator"]["init_args"]["t2v_model"] == "veo3.1-components"

    def test_build_submit_payload_normalizes_gemini_media_preset_base_url(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_PresetVersionedBaseSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "gemini",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["init_args"]["base_url"] == "https://yunwu.ai"
        assert overrides["image_generator"]["init_args"]["api_version"] == "v1beta"
        assert overrides["video_generator"]["init_args"]["base_url"] == "https://yunwu.ai"
        assert overrides["video_generator"]["init_args"]["api_version"] == "v1"

    def test_build_submit_payload_maps_doubao_media_preset_to_vimax_generators(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_PresetSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "doubao",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorDoubaoSeedreamYunwuAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "yunwu-key",
            "model": "doubao-seedream-4-0-250828",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorDoubaoSeedanceYunwuAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "yunwu-key",
            "t2v_model": "doubao-seedance-1-0-lite-t2v-250428",
            "ff2v_model": "doubao-seedance-1-0-lite-i2v-250428",
            "flf2v_model": "doubao-seedance-1-0-lite-i2v-250428",
        }

    def test_build_submit_payload_maps_dataeyes_media_preset_to_vimax_generators(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_DataEyesSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "dataeyes",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorDoubaoSeedreamDataEyesAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "dataeyes-key",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "model": "doubao-seedream-4-0-250828",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorDoubaoSeedanceDataEyesAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "dataeyes-key",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "t2v_model": "doubao-seedance-1-0-lite-t2v-250428",
            "ff2v_model": "doubao-seedance-1-0-lite-i2v-250428",
            "flf2v_model": "doubao-seedance-1-0-lite-i2v-250428",
        }

    def test_build_submit_payload_rejects_dataeyes_media_preset_without_key(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "dataeyes",
                },
                _ctx(),
            )

        assert isinstance(payload, str)
        assert "requires a DataEyes-compatible media API key" in payload

    def test_build_submit_payload_maps_dataeyes_gemini_veo_media_preset_to_vimax_generators(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_DataEyesSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "dataeyes_gemini_veo",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorNanobananaDataEyesAPI"
        assert overrides["image_generator"]["init_args"] == {
            "api_key": "dataeyes-key",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1beta",
            "model": "gemini-2.5-flash-image",
        }
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorVeoDataEyesAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "dataeyes-key",
            "base_url": "https://cloud.dataeyes.ai",
            "api_version": "v1",
            "t2v_model": "veo-3.1-generate-preview",
            "ff2v_model": "veo-3.1-generate-preview",
            "flf2v_model": "veo-3.1-generate-preview",
        }

    def test_build_submit_payload_uses_saved_media_config_when_tool_omits_preset(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_ConfiguredDoubaoSettings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                },
                _ctx(),
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["image_generator"]["class_path"] == "tools.ImageGeneratorDoubaoSeedreamYunwuAPI"
        assert overrides["image_generator"]["init_args"]["model"] == "doubao-seedream-custom"
        assert overrides["video_generator"]["class_path"] == "tools.VideoGeneratorDoubaoSeedanceYunwuAPI"
        assert overrides["video_generator"]["init_args"] == {
            "api_key": "yunwu-key",
            "t2v_model": "doubao-seedance-custom-t2v",
            "ff2v_model": "doubao-seedance-custom-i2v",
            "flf2v_model": "doubao-seedance-custom-i2v",
        }

    def test_build_submit_payload_rejects_media_preset_without_yunwu_key(self) -> None:
        tool = ViMaxGenerateVideoTool()
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_preset": "doubao",
                },
                _ctx(),
            )

        assert isinstance(payload, str)
        assert "requires a Yunwu-compatible media API key" in payload

    def test_build_submit_payload_resolves_provider_from_registry_when_missing(self) -> None:
        tool = ViMaxGenerateVideoTool()
        ctx = _ctx()
        ctx._provider_id = ""  # type: ignore[attr-defined]
        ctx._app_state = {"provider_registry": _Registry()}  # type: ignore[attr-defined]
        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            payload = tool._build_submit_payload(
                {
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "media_provider": "config",
                },
                ctx,
            )

        assert isinstance(payload, dict)
        overrides = payload["config_overrides"]
        assert overrides["chat_model"]["init_args"]["api_key"] == "openrouter-key"
        assert overrides["chat_model"]["init_args"]["base_url"] == "https://openrouter.ai/api/v1"
        assert payload["metadata"]["workcraft"]["session_id"] == "test-session"
        assert payload["metadata"]["workcraft"]["message_id"] == "test-message"
        assert payload["metadata"]["workcraft"]["call_id"] == "test-call"

    @pytest.mark.asyncio
    async def test_completed_task_returns_video_attachment(self, tmp_path: Path) -> None:
        tool = ViMaxGenerateVideoTool()
        video_path = tmp_path / "final_video.mp4"
        video_path.write_bytes(b"fake mp4")

        result = await tool._status(
            _FakeClient(
                {
                    "task_id": "task-1",
                    "mode": "script2video",
                    "status": "completed",
                    "progress": 1.0,
                    "stage": "completed",
                    "message": "done",
                    "working_dir": str(tmp_path),
                    "final_video_path": str(video_path),
                }
            ),
            "http://runtime",
            "task-1",
        )

        assert result.success
        assert result.metadata["file_path"] == str(video_path.resolve())
        assert result.attachments
        assert result.attachments[0]["mime_type"] == "video/mp4"
        assert result.attachments[0]["path"] == str(video_path.resolve())

    @pytest.mark.asyncio
    async def test_resume_posts_to_existing_task_and_reinjects_payload(self) -> None:
        tool = ViMaxGenerateVideoTool()
        client = _FakeClient(
            {
                "task_id": "task-resume",
                "mode": "script2video",
                "status": "queued",
                "progress": 0.2,
                "stage": "resume_queued",
                "message": "Task resume queued",
                "working_dir": "/tmp/vimax/task-resume/work",
                "metadata": {"workcraft": {"session_id": "test-session"}},
            }
        )

        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            result = await tool._resume(
                client,
                "http://runtime",
                {
                    "task_id": "task-resume",
                    "mode": "script2video",
                    "script": "INT. TEST - DAY",
                    "wait": False,
                },
                _ctx(),
            )

        assert result.success
        assert client.posts[0][0] == "http://runtime/tasks/task-resume/resume"
        payload = client.posts[0][1]
        assert payload["script"] == "INT. TEST - DAY"
        assert payload["metadata"]["workcraft"]["resume_task_id"] == "task-resume"
        assert result.metadata["workcraft_context"]["session_id"] == "test-session"

    @pytest.mark.asyncio
    async def test_resume_without_task_id_uses_latest_session_tool_call(self) -> None:
        tool = ViMaxGenerateVideoTool()

        class _SessionFactory:
            def __init__(self) -> None:
                self.db = _FakeDB(
                    [
                        {
                            "type": "tool",
                            "tool": "vimax_generate_video",
                            "state": {
                                "input": {
                                    "mode": "script2video",
                                    "script": "INT. OLD - DAY",
                                    "wait": False,
                                    "action": "submit",
                                },
                                "metadata": {"task_id": "task-from-history"},
                            },
                        }
                    ]
                )

            def __call__(self) -> "_FakeDB":
                return self.db

        ctx = _ctx()
        ctx._app_state = {"session_factory": _SessionFactory()}  # type: ignore[attr-defined]

        client = _FakeClient(
            {
                "task_id": "task-from-history",
                "mode": "script2video",
                "status": "queued",
                "progress": 0.2,
                "stage": "resume_queued",
                "message": "Task resume queued",
                "working_dir": "/tmp/vimax/task-from-history/work",
            }
        )

        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            result = await tool._resume(client, "http://runtime", {"wait": False}, ctx)

        assert result.success
        assert client.posts[0][0] == "http://runtime/tasks/task-from-history/resume"
        assert client.posts[0][1]["metadata"]["workcraft"]["session_id"] == "test-session"

    @pytest.mark.asyncio
    async def test_resume_prefers_persisted_task_run_record(self, session_factory) -> None:
        tool = ViMaxGenerateVideoTool()
        async with session_factory() as db:
            async with db.begin():
                db.add(
                    ViMaxTaskRun(
                        session_id="test-session",
                        message_id="message-1",
                        call_id="call-1",
                        task_id="task-db",
                        tool_id="vimax_generate_video",
                        mode="script2video",
                        status="failed",
                        stage="failed",
                        working_dir="/tmp/vimax/task-db/work",
                        input_payload={
                            "mode": "script2video",
                            "script": "INT. DB - DAY",
                            "wait": False,
                            "action": "submit",
                        },
                        runtime_status={"task_id": "task-db", "status": "failed"},
                    )
                )

        ctx = _ctx()
        ctx._app_state = {"session_factory": session_factory}  # type: ignore[attr-defined]

        client = _FakeClient(
            {
                "task_id": "task-db",
                "mode": "script2video",
                "status": "queued",
                "progress": 0.2,
                "stage": "resume_queued",
                "message": "Task resume queued",
                "working_dir": "/tmp/vimax/task-db/work",
                "metadata": {"workcraft": {"session_id": "test-session"}},
            }
        )

        with patch("app.tool.builtin.vimax_generate_video.get_settings", return_value=_Settings()):
            result = await tool._resume(client, "http://runtime", {"wait": False}, ctx)

        assert result.success
        assert client.posts[0][0] == "http://runtime/tasks/task-db/resume"
        assert client.posts[0][1]["script"] == "INT. DB - DAY"
        assert client.posts[0][1]["metadata"]["workcraft"]["resume_task_id"] == "task-db"

    @pytest.mark.asyncio
    async def test_completed_task_returns_vimax_process_artifacts(self, tmp_path: Path) -> None:
        tool = ViMaxGenerateVideoTool()
        work_dir = tmp_path / "work"
        shot_dir = work_dir / "shots" / "0"
        portrait_dir = work_dir / "character_portraits" / "0_主角"
        shot_dir.mkdir(parents=True)
        portrait_dir.mkdir(parents=True)
        final_video = work_dir / "final_video.mp4"
        shot_video = shot_dir / "video.mp4"
        first_frame = shot_dir / "first_frame.png"
        portrait = portrait_dir / "front.png"
        storyboard = work_dir / "storyboard.json"
        for path in [final_video, shot_video, first_frame, portrait]:
            path.write_bytes(b"artifact")
        storyboard.write_text("{}", encoding="utf-8")

        result = await tool._status(
            _FakeClient(
                {
                    "task_id": "task-artifacts",
                    "mode": "script2video",
                    "status": "completed",
                    "progress": 1.0,
                    "stage": "completed",
                    "message": "done",
                    "working_dir": str(work_dir),
                    "final_video_path": str(final_video),
                }
            ),
            "http://runtime",
            "task-artifacts",
        )

        assert result.success
        artifact_index = result.metadata["vimax_artifacts"]
        assert artifact_index["counts"]["video"] == 2
        assert artifact_index["counts"]["image"] == 2
        assert artifact_index["counts"]["metadata"] == 1
        assert artifact_index["final_video"]["path"] == str(final_video.resolve())
        attachment_names = [item["name"] for item in result.attachments]
        assert attachment_names[:4] == [
            "final_video.mp4",
            "shots/0/video.mp4",
            "shots/0/first_frame.png",
            "character_portraits/0_主角/front.png",
        ]
        assert all(not item["name"].endswith(".json") for item in result.attachments)
        assert "ViMax artifacts discovered" in result.output

    @pytest.mark.asyncio
    async def test_status_query_allows_running_task(self) -> None:
        tool = ViMaxGenerateVideoTool()

        result = await tool._status(
            _FakeClient(
                {
                    "task_id": "task-running",
                    "mode": "script2video",
                    "status": "running",
                    "progress": 0.5,
                    "stage": "rendering",
                    "message": "rendering scenes",
                }
            ),
            "http://runtime",
            "task-running",
        )

        assert result.success
        assert result.metadata["status"] == "running"
        assert not result.attachments

    @pytest.mark.asyncio
    async def test_failed_task_output_prioritizes_runtime_error_message(self) -> None:
        tool = ViMaxGenerateVideoTool()

        result = await tool._status(
            _FakeClient(
                {
                    "task_id": "task-failed",
                    "mode": "script2video",
                    "status": "failed",
                    "progress": 0.82,
                    "stage": "failed",
                    "message": (
                        "Doubao Seedance API returned HTTP 503: "
                        "分组 default 下模型 doubao-seedance-1-0-lite-i2v-250428 无可用渠道（distributor） "
                        "[new_api_error]"
                    ),
                    "metadata": {
                        "progress": {
                            "steps": [
                                {
                                    "key": "render_shots",
                                    "title": "渲染镜头",
                                    "status": "running",
                                    "progress": 0.5,
                                    "message": "生成视频片段",
                                }
                            ]
                        }
                    },
                }
            ),
            "http://runtime",
            "task-failed",
        )

        assert not result.success
        assert result.metadata["status"] == "failed"
        assert "无可用渠道" in (result.error or "")
        assert "new_api_error" in (result.error or "")
        assert result.error is not None
        assert result.error.index("无可用渠道") < result.error.index("vimax_steps")

    @pytest.mark.asyncio
    async def test_wait_timeout_returns_error_for_running_task(self) -> None:
        tool = ViMaxGenerateVideoTool()
        work_dir = Path("/tmp/nonexistent-vimax-work-dir")

        result = await tool._wait_for_completion(
            _FakeClient(
                {
                    "task_id": "task-running",
                    "mode": "script2video",
                    "status": "running",
                    "progress": 0.5,
                    "stage": "rendering",
                    "message": "rendering scenes",
                    "working_dir": str(work_dir),
                }
            ),
            "http://runtime",
            "task-running",
            _ctx(),
            max_wait_seconds=0,
            poll_interval_seconds=1,
        )

        assert not result.success
        assert result.metadata["status"] == "running"
        assert result.metadata["blocking_error"] is True
        assert "did not finish" in (result.error or "")

    @pytest.mark.asyncio
    async def test_wait_completed_without_video_file_returns_error(self, tmp_path: Path) -> None:
        tool = ViMaxGenerateVideoTool()
        first_frame = tmp_path / "first_frame.png"
        first_frame.write_bytes(b"frame")

        result = await tool._wait_for_completion(
            _FakeClient(
                {
                    "task_id": "task-no-file",
                    "mode": "script2video",
                    "status": "completed",
                    "progress": 1.0,
                    "stage": "completed",
                    "message": "done",
                    "working_dir": str(tmp_path),
                    "final_video_path": str(tmp_path / "missing.mp4"),
                }
            ),
            "http://runtime",
            "task-no-file",
            _ctx(),
            max_wait_seconds=0,
            poll_interval_seconds=1,
        )

        assert not result.success
        assert result.metadata["status"] == "completed"
        assert result.metadata["blocking_error"] is True
        assert result.attachments[0]["path"] == str(first_frame.resolve())
        assert "final_video_path is missing" in (result.error or "")


class _FakeResponse:
    def __init__(self, data: dict):
        self._data = data
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._data


class _FakeClient:
    def __init__(self, data: dict):
        self._data = data
        self.posts: list[tuple[str, dict]] = []

    async def get(self, url: str) -> _FakeResponse:
        return _FakeResponse(self._data)

    async def post(self, url: str, json: dict | None = None) -> _FakeResponse:
        self.posts.append((url, json or {}))
        return _FakeResponse(self._data)


class _FakeDB:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    async def __aenter__(self) -> "_FakeDB":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def execute(self, _stmt):
        class _Result:
            def __init__(self, rows: list[dict]):
                self._rows = rows

            def scalars(self):
                class _Scalars:
                    def __init__(self, rows: list[dict]):
                        self._rows = rows

                    def all(self):
                        return [type("PartObj", (), {"data": row})() for row in self._rows]

                return _Scalars(self._rows)

        return _Result(self._rows)
