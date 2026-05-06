// Cairn native embedder — fastembed-rs (candle backend) + NAPI-RS.
//
// Loads Qwen/Qwen3-Embedding-0.6B once on first call and keeps it
// resident in the Electron main process. Subsequent embeds <100ms warm.
// Honors HF_ENDPOINT (e.g. https://hf-mirror.com) for users in regions
// where huggingface.co is throttled.

use std::sync::OnceLock;
use tokio::sync::Mutex;

use candle_core::{DType, Device};
use fastembed::Qwen3TextEmbedding;
use jieba_rs::Jieba;
use napi::bindgen_prelude::*;
use napi_derive::napi;

const REPO: &str = "Qwen/Qwen3-Embedding-0.6B";
const MAX_LENGTH: usize = 512;

static MODEL: OnceLock<Mutex<Qwen3TextEmbedding>> = OnceLock::new();
// Jieba's dictionary is bundled into the .node binary (~5MB) — no
// download or external file needed.
static JIEBA: OnceLock<Jieba> = OnceLock::new();

fn jieba() -> &'static Jieba {
    JIEBA.get_or_init(Jieba::new)
}

fn pick_device() -> Device {
    // Prefer Metal on Apple Silicon. Falls back to CPU if Metal init
    // fails (e.g. on non-macOS CI).
    Device::new_metal(0).unwrap_or(Device::Cpu)
}

async fn ensure_model() -> Result<&'static Mutex<Qwen3TextEmbedding>> {
    if let Some(m) = MODEL.get() {
        return Ok(m);
    }
    let device = pick_device();
    let model = Qwen3TextEmbedding::from_hf(REPO, &device, DType::F32, MAX_LENGTH)
        .map_err(|e| Error::new(Status::GenericFailure, format!("model init: {e:#}")))?;
    let _ = MODEL.set(Mutex::new(model));
    Ok(MODEL.get().expect("MODEL just set"))
}

/// Embed a single query. Returns 1024 f64 (renderer narrows to f32).
#[napi]
pub async fn embed_query(text: String) -> Result<Vec<f64>> {
    let model = ensure_model().await?;
    let guard = model.lock().await;
    let texts: Vec<&str> = vec![text.as_str()];
    let vecs = guard
        .embed(&texts)
        .map_err(|e| Error::new(Status::GenericFailure, format!("embed: {e:#}")))?;
    let v = vecs
        .into_iter()
        .next()
        .ok_or_else(|| Error::new(Status::GenericFailure, "no vector".to_string()))?;
    Ok(v.into_iter().map(|x| x as f64).collect())
}

/// Embed a batch. Flat output `[count, dim, ...flat_floats]`.
#[napi]
pub async fn embed_batch(texts: Vec<String>) -> Result<Vec<f64>> {
    if texts.is_empty() {
        return Ok(vec![0.0, 0.0]);
    }
    let model = ensure_model().await?;
    let guard = model.lock().await;
    let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    let vecs = guard
        .embed(&refs)
        .map_err(|e| Error::new(Status::GenericFailure, format!("embed batch: {e:#}")))?;
    let count = vecs.len();
    let dim = vecs.first().map(|v| v.len()).unwrap_or(0);
    let mut out = Vec::with_capacity(2 + count * dim);
    out.push(count as f64);
    out.push(dim as f64);
    for v in vecs {
        out.extend(v.into_iter().map(|x| x as f64));
    }
    Ok(out)
}

/// Tokenize CJK + Latin text using jieba's bundled dictionary in
/// search-engine mode. Returns space-joined tokens so the caller can
/// index/query with Tantivy's "simple" tokenizer.
///
/// We use `cut_for_search` (NOT plain `cut`) so compound words are
/// emitted alongside their constituent sub-words. Critical for recall:
///   - cut("产品设计")            → ["产品设计"]            ← won't match docs with just "设计"
///   - cut_for_search("产品设计") → ["产品", "设计", "产品设计"] ← matches anything containing "设计"
///
/// Examples (with cut_for_search):
///   "前端组件库"     → "前端 组件 库 前端组件 组件库"
///   "产品设计"       → "产品 设计 产品设计"
///   "design system"  → "design system"
fn jieba_search_tokens<'a>(j: &'a Jieba, text: &str) -> String {
    let toks = j.cut_for_search(text, true);
    let mut out = String::with_capacity(text.len() + 16);
    for t in toks {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(trimmed);
    }
    out
}

#[napi]
pub fn tokenize(text: String) -> String {
    jieba_search_tokens(jieba(), &text)
}

/// Batch version — used during corpus rebuild. Avoids many NAPI hops.
#[napi]
pub fn tokenize_batch(texts: Vec<String>) -> Vec<String> {
    let j = jieba();
    texts
        .into_iter()
        .map(|text| jieba_search_tokens(j, &text))
        .collect()
}

/// Eager warmup — call after app boot so the first user query is hot.
#[napi]
pub async fn warmup() -> Result<u32> {
    let model = ensure_model().await?;
    let guard = model.lock().await;
    let texts: Vec<&str> = vec!["warmup"];
    let vecs = guard
        .embed(&texts)
        .map_err(|e| Error::new(Status::GenericFailure, format!("warmup: {e:#}")))?;
    Ok(vecs.first().map(|v| v.len()).unwrap_or(0) as u32)
}
