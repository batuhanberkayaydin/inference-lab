# Inference Lab

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Delegated by the user: React and TypeScript frontend, Python standard-library HTTP backend plus cryptography, SQLite local persistence. The user confirmed local development and building directly in code with browser verification.

## Users
Inference engineers comparing normal and concurrent vLLM-compatible inference services.

## Product Purpose
Prepare identical request inputs, compare up to four configured models, inspect streaming performance, and save reports for later analysis.

## Capabilities and Constraints
- One to eight independently editable request inputs; reusable default contexts.
- A separate saved-input archive: named context/question pairs, category and free/8K/16K/32K/64K/128K target labels, .txt import, editing, and loading into a chosen request or all requests. Target labels do not claim actual tokenizer length.
- Single, concurrent, and serial-vs-concurrent comparison modes.
- Separate timed-test page: one configured model, up to eight independent lanes, each waiting after its own response, a dispatch duration, JSON/curl body import, per-request duration and provider tokens divided by total response time, guard result/attempts/version/policy checks and saved test history. No tables or graphs. Missing headers are unknown and reasoning-only answers fail the content check.
- Model name, provider base URL, model ID, API key and optional metrics URL managed in admin settings.
- Initial administrator credentials: admin / admin.
- Automatic report persistence, previous-run inspection and exports.
- A shared interactive overview chart for live runs and reports; data-aware scales, per-model visibility, token/throughput views, accessible time inspection, and explicit benchmark-mode explanations.
- Docker Compose startup from the repository root, with unless-stopped restart, a persistent data volume, and localhost port 8080. Native data/ and Docker volume are separate.
- Never invent provider token counts or speculative metrics. Clearly distinguish demonstration runs from real runs.
- Development instructions and a small extensible test suite.

## Evidence on Hand
User-supplied interface references and local synthetic fixtures guide the implementation. User data and private experiment results are excluded from the repository.

## Product Principles
Identical input and generation settings across comparison targets. Separate per-request speed from aggregate throughput. Preserve failures, run configuration and metric provenance. Keep API credentials on the server.
- Per-input side-by-side model answers appear live in overview and the answers tab, remain readable in saved reports, preserve partial output, and support stream or normal responses.
