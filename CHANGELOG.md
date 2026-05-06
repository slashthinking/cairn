# Changelog — Cairn (Claude Code Session Manager)

All notable changes to Cairn are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — 2026-05-06

First public release. Apple Silicon Macs only.

### Added

- **Hybrid search** — BM25 (Tantivy via LanceDB) + dense vector (Qwen3-Embedding-0.6B via fastembed-rs / candle Metal backend) fused with RRF (k=60). Sub-200ms warm query latency on M-series.
- **CJK-aware tokenization** — jieba-rs in `cut_for_search` mode emits both compound words and sub-words so queries like `产品设计` match documents containing `设计` alone. Used at both index and query time.
- **Mix dashboard** — unified ranked feed of recent sessions across every workspace, with workspace and project pills as scope filters (no separate per-workspace navigation page).
- **Session detail right drawer** — 640px overlay drawer with hero, fact strip, inline chat preview, sticky bottom bar (copy id / fork / resume in terminal). Replaces the old full-page session view.
- **Cleanup zone** — surface and one-click resolve four pollution classes: out-of-tree pollution, drifted sessions, dead links, archive ghosts.
- **AI rename** — local `claude` CLI suggests 4 alternative names with reasoning for any project or session.
- **AI cluster** — local `claude` groups projects within a workspace by topic. Runs at most every 7 days or when N new sessions accumulate; user can trigger manually.
- **Resume to terminal** — Terminal.app, iTerm2, Warp, Ghostty, kitty, Alacritty, plus a custom command template.
- **Quick Start (⌘N)** — zero-friction temp project creation with optional initial prompt.
- **Incremental index rebuild** — content hashed via djb2; only sessions whose text changed since the last rebuild get re-embedded. Removed sessions get deleted from the index.
- **Pencil tool-result preamble stripping** — sessions launched from MCP chatbots like Pencil receive a synthetic prefix on the first user message; the parser strips it so titles reflect the real prompt.
- **76 unit tests** — coverage across sessionParser, escape, promptBuilder, and CN tokenizer paths.

### Architecture

- **Two NAPI native modules link directly into the Electron main process.** No Python, no daemon, no subprocess.
  - `@lancedb/lancedb` — Rust core, BM25 + vector + RRF.
  - `native-embed/cairn-embed.darwin-arm64.node` — local Rust crate via napi-rs, wraps fastembed-rs with the candle Metal backend and jieba-rs.
- **Local-first, zero telemetry.** Session transcripts are read directly from `~/.claude/projects/`. Vector index lives in `~/.claude/cairn/lancedb/`. Embedding model weights cache in `~/.cache/huggingface/`. The only network call in normal operation is the one-time model download (overridable via `HF_ENDPOINT`).
- **Project identity = session activity.** Workspaces are user-registered top-level folders; projects auto-surface based on actual `.jsonl` activity in any descendant. Workspace and any ancestor of a workspace cannot host sessions directly.

### Known limitations

- **Apple Silicon only.** LanceDB ships no `x86_64-apple-darwin` prebuilt; the embedder runs unusably slow on Intel CPU. Targeting Intel would require recompiling LanceDB from source plus a different embedding strategy.
- **Ad-hoc signed.** First launch is blocked by Gatekeeper; user has to right-click → Open, or clear quarantine via `xattr`.
- **First search blocks on model download.** ~600MB Qwen3 weights download from Hugging Face on first query. Subsequent queries are warm (~150ms).
- **No SwiftUI / native window controls.** Built on Electron; window decoration is custom-rendered.
- **Single-user.** No multi-account, no cloud sync, no shared workspaces.
- **macOS only.** No Windows or Linux build.

### Tech stack snapshot at 0.1.0

| Layer | Version |
|---|---|
| Electron | 33.x |
| Bun | 1.3.9 |
| React / TypeScript | 18 / 5.5 |
| LanceDB | 0.27.2 |
| fastembed-rs | 5.x (qwen3 + ort-download-binaries-native-tls) |
| candle-core | 0.10 |
| jieba-rs | 0.7 |
| Embedding model | Qwen/Qwen3-Embedding-0.6B (1024 dim) |
| napi-rs | 3.x |
| Rust | edition 2021 |

[Unreleased]: https://github.com/<org>/cairn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<org>/cairn/releases/tag/v0.1.0
