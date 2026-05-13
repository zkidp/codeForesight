// 极简 Markdown → HTML 渲染器（覆盖 PRD 常用语法）
// 不追求完整 CommonMark，只覆盖：
//   # 标题、段落、空行
//   - / * / 1. 列表
//   - [ ] / - [x] 任务清单
//   ```lang fenced code（含 mermaid）
//   `inline code`、**bold**、*italic*、[link](url)
//   表格（| a | b |）
// 不支持引用块、嵌套列表的深度优化、HTML 转义之外的 raw HTML（直接放行）

export function renderMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.match(/^```(\w+)?/)) {
      const lang = line.match(/^```(\w+)?/)[1] || '';
      const body = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code class="language-${esc(lang)}">${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.match(/^#{1,6}\s/)) {
      const level = line.match(/^(#+)/)[1].length;
      const content = renderInline(line.replace(/^#+\s+/, ''));
      out.push(`<h${level}>${content}</h${level}>`);
      i++;
      continue;
    }

    if (line.match(/^[-*]\s+\[( |x|X)\]\s+/) || line.match(/^[-*]\s+(?!\[)/) || line.match(/^\d+\.\s+/)) {
      const isTask = line.match(/^[-*]\s+\[( |x|X)\]/);
      const isOrdered = !!line.match(/^\d+\.\s+/);
      const tag = isOrdered ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length && (
        lines[i].match(/^[-*]\s+\[( |x|X)\]\s+/) ||
        lines[i].match(/^[-*]\s+(?!\[)/) ||
        lines[i].match(/^\d+\.\s+/) ||
        (lines[i].match(/^\s{2,}\S/) && items.length)
      )) {
        const l = lines[i];
        if (l.match(/^\s{2,}\S/) && items.length) {
          items[items.length - 1] += ' ' + l.trim();
        } else if (l.match(/^[-*]\s+\[( |x|X)\]\s+/)) {
          const done = l.match(/^[-*]\s+\[(.)\]/)[1].toLowerCase() === 'x';
          const text = l.replace(/^[-*]\s+\[.\]\s+/, '');
          items.push(`<li class="task-list-item"><input type="checkbox"${done ? ' checked' : ''} disabled> ${renderInline(text)}</li>`);
        } else if (l.match(/^[-*]\s+/)) {
          items.push(`<li>${renderInline(l.replace(/^[-*]\s+/, ''))}</li>`);
        } else if (l.match(/^\d+\.\s+/)) {
          items.push(`<li>${renderInline(l.replace(/^\d+\.\s+/, ''))}</li>`);
        }
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (line.match(/^\|.+\|\s*$/) && i + 1 < lines.length && lines[i + 1].match(/^\|[\s\-:|]+\|\s*$/)) {
      const headers = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].match(/^\|.+\|\s*$/)) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    // raw HTML passthrough (line starts with <)
    if (line.match(/^<[a-zA-Z!/]/)) {
      out.push(line);
      i++;
      continue;
    }

    // paragraph
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].match(/^(#{1,6}\s|[-*]\s|\d+\.\s|```|\||<)/)) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function parseRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(s => s.trim());
}

function renderInline(text) {
  let h = text;
  // inline code first (so other patterns don't touch its content)
  const codeStash = [];
  h = h.replace(/`([^`]+)`/g, (_m, c) => {
    codeStash.push(c);
    return `\x00CODE${codeStash.length - 1}\x00`;
  });
  h = esc(h);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/\x00CODE(\d+)\x00/g, (_m, i) => `<code>${esc(codeStash[Number(i)])}</code>`);
  return h;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
