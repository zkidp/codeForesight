// 浏览器端：语言 + 主题切换
(function () {
  const i18n = window.__I18N__ || { zh: {}, en: {} };
  let currentLang = window.__LANG__ || 'zh';
  let currentTheme = window.__THEME__ || 'dark';

  // CC 设 system 时按系统偏好判断
  if (currentTheme === 'system') {
    currentTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = currentTheme;
  document.documentElement.lang = currentLang;

  window.__T__ = function (key, params) {
    const dict = i18n[currentLang] || {};
    const fallback = i18n.zh || {};
    let s = dict[key] != null ? dict[key] : (fallback[key] != null ? fallback[key] : key);
    if (params) for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
    }
    return s;
  };

  function applyLang() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = window.__T__(key);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      el.innerHTML = window.__T__(key);
    });
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === currentLang);
    });
    // 通知图表层重新渲染（如果存在）
    if (typeof window.__rerenderCharts__ === 'function') window.__rerenderCharts__();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = currentTheme;
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === currentTheme);
    });
    if (typeof window.__rerenderCharts__ === 'function') window.__rerenderCharts__();
  }

  document.querySelectorAll('.lang-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentLang = b.dataset.lang;
      try { localStorage.setItem('codeforesight.lang', currentLang); } catch {}
      applyLang();
    });
  });
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentTheme = b.dataset.theme;
      try { localStorage.setItem('codeforesight.theme', currentTheme); } catch {}
      applyTheme();
    });
  });

  // 启动时从 localStorage 恢复偏好
  try {
    const savedLang = localStorage.getItem('codeforesight.lang');
    const savedTheme = localStorage.getItem('codeforesight.theme');
    if (savedLang === 'en' || savedLang === 'zh') currentLang = savedLang;
    if (savedTheme === 'dark' || savedTheme === 'light') currentTheme = savedTheme;
  } catch {}

  applyLang();
  applyTheme();
})();
