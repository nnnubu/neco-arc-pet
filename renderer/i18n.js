// 渲染层 i18n 工具：经 preload 的 window.necoI18n 拉取语言表，应用静态文案并支持动态 t()
// 用法：
//   静态文案：HTML 元素加 data-i18n="key"（文本）、data-i18n-title="key"（title）、data-i18n-ph="key"（placeholder）
//   动态文案：NECO_I18N.t('key') / NECO_I18N.tFmt('key', {n: 3})
//   语言切换：NECO_I18N.onChange(cb)（主进程广播 i18n-change 后自动重新应用）
(function () {
  const api = window.necoI18n;
  const state = { lang: 'zh', dict: null };

  function t(key) {
    if (!state.dict) return key;
    const v = state.dict[state.lang] && state.dict[state.lang][key];
    if (v != null) return v;
    const z = state.dict.zh && state.dict.zh[key];
    return z != null ? z : key;
  }
  function tFmt(key, vars) {
    let s = t(key);
    if (vars) for (const k of Object.keys(vars)) s = s.split('${' + k + '}').join(String(vars[k]));
    return s;
  }

  // 应用静态文案：data-i18n / data-i18n-title / data-i18n-ph
  function apply() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n'));
      if (v != null && el.textContent !== v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-title'));
      if (v != null) el.setAttribute('title', v);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-ph'));
      if (v != null) el.setAttribute('placeholder', v);
    });
  }

  // 异步初始化：拉语言表 + 应用 + 注册变更监听
  async function init() {
    try {
      if (!api) return;
      const d = await api.get();
      if (d && d.dict) { state.lang = d.lang === 'en' ? 'en' : 'zh'; state.dict = d.dict; }
      apply();
      // 语言表加载完成后广播一次，让各面板 init() 之前用 t() 渲染的动态文案重刷为正确语言
      window.dispatchEvent(new CustomEvent('i18n-change', { detail: state.lang }));
      api.on((lang) => {
        state.lang = lang === 'en' ? 'en' : 'zh';
        apply();
        window.dispatchEvent(new CustomEvent('i18n-change', { detail: state.lang }));
      });
    } catch (e) {
      console.error('[i18n] init 失败:', e);
    }
  }

  window.NECO_I18N = { t, tFmt, apply, init, get lang() { return state.lang; } };
})();
