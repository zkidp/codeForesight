const C = {
  bg: '#0d1117',
  grid: '#21262d',
  text: '#c9d1d9',
  muted: '#8b949e',
  scopeUpper: '#d29922',
  scopeLower: '#6e7681',
  band: 'rgba(210, 153, 34, 0.12)',
  actual: '#58a6ff',
  done: '#56d364',
  over: '#f85149',
  ai: '#bc8cff',
  rules: '#79c0ff',
  history: '#56d364'
};

const baseOpts = () => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' },
  plugins: {
    legend: { labels: { color: C.text, font: { size: 11 } } },
    tooltip: {
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      borderWidth: 1,
      titleColor: C.text,
      bodyColor: C.text
    }
  },
  scales: {
    x: {
      type: 'time',
      time: { tooltipFormat: 'MMM d, HH:mm' },
      grid: { color: C.grid },
      ticks: { color: C.muted, font: { size: 10 } }
    },
    y: {
      grid: { color: C.grid },
      ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) }
    }
  }
});

export function drawProjectBurnup(canvas, data, prevChart) {
  if (prevChart) prevChart.destroy();
  const pts = data.points || [];
  if (!pts.length) {
    drawEmpty(canvas, '尚无数据 — 注册 PRD 并产生事件后会出现燃烧图');
    return null;
  }

  const upperData = pts.map(p => ({ x: p.ts, y: p.scopeUpper }));
  const lowerData = pts.map(p => ({ x: p.ts, y: p.scopeLower }));
  const actualData = pts.map(p => ({ x: p.ts, y: p.actualTotal }));
  const doneData = pts.map(p => ({ x: p.ts, y: p.completedScope }));

  const opts = baseOpts();
  opts.plugins.title = {
    display: true,
    text: '项目 Burnup — 估算包络 vs 实际进度',
    color: C.text,
    font: { size: 13, weight: '500' }
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)} tok`
  };

  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: '估算上界',
          data: upperData,
          borderColor: C.scopeUpper,
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          stepped: 'before',
          fill: '+1',
          backgroundColor: C.band
        },
        {
          label: '估算下界',
          data: lowerData,
          borderColor: C.scopeLower,
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          stepped: 'before',
          fill: false
        },
        {
          label: '实际累计',
          data: actualData,
          borderColor: C.actual,
          borderWidth: 2.5,
          pointRadius: 2,
          pointBackgroundColor: C.actual,
          tension: 0.15,
          fill: false
        },
        {
          label: '已完成 scope',
          data: doneData,
          borderColor: C.done,
          borderWidth: 2,
          pointRadius: 1,
          stepped: 'before',
          tension: 0,
          fill: false
        }
      ]
    },
    options: opts
  });
}

export function drawReqBurnup(canvas, data, prevChart) {
  if (prevChart) prevChart.destroy();
  if (!data || !data.points?.length) {
    drawEmpty(canvas, '尚无 token 消耗事件 — 在 Claude Code 里以此需求为 active 工作即可生成');
    return null;
  }
  const pts = data.points;
  const startTs = pts[0].ts;
  const endTs = pts[pts.length - 1].ts;

  const cumLine = pts.map(p => ({ x: p.ts, y: p.cumulative }));
  const upper = data.estimate ? data.estimate[1] : null;
  const lower = data.estimate ? data.estimate[0] : null;

  const datasets = [
    {
      label: '实际累计 token',
      data: cumLine,
      borderColor: data.overBudget ? C.over : C.actual,
      borderWidth: 2.5,
      pointRadius: 2,
      pointBackgroundColor: data.overBudget ? C.over : C.actual,
      tension: 0.15,
      fill: false
    }
  ];

  if (upper != null) {
    datasets.push({
      label: `估算上界 (${fmtK(upper)})`,
      data: [{ x: startTs, y: upper }, { x: endTs, y: upper }],
      borderColor: C.scopeUpper,
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: '+1',
      backgroundColor: C.band
    });
    datasets.push({
      label: `估算下界 (${fmtK(lower)})`,
      data: [{ x: startTs, y: lower }, { x: endTs, y: lower }],
      borderColor: C.scopeLower,
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false
    });
  }

  if (data.estimateLayers) {
    for (const [name, range] of Object.entries(data.estimateLayers)) {
      if (!range) continue;
      datasets.push({
        label: `${name} 上界`,
        data: [{ x: startTs, y: range[1] }, { x: endTs, y: range[1] }],
        borderColor: C[name] || C.muted,
        borderWidth: 1,
        borderDash: [2, 6],
        pointRadius: 0,
        hidden: true,
        fill: false
      });
    }
  }

  const opts = baseOpts();
  opts.plugins.title = {
    display: true,
    text: `${data.title || data.reqId} — 单需求 token burnup`,
    color: C.text,
    font: { size: 13, weight: '500' }
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)} tok`
  };

  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: opts
  });
}

