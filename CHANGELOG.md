# Changelog — Cairn (Claude Code Session Manager)

All notable changes to Cairn are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.3] — 2026-05-07

### Added

- ClusterCard now exposes a clear `See all →` link in the header that takes the user into the workspace scope. The bottom `+ N more in this topic →` link gets an accent color so it reads as a CTA, not muted prose. Both wire to `setScope(workspace)`.

### Fixed

- GitHub Actions release workflow now actually publishes. `package:mac` script passes `--publish never` so electron-builder only packages; the `softprops/action-gh-release` step does the upload. Previously the auto-publish path tried to run with no `GH_TOKEN` and aborted after the dmg was already built.

## [0.1.2] — 2026-05-07

### Fixed

- **Hard kill-switch on the native embedder**. cairn-embed still SIGTRAP-aborts the main process on some setups during model init even with `panic = "unwind"`; the panic happens before any JS catch can fire. Until that's traced and fixed at the napi-rs boundary, the embedder is bypassed entirely:
  - `lancedb:rebuild`, `lancedb:search`, `lancedb:status` short-circuit to no-op responses.
  - Search continues to work via lexical (BM25) fallback over session titles + projects + workspaces.
  - Set `CAIRN_VECTOR=1` in the environment to opt back in (only safe if you've separately verified your candle/Metal stack is clean).
- Auto rebuild on launch now stays disabled regardless of timer.

## [0.1.1] — 2026-05-07

### Fixed

- **Embedder panic no longer kills the app.** `native-embed/Cargo.toml` now uses `panic = "unwind"` so a Rust panic inside a tokio worker (model init, embed, jieba) is converted by napi-rs into a JS error instead of SIGTRAP-aborting the Electron main process. Reported as a launch-time crash after clearing `~/.claude/cairn/`.
- **Auto index rebuild deferred 8s after launch** so the UI is interactive before the embedder starts heavy work — and a visible toast (`Building search index… N sessions · runs in background`) is shown the first time so the rebuild isn't invisible.
- **Auto rebuild errors surface as toast**, not silent. Lexical search still works as fallback when the embedder is unavailable.

### Visual

- Pills active state: white pill (`bg-foreground text-background`) with shadow, replacing the previous low-contrast `bg-cc-surface-press`. Highest-IA element is now the heaviest visual anchor on the page.
- Project drill: items-baseline + leading-none across mixed font sizes so `← Coding › cairn · 24 sessions` lines up cleanly.
- ScopedProjectRow: same baseline alignment fix; bullet dot and chevron use self-center.
- Pills count: 10.5px → 12px font-medium so it shares baseline with the 12px label.
- Light-mode shadows: split into `light:` / `dark:` variants — softer alpha in light mode, original depth in dark mode.

### Added

- **Workspace scope cluster view**: when AI clusters exist for the workspace, default to cluster cards with a `By topic / By time` segmented toggle and `Re-cluster` action. Falls back to flat time-sorted list with `AI Cluster` button when no clusters yet.
- **By topic cluster card click**: `+ N more` and the cluster header now enter the workspace (where the full cluster is laid out), instead of jumping to the first project's drill.
- **Project drill AI summaries button**: manual `Generate AI summaries · N` action that batch-renames the most-recent 30 unnamed sessions via the local `claude` CLI (concurrency 2, progress shown).
- **Quick Start AI folder name**: typing into the textarea triggers a debounced `claude` rename suggestion that fills the folder name automatically. Falls back to slugify, then to `scratch-MMDD-HHMM`.

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
