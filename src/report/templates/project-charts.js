// 项目报告所有图表绘制（支持主题切换 + i18n）
// 数据来自 window.__CODEPR_DATA__ = { burnup, cfd, calibration, gantt }
(function () {
  if (typeof Chart === 'undefined') return;
  const D = window.__CODEPR_DATA__ || {};
  const T = window.__T__ || (k => k);
  let charts = [];

  function colors() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    return {
      grid: v('--border-soft') || '#21262d',
      text: v('--text') || '#c9d1d9',
      muted: v('--text-muted') || '#8b949e',
      accent: v('--accent') || '#58a6ff',
      success: v('--success') || '#56d364',
      warning: v('--warning') || '#d29922',
      danger: v('--danger') || '#f85149',
      backlog: v('--text-dim') || '#6e7681',
      band: v('--band-warning') || 'rgba(210, 153, 34, 0.12)',
      bandSuccess: v('--band-success') || 'rgba(86, 211, 100, 0.06)',
      areaDone: v('--area-done') || 'rgba(86, 211, 100, 0.35)',
      areaProgress: v('--area-progress') || 'rgba(88, 166, 255, 0.4)',
      areaBacklog: v('--area-backlog') || 'rgba(110, 118, 129, 0.3)',
      bgElev: v('--bg-elev') || '#161b22'
    };
  }

  function fmtK(n) { if (n == null || isNaN(n)) return '0'; return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(Math.round(n)); }
  function truncate(s, n) { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

  function baseOpts() {
    const C = colors();
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: C.text, font: { size: 11 } } },
        tooltip: { backgroundColor: C.bgElev, borderColor: C.grid, borderWidth: 1, titleColor: C.text, bodyColor: C.text }
      },
      scales: {
        x: { type: 'time', grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 } } },
        y: { grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) } }
      }
    };
  }

  function destroyAll() {
    charts.forEach(c => { try { c.destroy(); } catch {} });
    charts = [];
  }

  function drawBurnup() {
    const canvas = document.getElementById('projectBurnup');
    if (!canvas || !D.burnup?.points?.length) return;
    const C = colors();
    const pts = D.burnup.points;
    const opts = baseOpts();
    opts.plugins.title = { display: true, text: T('chart.project_burnup.title'), color: C.text, font: { size: 13 } };
    opts.plugins.tooltip.callbacks = { label: ctx => `${ctx.dataset.label}: ${fmtK(ctx.parsed.y)} tok` };
    charts.push(new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: T('chart.project_burnup.scope_upper'), data: pts.map(p => ({ x: p.ts, y: p.scopeUpper })),
            borderColor: C.warning, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0,
            stepped: 'before', fill: '+1', backgroundColor: C.band },
          { label: T('chart.project_burnup.scope_lower'), data: pts.map(p => ({ x: p.ts, y: p.scopeLower })),
            borderColor: C.backlog, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0,
            stepped: 'before', fill: false },
          { label: T('chart.project_burnup.actual'), data: pts.map(p => ({ x: p.ts, y: p.actualTotal })),
            borderColor: C.accent, borderWidth: 2.5, pointRadius: 2, tension: 0.15, fill: false },
          { label: T('chart.project_burnup.completed'), data: pts.map(p => ({ x: p.ts, y: p.completedScope })),
            borderColor: C.success, borderWidth: 2, pointRadius: 1, stepped: 'before', fill: false }
        ]
      },
      options: opts
    }));
  }

  function drawCFD() {
    const canvas = document.getElementById('cfd');
    if (!canvas || !D.cfd?.points?.length) return;
    const C = colors();
    const pts = D.cfd.points;
    const opts = baseOpts();
    opts.scales.y.stacked = true;
    opts.scales.x.stacked = true;
    opts.plugins.title = { display: true, text: T('chart.cfd.title', { v: D.cfd.summary.maxInProgress }), color: C.text };
    charts.push(new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: T('dashboard.kanban.done'), data: pts.map(p => ({ x: p.ts, y: p.done })),
            borderColor: C.success, backgroundColor: C.areaDone, fill: 'origin', stepped: 'before', pointRadius: 0 },
          { label: T('dashboard.kanban.in_progress'), data: pts.map(p => ({ x: p.ts, y: p.in_progress })),
            borderColor: C.accent, backgroundColor: C.areaProgress, fill: '-1', stepped: 'before', pointRadius: 0 },
          { label: T('dashboard.kanban.backlog'), data: pts.map(p => ({ x: p.ts, y: p.backlog })),
            borderColor: C.backlog, backgroundColor: C.areaBacklog, fill: '-1', stepped: 'before', pointRadius: 0 }
        ]
      },
      options: opts
    }));
  }

  function drawCalibration() {
    const canvas = document.getElementById('calibration');
    if (!canvas) return;
    const C = colors();
    if (!D.calibration?.points?.length) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = C.muted; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(T('chart.calibration.empty'), w/2, h/2);
      return;
    }
    const data = D.calibration;
    const max = data.maxValue * 1.1;
    const inRange = data.points.filter(p => p.tokens.inRange);
    const outOfRange = data.points.filter(p => !p.tokens.inRange);
    const opts = baseOpts();
    opts.scales = {
      x: { type: 'linear', min: 0, max,
        title: { display: true, text: T('chart.calibration.x_axis'), color: C.muted, font: { size: 11 } },
        grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) } },
      y: { type: 'linear', min: 0, max,
        title: { display: true, text: T('chart.calibration.y_axis'), color: C.muted, font: { size: 11 } },
        grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 }, callback: v => fmtK(v) } }
    };
    opts.plugins.title = {
      display: true,
      text: T('chart.calibration.title', { n: data.summary.n, acc: data.summary.accuracy, ratio: data.summary.meanRatio, bias: data.summary.bias }),
      color: C.text
    };
    opts.plugins.tooltip.callbacks = {
      label: ctx => {
        const p = ctx.raw;
        if (!p.label) return '';
        return [`${p.label}`, `${T('chart.calibration.tooltip_est_mid')}: ${fmtK(p.x)} · ${T('chart.calibration.tooltip_actual')}: ${fmtK(p.y)}`, `${T('chart.calibration.tooltip_hit')}: ${p.inRange ? '✅' : '❌'}`];
      }
    };
    const toPoint = p => ({ x: p.tokens.mid, y: p.tokens.actual, label: `${p.id} ${p.title}`, inRange: p.tokens.inRange });
    charts.push(new Chart(canvas.getContext('2d'), {
      type: 'scatter',
      data: {
        datasets: [
          { label: T('chart.calibration.upper_band'), data: [{ x: 0, y: 0 }, { x: max, y: max * 1.5 }],
            type: 'line', borderColor: 'transparent', backgroundColor: C.bandSuccess, fill: '+1',
            pointRadius: 0, showLine: true, order: 99 },
          { label: T('chart.calibration.lower_band'), data: [{ x: 0, y: 0 }, { x: max, y: max * 0.5 }],
            type: 'line', borderColor: 'transparent', fill: false, pointRadius: 0, showLine: true, order: 99 },
          { label: T('chart.calibration.diagonal'), data: [{ x: 0, y: 0 }, { x: max, y: max }],
            type: 'line', borderColor: C.muted, borderWidth: 1.5, borderDash: [6, 4],
            pointRadius: 0, showLine: true, fill: false },
          { label: T('chart.calibration.in_range'), data: inRange.map(toPoint),
            backgroundColor: C.success, pointRadius: 6 },
          { label: T('chart.calibration.out_of_range'), data: outOfRange.map(toPoint),
            backgroundColor: C.danger, pointRadius: 6 }
        ]
      },
      options: opts
    }));
  }

  function drawGantt() {
    const canvas = document.getElementById('gantt');
    if (!canvas || !D.gantt?.rows?.length) return;
    const C = colors();
    const rows = D.gantt.rows;
    const labels = rows.map(r => `${r.id}  ${truncate(r.title, 18)}`);
    const statusColor = s => s === 'done' ? C.success : s === 'in_progress' ? C.accent : C.backlog;
    const actualBars = rows.map(r => ({ x: [r.start, r.end], y: `${r.id}  ${truncate(r.title, 18)}`, status: r.status, progress: r.progress }));
    const estBars = rows.map(r => r.estEnd ? ({ x: [r.estStart, r.estEnd], y: `${r.id}  ${truncate(r.title, 18)}`, estHours: r.estHours }) : null).filter(Boolean);
    const opts = baseOpts();
    opts.indexAxis = 'y';
    opts.plugins.title = { display: true, text: T('chart.gantt.title'), color: C.text };
    opts.scales = {
      x: { type: 'time', grid: { color: C.grid }, ticks: { color: C.muted, font: { size: 10 } } },
      y: { grid: { color: C.grid, display: false }, ticks: { color: C.text, font: { size: 11, family: 'ui-monospace, SFMono-Regular, Menlo' } } }
    };
    opts.plugins.tooltip.callbacks = {
      label: ctx => {
        const d = ctx.raw;
        if (d.estHours != null) return `${T('chart.gantt.tooltip_est_hours')}: ${d.estHours} h`;
        const dur = (new Date(d.x[1]) - new Date(d.x[0])) / 3_600_000;
        return [`${T('chart.gantt.tooltip_status')}: ${d.status}`, `${T('chart.gantt.tooltip_progress')}: ${d.progress}%`, `${T('chart.gantt.tooltip_duration')}: ${dur.toFixed(1)} h`];
      }
    };
    charts.push(new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: T('chart.gantt.estimate'), data: estBars,
            backgroundColor: C.band, borderColor: C.warning, borderWidth: 1, borderSkipped: false,
            barPercentage: 0.95, categoryPercentage: 0.85 },
          { label: T('chart.gantt.actual'), data: actualBars,
            backgroundColor: actualBars.map(b => statusColor(b.status)),
            borderColor: actualBars.map(b => statusColor(b.status)),
            borderWidth: 0, borderSkipped: false,
            barPercentage: 0.55, categoryPercentage: 0.85 }
        ]
      },
      options: opts
    }));
  }

  function drawAll() {
    destroyAll();
    drawBurnup();
    drawCFD();
    drawCalibration();
    drawGantt();
  }

  window.__rerenderCharts__ = drawAll;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', drawAll);
  } else {
    drawAll();
  }
})();
