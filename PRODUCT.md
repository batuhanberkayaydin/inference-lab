# Inference Lab

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Delegated by the user: React and TypeScript frontend, Python standard-library HTTP backend, SQLite local persistence. No third-party Python packages or pip installation. The user confirmed local development and building directly in code with browser verification.

## Users
Inference engineers comparing normal and concurrent vLLM-compatible inference services.

## Product Purpose
Prepare identical request inputs, compare up to four configured models, inspect streaming performance, and save reports for later analysis.

## Capabilities and Constraints
- One to 1024 independently editable request inputs and up to 1024 simultaneous benchmark requests in total. Counts can be typed or selected.
- A separate saved-input archive: named context/question pairs, category and free/8K/16K/32K/64K/128K target labels, .txt import, editing, and loading into a chosen request or all requests. Target labels do not claim actual tokenizer length.
- Single, concurrent, and serial-vs-concurrent comparison modes.
- Optional Empty Guard tracking by model. Benchmark answers and request details show the provider's guard result, attempt count, version and policy for opted-in models.
- Model name, provider base URL, model ID, API key and optional metrics URL managed in admin settings.
- Initial administrator credentials: admin / admin.
- Automatic report persistence, previous-run inspection and exports.
- A shared interactive overview chart for live runs and reports; data-aware scales, per-model visibility, token/throughput views, accessible time inspection, and explicit benchmark-mode explanations.
- Docker Compose startup from the repository root, with unless-stopped restart, a persistent data volume, and localhost port 8080. Native data/ and Docker volume are separate.
- Default Compose builds the local Dockerfile. No automated GitHub image build/publication or required GHCR pull. Python runtime setup needs no pip/PyPI; frontend builds still need npm packages and the initial build may download base images.
- API credentials persist as plaintext in owner-only files outside SQLite, the browser and reports. Preserve old encrypted records and key files; old keys need explicit reentry in model settings.
- Fresh deployments have no automatic models, contexts, saved inputs or reports. New runs use real APIs only; legacy demo models are hidden and historical demo reports retain their synthetic label. Bundled 32K/64K Turkish prompt files load only by explicit selection.
- Never invent provider token counts or speculative metrics. Clearly distinguish demonstration runs from real runs.
- Development instructions and a small extensible test suite.

## Evidence on Hand
User-supplied interface references and local synthetic fixtures guide the implementation. User data and private experiment results are excluded from the repository.

## Product Principles
Identical input and generation settings across comparison targets. Separate per-request speed from aggregate throughput. Preserve failures, run configuration and metric provenance. Keep API credentials on the server.
- Per-input side-by-side model answers appear live in overview and the answers tab, remain readable in saved reports, preserve partial output, and support stream or normal responses.
