import fs from 'node:fs';
import path from 'node:path';

const KEYWORDS_JS = ['import', 'export', 'const', 'let', 'var', 'function', 'class', 'extends', 'return', 'if', 'else', 'for', 'while', 'await', 'async', 'new', 'this', 'try', 'catch', 'throw', 'typeof', 'instanceof', 'default', 'from', 'as', 'in', 'of', 'true', 'false', 'null', 'undefined'];
const KEYWORDS_PY = ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'raise', 'with', 'as', 'in', 'is', 'not', 'and', 'or', 'lambda', 'yield', 'async', 'await', 'True', 'False', 'None', 'self'];

export function extractSnippet(repo, fileRel, symbolName, contextLines = 2) {
  const absFile = path.resolve(repo, fileRel);
  if (!fs.existsSync(absFile)) return null;
  const text = fs.readFileSync(absFile, 'utf8');
  const lines = text.split(/\r?\n/);

  const re = new RegExp(`\\b(?:function|const|let|class|def|export\\s+(?:default\\s+)?(?:async\\s+)?function|export\\s+const|export\\s+class)\\s+${escapeRe(symbolName)}\\b`);
  const startLine = lines.findIndex(l => re.test(l));
  if (startLine < 0) return null;

  const endLine = findBlockEnd(lines, startLine, fileRel);
  const from = Math.max(0, startLine - contextLines);
  const to = Math.min(lines.length - 1, endLine + 1);

  const snippet = lines.slice(from, to + 1).map((line, i) => ({
    lineNo: from + i + 1,
    text: line
  }));

  return {
    file: fileRel,
    name: symbolName,
    startLine: from + 1,
    endLine: to + 1,
    lines: snippet,
    lang: detectLang(fileRel)
  };
}

function findBlockEnd(lines, start, fileRel) {
  const isPy = fileRel.endsWith('.py');
  if (isPy) {
    const startIndent = lines[start].match(/^(\s*)/)[1].length;
    for (let i = start + 1; i < lines.length && i < start + 40; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= startIndent && line.trim() !== '') return i - 1;
    }
    return Math.min(lines.length - 1, start + 15);
  }

  let depth = 0;
  let seenOpen = false;
  for (let i = start; i < lines.length && i < start + 60; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seenOpen = true; }
      else if (ch === '}') { depth--; if (seenOpen && depth === 0) return i; }
    }
    if (seenOpen && depth === 0 && i > start) return i;
  }
  return Math.min(lines.length - 1, start + 15);
}

function detectLang(file) {
  const ext = path.extname(file).slice(1);
  return { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', py: 'py', go: 'go', rs: 'rs' }[ext] || 'txt';
}

export function renderSnippetHtml(snip) {
  if (!snip) return '';
  const tokenize = snip.lang === 'py' ? KEYWORDS_PY : KEYWORDS_JS;
  const body = snip.lines.map(l => {
    const highlighted = highlight(l.text, tokenize);
    return `<span class="ln">${l.lineNo}</span>${highlighted}`;
  }).join('\n');
  return `
    <div class="snippet">
      <div class="snippet-head">
        <span class="snippet-name">${esc(snip.name)}</span>
        <span class="snippet-file">${esc(snip.file)}:${snip.startLine}</span>
      </div>
      <pre><code>${body}</code></pre>
    </div>`;
}

function highlight(line, keywords) {
  let h = esc(line);
  h = h.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/g, '<span class="cmt">$1</span>');
  h = h.replace(/(['"`])((?:\\.|(?!\1).)*?)\1/g, '<span class="str">$&</span>');
  for (const kw of keywords) {
    const re = new RegExp(`\\b(${kw})\\b(?![^<]*<\\/span>)`, 'g');
    h = h.replace(re, '<span class="kw">$1</span>');
  }
  h = h.replace(/\b([a-zA-Z_]\w*)\s*\(/g, (m, name) => {
    if (keywords.includes(name)) return m;
    return `<span class="fn">${name}</span>(`;
  });
  return h;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
