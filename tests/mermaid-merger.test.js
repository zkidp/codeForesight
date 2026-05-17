import { describe, it, expect } from 'vitest';
import { mergeProjectArchitecture } from '../src/report/mermaid-merger.js';

function flowchartPRD(body) {
  return { mermaid: [body] };
}

describe('mergeProjectArchitecture', () => {
  it('returns empty when no PRDs have mermaid', () => {
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd: { mermaid: [] }, status: 'backlog' }
    ]);
    expect(r.empty).toBe(true);
  });

  it('merges two PRDs sharing a node id, dedups edges', () => {
    const prdA = flowchartPRD(`flowchart LR
  A[Parser] --> B[Estimator]
`);
    const prdB = flowchartPRD(`flowchart LR
  A[Parser] --> C[Scanner]
`);
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd: prdA, status: 'done', audit: null },
      { reqId: 'r2', prd: prdB, status: 'done', audit: null }
    ]);
    expect(r.empty).toBe(false);
    expect(r.nodeCount).toBe(3); // A, B, C unique
    expect(r.edgeCount).toBe(2);
    // 'A' came from both req-ids — sources should reflect that
    expect(r.sources['A']).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  it('annotates merged nodes with source list 〔req-1, req-2〕', () => {
    const prdA = flowchartPRD(`flowchart LR
  Shared[Shared component]
`);
    const prdB = flowchartPRD(`flowchart LR
  Shared[Shared component]
`);
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd: prdA, status: 'done' },
      { reqId: 'r2', prd: prdB, status: 'done' }
    ]);
    expect(r.mermaid).toContain('〔r1, r2〕');
  });

  it('skips sequenceDiagram and classDiagram blocks', () => {
    const seq = flowchartPRD(`sequenceDiagram
  Alice->>Bob: hi`);
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd: seq, status: 'done' }
    ]);
    expect(r.empty).toBe(true);
  });

  it('applies worst-state coloring across reqs (missing wins over matched)', () => {
    const audit1 = {
      routes: { matched: [{ name: 'Login', path: '/login', method: 'POST' }], missing: [] },
      handlers: { matched: [], missing: [] }, hooks: { matched: [], missing: [] }, db_models: { matched: [], missing: [] }
    };
    const audit2 = {
      routes: { matched: [], missing: [{ name: 'Login', path: '/login', method: 'POST' }] },
      handlers: { matched: [], missing: [] }, hooks: { matched: [], missing: [] }, db_models: { matched: [], missing: [] }
    };
    const prd = flowchartPRD(`flowchart LR
  Login[Login]
`);
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd, audit: audit1, status: 'done' },
      { reqId: 'r2', prd, audit: audit2, status: 'done' }
    ]);
    expect(r.stateMap['Login']).toBe('missing');
  });

  it('parses round, circle, rhombus shapes', () => {
    const prd = flowchartPRD(`flowchart LR
  A(Round) --> B((Circle))
  B --> C{Rhombus}
`);
    const r = mergeProjectArchitecture([
      { reqId: 'r1', prd, status: 'done' }
    ]);
    expect(r.nodeCount).toBe(3);
    expect(r.mermaid).toContain('((Circle'); // circle shape preserved
    expect(r.mermaid).toContain('{Rhombus'); // rhombus
  });
});
