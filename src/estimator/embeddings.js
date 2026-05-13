// 语义嵌入：替换 history 层的 Jaccard 相似度。
//
// Provider 选择优先级：
//   1. VOYAGE_API_KEY → Voyage AI（Anthropic 推荐的 embedding 伙伴）
//   2. OPENAI_API_KEY → OpenAI text-embedding-3-small
//   3. 无 API key → 返回 null，调用方降级回 Jaccard
//
// 所有 embedding 按内容 sha256 缓存到 .codepr/cache/embeddings/

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, ensureCodeprDir } from '../paths.js';

const VOYAGE_MODEL = process.env.CODEFORESIGHT_VOYAGE_MODEL || 'voyage-3-lite';
const OPENAI_MODEL = process.env.CODEFORESIGHT_OPENAI_MODEL || 'text-embedding-3-small';

function provider() {
  if (process.env.VOYAGE_API_KEY) return 'voyage';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function cacheKey(text, prov, model) {
  return crypto.createHash('sha256').update(`${prov}:${model}:${text}`).digest('hex').slice(0, 24);
}

function cachePath(repo, key) {
  return path.join(paths(repo).base, 'cache', 'embeddings', `${key}.json`);
}

export async function embed(text, repo, opts = {}) {
  if (opts.skipNetwork) return null;
  const prov = provider();
  if (!prov) return null;
  const model = prov === 'voyage' ? VOYAGE_MODEL : OPENAI_MODEL;
  const trimmed = String(text || '').slice(0, 8000);
  if (!trimmed.trim()) return null;

  const key = cacheKey(trimmed, prov, model);
  ensureCodeprDir(repo);
  const file = cachePath(repo, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).vec; } catch {}
  }

  try {
    let vec;
    if (prov === 'voyage') vec = await embedVoyage(trimmed, model);
    else vec = await embedOpenAI(trimmed, model);
    if (!vec || !vec.length) return null;
    fs.writeFileSync(file, JSON.stringify({ provider: prov, model, vec }));
    return vec;
  } catch (e) {
    return null;
  }
}

async function embedVoyage(text, model) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({ input: [text], model, input_type: 'document' })
  });
  if (!res.ok) throw new Error(`voyage ${res.status}`);
  const data = await res.json();
  return data?.data?.[0]?.embedding || null;
}

async function embedOpenAI(text, model) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ input: text, model })
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  return data?.data?.[0]?.embedding || null;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingsAvailable() {
  return provider() != null;
}
