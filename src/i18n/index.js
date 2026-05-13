import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, 'locales');

const SUPPORTED = ['zh', 'en'];
const DEFAULT_LANG = 'zh';

let _cache = null;
let _currentLang = null;

export function detectLang(override) {
  if (override && SUPPORTED.includes(override)) return override;
  const envLang =
    process.env.CODEFORESIGHT_LANG ||
    process.env.CODEPR_LANG ||
    null;
  if (envLang) {
    const norm = envLang.toLowerCase().slice(0, 2);
    if (SUPPORTED.includes(norm)) return norm;
  }
  const sysLang = process.env.LANG || process.env.LC_ALL || '';
  if (sysLang.toLowerCase().startsWith('zh')) return 'zh';
  if (sysLang.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  _currentLang = lang;
  _cache = null;
}

export function getLang() {
  if (!_currentLang) _currentLang = detectLang();
  return _currentLang;
}

function load(lang) {
  const file = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function t(key, params) {
  if (!_cache) {
    const lang = getLang();
    const primary = load(lang);
    const fallback = lang === DEFAULT_LANG ? {} : load(DEFAULT_LANG);
    _cache = { primary, fallback };
  }
  let str = _cache.primary[key] ?? _cache.fallback[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

export function loadAllLocales() {
  return { en: load('en'), zh: load('zh') };
}

export { SUPPORTED, DEFAULT_LANG };
