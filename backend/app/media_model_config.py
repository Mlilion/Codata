"""Shared media generation model defaults.

The current implementation applies these settings to ViMax. The shape is kept
tool-neutral so other media tools, such as baoyu_image_generate, can adopt the
same image model configuration later without introducing a second settings API.
"""

from __future__ import annotations

from typing import Any


DEFAULT_VIMAX_MEDIA_BASE_URL = "https://yunwu.ai"
DEFAULT_DATAEYES_MEDIA_BASE_URL = "https://cloud.dataeyes.ai"
DEFAULT_VIMAX_MEDIA_PRESET = "doubao"
PUBLIC_VIMAX_MEDIA_PRESETS = ("doubao",)

VIMAX_MEDIA_PRESETS: dict[str, dict[str, Any]] = {
    "gemini": {
        "id": "gemini",
        "label": "Gemini / Veo",
        "description": "Gemini image generation with Veo 3.1 Components video generation.",
        "image": {
            "model": "gemini-2.5-flash-image-preview",
            "api_version": "v1beta",
            "class_path": "tools.ImageGeneratorNanobananaYunwuAPI",
        },
        "video": {
            "model": "veo3.1-components",
            "api_version": "v1",
            "class_path": "tools.VideoGeneratorVeoYunwuAPI",
            "t2v_model": "veo3.1-components",
            "ff2v_model": "veo3.1-components",
            "flf2v_model": "veo3.1-components",
        },
    },
    "doubao": {
        "id": "doubao",
        "label": "Doubao Seedream / Seedance",
        "description": "Doubao Seedream image generation with Seedance video generation through Yunwu.",
        "image": {
            "model": "doubao-seedream-4-0-250828",
            "api_version": "",
            "class_path": "tools.ImageGeneratorDoubaoSeedreamYunwuAPI",
        },
        "video": {
            "model": "doubao-seedance-1-0-lite-i2v-250428",
            "api_version": "",
            "class_path": "tools.VideoGeneratorDoubaoSeedanceYunwuAPI",
            "t2v_model": "doubao-seedance-1-0-lite-t2v-250428",
            "ff2v_model": "doubao-seedance-1-0-lite-i2v-250428",
            "flf2v_model": "doubao-seedance-1-0-lite-i2v-250428",
        },
    },
    "dataeyes": {
        "id": "dataeyes",
        "label": "DataEyes Seedream / Seedance",
        "description": "Doubao Seedream and Seedance models through DataEyes.",
        "image": {
            "model": "doubao-seedream-4-0-250828",
            "api_version": "v1",
            "class_path": "tools.ImageGeneratorDoubaoSeedreamDataEyesAPI",
        },
        "video": {
            "model": "doubao-seedance-1-0-lite-i2v-250428",
            "api_version": "v1",
            "class_path": "tools.VideoGeneratorDoubaoSeedanceDataEyesAPI",
            "t2v_model": "doubao-seedance-1-0-lite-t2v-250428",
            "ff2v_model": "doubao-seedance-1-0-lite-i2v-250428",
            "flf2v_model": "doubao-seedance-1-0-lite-i2v-250428",
        },
    },
    "dataeyes_gemini_veo": {
        "id": "dataeyes_gemini_veo",
        "label": "DataEyes Gemini / Veo",
        "description": "Gemini image generation and Veo video generation through DataEyes.",
        "image": {
            "model": "gemini-2.5-flash-image",
            "api_version": "v1beta",
            "class_path": "tools.ImageGeneratorNanobananaDataEyesAPI",
        },
        "video": {
            "model": "veo-3.1-generate-preview",
            "api_version": "v1",
            "class_path": "tools.VideoGeneratorVeoDataEyesAPI",
            "t2v_model": "veo-3.1-generate-preview",
            "ff2v_model": "veo-3.1-generate-preview",
            "flf2v_model": "veo-3.1-generate-preview",
        },
    },
    "config": {
        "id": "config",
        "label": "ViMax YAML config",
        "description": "Keep image_generator and video_generator from the selected ViMax YAML config.",
        "image": {"model": "", "api_version": "", "class_path": ""},
        "video": {
            "model": "",
            "api_version": "",
            "class_path": "",
            "t2v_model": "",
            "ff2v_model": "",
            "flf2v_model": "",
        },
    },
}


def normalize_vimax_media_preset(value: str | None) -> str:
    """Return a supported preset id, falling back to the production default."""
    preset = str(value or "").strip().lower()
    if preset in {"", "auto"}:
        return DEFAULT_VIMAX_MEDIA_PRESET
    aliases = {
        "google": "gemini",
        "veo": "gemini",
        "nanobanana": "gemini",
        "seedream": "doubao",
        "seedance": "doubao",
        "dataeye": "dataeyes",
        "dataeyes": "dataeyes",
        "dataeyes_gemini": "dataeyes_gemini_veo",
        "dataeyes_veo": "dataeyes_gemini_veo",
        "dataeyes_gemini_veo": "dataeyes_gemini_veo",
        "dataeyes_nanobanana": "dataeyes_gemini_veo",
        "yaml": "config",
        "default": "config",
    }
    preset = aliases.get(preset, preset)
    if preset in VIMAX_MEDIA_PRESETS:
        return preset
    return DEFAULT_VIMAX_MEDIA_PRESET


def vimax_media_preset(value: str | None) -> dict[str, Any]:
    return VIMAX_MEDIA_PRESETS[normalize_vimax_media_preset(value)]
