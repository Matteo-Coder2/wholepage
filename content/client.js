// WholePage content-script namespace + message router.
// Injected per capture via chrome.scripting under activeTab — never persistent,
// never on tabs the user didn't explicitly capture (trust architecture).
(() => {
  if (globalThis.__wp) return; // idempotent re-injection
  const wp = {
    handlers: Object.create(null),
    state: {
      scroller: null,        // 'window' | Element
      startScrollY: 0,
      pausedVideos: [],
      fixedEls: [],
      styleEls: [],
    },
    on(name, fn) { this.handlers[name] = fn; },
    raf2() {
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    injectStyle(css, id) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
      this.state.styleEls.push(el);
      return el;
    },
    // Scroll position of the elected scroller, in CSS px.
    getScrollY() {
      const s = this.state.scroller;
      return s === 'window' || !s ? (window.scrollY || 0) : s.scrollTop;
    },
    setScrollY(y) {
      const s = this.state.scroller;
      if (s === 'window' || !s) window.scrollTo(0, y);
      else s.scrollTop = y;
    },
    scrollerHeights() {
      const s = this.state.scroller;
      if (s === 'window' || !s) {
        const se = document.scrollingElement || document.documentElement;
        return { total: se.scrollHeight, viewport: window.innerHeight };
      }
      return { total: s.scrollHeight, viewport: s.clientHeight };
    },
    // Wait until in-viewport images are decoded (or a short cap elapses).
    async imagesSettled(capMs) {
      const deadline = Date.now() + capMs;
      const pending = [...document.images].filter((img) => {
        if (img.complete && img.naturalWidth > 0) return false;
        const r = img.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
      });
      for (const img of pending) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        await Promise.race([img.decode().catch(() => {}), this.sleep(Math.min(left, 300))]);
      }
    },
  };
  globalThis.__wp = wp;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.wp || !wp.handlers[msg.wp]) return false;
    Promise.resolve(wp.handlers[msg.wp](msg))
      .then((res) => sendResponse(res || {}))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // async response
  });
})();