export function drawCalibration(canvas, data, prevChart) {
  if (prevChart) prevChart.destroy();
  if (!data || !data.points?.length) {
    drawEmpty(canvas, '暂无校准数据 — 完成至少 1 个需求后即可绘制估算 vs 实际散点');
    return null;
  }

  const max = data.maxValue * 1.1;
  const inRange = data.points.filter(p => p.tokens.inRange);
  const outOfRange = data.points.filter(p => !p.tokens.inRange);

  const opts = baseOpts();
  opts.scales = {
    x: {
      type: 'linear',
      title: { display: true, text: '估算 token (区间中点)', color: C.muted, font: { size: 11 } },
      grid: { color: C.grid },
      ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) },
      min: 0, max
    },
    y: {
      type: 'linear',
      title: { display: true, text: '实际 token', color: C.muted, font: { size: 11 } },
      grid: { color: C.grid },
      ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) },
      min: 0, max
    }
  };
  opts.plugins.title = {
    display: true,
    text: `估算校准 — n=${data.summary.n} · 命中区间 ${data.summary.accuracy}% · 平均 ratio ${data.summary.meanRatio} (${data.summary.bias})`,
    color: C.text,
    font: { size: 13, weight: '500' }
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const p = ctx.raw;
      return [
        `${p.label}`,
        `估算中点: ${fmtK(p.x)} tok`,
        `实际: ${fmtK(p.y)} tok`,
        `区间: ${fmtK(p.lower)}–${fmtK(p.upper)}`,
        `命中: ${p.inRange ? '✅' : '❌'}`
      ];
    }
  };

  const diagonal = [{ x: 0, y: 0 }, { x: max, y: max }];
  const upperBand = [{ x: 0, y: 0 }, { x: max, y: max * 1.5 }];
  const lowerBand = [{ x: 0, y: 0 }, { x: max, y: max * 0.5 }];

  const toPoint = p => ({
    x: p.tokens.mid,
    y: p.tokens.actual,
    label: `${p.id} ${p.title}`,
    lower: p.tokens.lower,
    upper: p.tokens.upper,
    inRange: p.tokens.inRange
  });

  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: '±50% 区间上限',
          data: upperBand,
          type: 'line',
          borderColor: 'transparent',
          backgroundColor: 'rgba(86, 211, 100, 0.06)',
          fill: '+1',
          pointRadius: 0,
          showLine: true,
          order: 99
        },
        {
          label: '±50% 区间下限',
          data: lowerBand,
          type: 'line',
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          showLine: true,
          order: 99
        },
        {
          label: '完美校准 (y=x)',
          data: diagonal,
          type: 'line',
          borderColor: C.muted,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          showLine: true,
          fill: false
        },
        {
          label: '命中估算区间',
          data: inRange.map(toPoint),
          backgroundColor: C.done,
          borderColor: C.done,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: '超出估算区间',
          data: outOfRange.map(toPoint),
          backgroundColor: C.over,
          borderColor: C.over,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: opts
  });
}

