import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/report/minimal-md.js';

describe('renderMarkdown', () => {
  it('renders headers H1–H3', () => {
    const html = renderMarkdown('# H1\n## H2\n### H3');
    expect(html).toMatch(/<h1>/);
    expect(html).toMatch(/<h2>/);
    expect(html).toMatch(/<h3>/);
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- one\n- two\n- three');
    expect(html).toMatch(/<ul>/);
    expect(html.match(/<li>/g).length).toBe(3);
  });

  it('renders GFM task lists with checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done');
    expect(html).toMatch(/type="checkbox"/);
    expect(html).toMatch(/checked/);
  });

  it('renders fenced code blocks with language class', () => {
    const html = renderMarkdown('```javascript\nconst x = 1;\n```');
    expect(html).toMatch(/<pre><code class="language-javascript">/);
    expect(html).toMatch(/const x = 1;/);
  });

  it('renders inline code', () => {
    const html = renderMarkdown('Use `foo()` to call.');
    expect(html).toMatch(/<code>foo\(\)<\/code>/);
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic*');
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<em>italic<\/em>/);
  });

  it('renders links', () => {
    const html = renderMarkdown('[click](https://example.com)');
    expect(html).toMatch(/<a href="https:\/\/example\.com">click<\/a>/);
  });

  it('escapes HTML inside fenced code blocks (security)', () => {
    const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
  });

  it('escapes inline HTML in paragraphs (no raw HTML escape hatch)', () => {
    const html = renderMarkdown('Before <script>bad</script> after');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>bad/);
  });

  it('keeps mermaid blocks as language-mermaid for downstream rewriting', () => {
    const html = renderMarkdown('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toMatch(/<pre><code class="language-mermaid">/);
    expect(html).toContain('flowchart LR');
  });
});
