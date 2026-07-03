# Changelog

All notable changes to the Codata open-source repository will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Changed

- Reworked open-source contributor guidance for Apache-2.0 community contributions.
- Cleaned user documentation so model setup is described as BYOK, OpenAI-compatible endpoint, custom endpoint, or local Ollama.
- Removed stale hosted-account, paid-plan, and proxy-provider wording from public-facing documentation.
- Removed broken static documentation image references that were not included in the open-source repository.
- Updated frontend documentation and GitHub issue links for the open-source repository.

## [1.1.12-open-source] - 2026-06-12

### Added

- Initialized the independent open-source repository at `https://github.com/Mlilion/Codata`.
- Added Apache License, Version 2.0.
- Added open-source boundary checks for account, billing, and proxy-provider code paths.
- Added English and Chinese README pages focused on Codata expert-team multi-agent workflows.

### Changed

- Removed hosted account login, commercial billing, subscription, and proxy-provider implementation files from the open-source repository.
- Kept the open-source model flow focused on user-provided model providers, OpenAI-compatible endpoints, custom endpoints, and local Ollama.
- Cleaned bundled documentation so only user-facing manuals remain under `docs/`.
- Updated security contact to `codata@126.com`.