export function drawCFD(canvas, data, prevChart) {
  if (prevChart) prevChart.destroy();
  if (!data || !data.points?.length) {
    drawEmpty(canvas, '尚无需求 — 注册 PRD 后状态变化会形成 CFD');
    return null;
  }
  const pts = data.points;
  const opts = baseOpts();
  opts.plugins.title = {
    display: true,
    text: `累积流程图 (CFD) — peak WIP=${data.summary.maxInProgress}${data.summary.wipWarning ? ' ⚠️' : ''}`,
    color: C.text,
    font: { size: 13, weight: '500' }
  };
  opts.scales.y.stacked = true;
  opts.scales.x.stacked = true;
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`
  };

  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Done',
          data: pts.map(p => ({ x: p.ts, y: p.done })),
          borderColor: C.done,
          backgroundColor: 'rgba(86, 211, 100, 0.35)',
          fill: 'origin',
          stepped: 'before',
          pointRadius: 0,
          tension: 0
        },
        {
          label: 'In Progress',
          data: pts.map(p => ({ x: p.ts, y: p.in_progress })),
          borderColor: C.actual,
          backgroundColor: 'rgba(88, 166, 255, 0.4)',
          fill: '-1',
          stepped: 'before',
          pointRadius: 0,
          tension: 0
        },
        {
          label: 'Backlog',
          data: pts.map(p => ({ x: p.ts, y: p.backlog })),
          borderColor: C.muted,
          backgroundColor: 'rgba(110, 118, 129, 0.3)',
          fill: '-1',
          stepped: 'before',
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: opts
  });
}

export function drawGantt(canvas, data, prevChart) {
  if (prevChart) prevChart.destroy();
  if (!data || !data.rows?.length) {
    drawEmpty(canvas, '尚无需求 — 注册 PRD 后会显示甘特图');
    return null;
  }

  const rows = data.rows;
  const labels = rows.map(r => `${r.id}  ${truncate(r.title, 18)}`);
  const actualBars = rows.map(r => ({
    x: [r.start, r.end],
    y: `${r.id}  ${truncate(r.title, 18)}`,
    status: r.status,
    progress: r.progress,
    actualTokens: r.actualTokens
  }));
  const estBars = rows.map(r => r.estEnd ? ({
    x: [r.estStart, r.estEnd],
    y: `${r.id}  ${truncate(r.title, 18)}`,
    estHours: r.estHours
  }) : null).filter(Boolean);

  const statusColor = (s) => s === 'done' ? C.done : s === 'in_progress' ? C.actual : C.muted;

  const opts = baseOpts();
  opts.indexAxis = 'y';
  opts.plugins.title = {
    display: true,
    text: '需求时间轴 — 实际工期 vs 估算工期',
    color: C.text,
    font: { size: 13, weight: '500' }
  };
  opts.scales = {
    x: {
      type: 'time',
      time: { tooltipFormat: 'MMM d, HH:mm' },
      grid: { color: C.grid },
      ticks: { color: C.muted, font: { size: 10 } }
    },
    y: {
      grid: { color: C.grid, display: false },
      ticks: { color: C.text, font: { size: 11, family: 'ui-monospace, SFMono-Regular, Menlo' } }
    }
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const d = ctx.raw;
      if (d.estHours != null) return `估算上界工期: ${d.estHours} h`;
      const start = new Date(d.x[0]).toLocaleString();
      const end = new Date(d.x[1]).toLocaleString();
      const dur = (new Date(d.x[1]) - new Date(d.x[0])) / 3_600_000;
      return [
        `状态: ${d.status}`,
        `进度: ${d.progress}%`,
        `实际 token: ${fmtK(d.actualTokens)}`,
        `开始: ${start}`,
        `结束: ${end}`,
        `工期: ${dur.toFixed(1)} h`
      ];
    }
  };

  const ctx = canvas.getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '估算上界工期',
          data: estBars,
          backgroundColor: 'rgba(210, 153, 34, 0.18)',
          borderColor: 'rgba(210, 153, 34, 0.4)',
          borderWidth: 1,
          borderSkipped: false,
          barPercentage: 0.95,
          categoryPercentage: 0.85
        },
        {
          label: '实际工期',
          data: actualBars,
          backgroundColor: actualBars.map(b => statusColor(b.status)),
          borderColor: actualBars.map(b => statusColor(b.status)),
          borderWidth: 0,
          borderSkipped: false,
          barPercentage: 0.55,
          categoryPercentage: 0.85
        }
      ]
    },
    options: opts
  });
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function drawEmpty(canvas, message) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.muted;
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, w / 2, h / 2);
}

function fmtK(n) {
  if (n == null || isNaN(n)) return '0';
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
}
