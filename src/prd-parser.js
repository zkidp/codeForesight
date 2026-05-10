import fs from 'node:fs';
import path from 'node:path';

export function parsePRD(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const meta = parseSimpleYaml(frontmatter);
  const acceptance = extractAcceptanceList(body);
  const mermaidBlocks = extractMermaid(body);
  const filePathHints = extractPathHints(body);
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  return {
    file: filePath,
    id: meta.id || autoIdFromFile(filePath),
    title: meta.title || titleFromBody(body) || path.basename(filePath, '.md'),
    priority: meta.priority || 'P2',
    tags,
    expects: meta.expects || {},
    acceptance,
    mermaid: mermaidBlocks,
    pathHints: filePathHints,
    body,
    raw
  };
}

function autoIdFromFile(p) {
  const base = path.basename(p, '.md');
  const m = base.match(/^(\d+)/);
  if (m) return `req-${m[1]}`;
  return `req-${base.replace(/[^a-z0-9-]/gi, '-').slice(0, 24)}`;
}

function titleFromBody(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: '', body: raw };
  return {
    frontmatter: raw.slice(3, end).trim(),
    body: raw.slice(end + 4).replace(/^\r?\n/, '')
  };
}

function extractAcceptanceList(body) {
  const items = [];
  const re = /^[\t ]*[-*]\s+\[( |x|X)\]\s+(.+)$/gm;
  let m;
  while ((m = re.exec(body))) {
    items.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  return items;
}

function extractMermaid(body) {
  const blocks = [];
  const re = /```mermaid\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(body))) blocks.push(m[1]);
  return blocks;
}

function extractPathHints(body) {
  const hints = new Set();
  const re = /\b([a-zA-Z0-9_./-]+\.(?:js|ts|tsx|jsx|py|go|rs|java|rb|cs|php|sql|prisma))\b/g;
  let m;
  while ((m = re.exec(body))) hints.add(m[1]);
  return [...hints];
}

function parseSimpleYaml(text) {
  if (!text) return {};
  const out = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent !== 0) { i++; continue; }
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const inline = m[2];
    if (inline.trim() === '') {
      const block = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) { block.push(lines[i]); i++; }
      out[key] = parseBlock(block);
    } else {
      out[key] = parseScalar(inline);
      i++;
    }
  }
  return out;
}

function parseBlock(lines) {
  if (!lines.length) return null;
  const isList = lines.every(l => /^\s*-\s/.test(l));
  if (isList) {
    return lines.map(l => {
      const v = l.replace(/^\s*-\s/, '');
      if (v.trim().startsWith('{')) return parseInlineObj(v.trim());
      return parseScalar(v.trim());
    });
  }
  const out = {};
  let i = 0;
  const minIndent = Math.min(...lines.map(l => l.match(/^(\s*)/)[1].length));
  while (i < lines.length) {
    const line = lines[i];
    const ind = line.match(/^(\s*)/)[1].length;
    if (ind !== minIndent) { i++; continue; }
    const m = line.trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    if (m[2].trim() === '') {
      const sub = [];
      i++;
      while (i < lines.length && lines[i].match(/^(\s*)/)[1].length > minIndent) {
        sub.push(lines[i].slice(minIndent));
        i++;
      }
      out[key] = parseBlock(sub);
    } else {
      out[key] = parseScalar(m[2].trim());
      i++;
    }
  }
  return out;
}

function parseInlineObj(s) {
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1);
    const out = {};
    for (const part of splitTopLevel(inner, ',')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = parseScalar(v);
    }
    return out;
  }
  return parseScalar(s);
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(last, i)); last = i + 1; }
  }
  out.push(s.slice(last));
  return out;
}

function parseScalar(v) {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1);
    return splitTopLevel(inner, ',').map(s => parseScalar(s));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  return v;
}
