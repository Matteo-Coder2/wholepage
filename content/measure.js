// Measurement + scroller election.
// The #1 cause of "captures only the viewport" reviews is assuming window scrolls.
// On app shells (ChatGPT, Notion, dashboards) the real scroller is an inner
// overflow element — elect it instead of shrugging (pain #9).
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['measure']) return;

  const MAX_ELECTION_SCAN = 15000; // element cap so election stays O(bounded) on huge DOMs

  function electScroller() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 2) return 'window';

    const vpArea = window.innerWidth * window.innerHeight;
    let best = null;
    let bestArea = 0;
    const all = document.querySelectorAll('*');
    const n = Math.min(all.length, MAX_ELECTION_SCAN);
    for (let i = 0; i < n; i++) {
      const el = all[i];
      if (el.scrollHeight <= el.clientHeight + 2 || el.clientHeight < 50) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const r = el.getBoundingClientRect();
      const visW = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const visH = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      const area = Math.max(0, visW) * Math.max(0, visH);
      if (area > bestArea) { bestArea = area; best = el; }
    }
    // Only trust an inner scroller that dominates the viewport; otherwise the
    // window (static page) is the honest answer.
    if (best && bestArea > vpArea * 0.5) return best;
    return 'window';
  }

  wp.on('measure', () => {
    const scroller = electScroller();
    wp.state.scroller = scroller;
    wp.state.startScrollY = wp.getScrollY();
    wp.state.startWindowScrollY = window.scrollY || 0;
    wp.state.startScrollX = window.scrollX || 0;

    const se = document.scrollingElement || document.documentElement;
    const isWindow = scroller === 'window';
    const rect = isWindow ? null : scroller.getBoundingClientRect();
    return {
      scroller: isWindow ? 'window' : 'element',
      scrollerRect: rect ? { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right } : null,
      // clientHeight, NOT innerHeight: innerHeight includes a horizontal
      // scrollbar, which would otherwise be stamped into every stitch seam.
      viewportCss: isWindow ? se.clientHeight : scroller.clientHeight,
      pageViewportCss: window.innerHeight,
      totalCss: isWindow ? se.scrollHeight : scroller.scrollHeight,
      clientWidthCss: se.clientWidth,
      scrollWidthCss: se.scrollWidth,
      innerWidthCss: window.innerWidth,
      dpr: window.devicePixelRatio || 1,
      title: document.title || location.hostname,
      url: location.href,
    };
  });
})();
