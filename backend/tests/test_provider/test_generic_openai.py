from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.provider.generic_openai import GenericOpenAIProvider


@pytest.mark.asyncio
async def test_model_api_failure_is_not_reported_as_zero_models():
    provider = GenericOpenAIProvider(
        "key",
        provider_id="custom_company",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        kind="openai_compat_custom",
    )
    provider._load_models_dev = AsyncMock(return_value=[])
    provider._load_catalog_models = lambda: []
    provider._client.models.list = AsyncMock(side_effect=RuntimeError("proxy refused"))

    with pytest.raises(RuntimeError, match="Unable to fetch models from provider 'custom_company'"):
        await provider.list_models()


def test_doubao_models_are_mapped_to_company_deployments():
    provider = GenericOpenAIProvider(
        "key",
        provider_id="doubao",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
    )

    assert provider._resolve_request_model("glm-5-2-260617") == "ep-20260916144829-9pcq6"
    assert provider._resolve_request_model("unknown-model") == "unknown-model"


def test_custom_provider_model_ids_are_not_mapped():
    provider = GenericOpenAIProvider(
        "key",
        provider_id="custom_company",
        base_url="https://example.com/v1",
        kind="openai_compat_custom",
    )

    assert provider._resolve_request_model("glm-5-2-260617") == "glm-5-2-260617"


@pytest.mark.asyncio
async def test_doubao_list_includes_all_company_deployments():
    provider = GenericOpenAIProvider(
        "key",
        provider_id="doubao",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
    )
    provider._load_models_dev = AsyncMock(return_value=[])
    provider._load_catalog_models = lambda: []
    provider._fetch_api_models = AsyncMock(return_value=[])

    models = await provider.list_models()

    assert {model.id for model in models} == {
        "doubao-seed-2-1-pro-260628",
        "deepseek-v4-1-flash",
        "glm-5-2-260617",
    }