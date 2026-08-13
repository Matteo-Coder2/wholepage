// DOM preparation: animation freeze, fixed/sticky neutralization, full restore.
//
// Fixed/sticky elements are viewport-anchored, so scroll-and-stitch stamps them
// into every tile ("a fence down the page" — pain #4). Fix: visible in tile 1
// only, hidden (visibility, NOT display — layout must not reflow) afterwards.
// Bottom-anchored bars (cookie banners, chat bubbles) are suppressed entirely.
// EVERYTHING is restored afterwards — capture must never leave a mark on the page.
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['freeze']) return;

  const FREEZE_ID = '__wp-freeze';
  const HIDE_ID = '__wp-hide-fixed';
  const HIDE_BOTTOM_ID = '__wp-hide-bottom';
  const MAX_WALK = 20000;

  wp.on('freeze', () => {
    wp.injectStyle(
      `*,*::before,*::after{animation-play-state:paused!important;transition:none!important;}` +
      `html{scroll-behavior:auto!important;overflow-anchor:none!important;}`,
      FREEZE_ID
    );
    for (const v of document.querySelectorAll('video')) {
      if (!v.paused) { wp.state.pausedVideos.push(v); try { v.pause(); } catch (_) {} }
    }
    return {};
  });

  function* walkAll(root) {
    let count = 0;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      let el = walker.currentNode.nodeType === 1 ? walker.currentNode : walker.nextNode();
      while (el) {
        if (++count > MAX_WALK) return;
        yield el;
        if (el.shadowRoot) stack.push(el.shadowRoot); // open shadow roots too
        el = walker.nextNode();
      }
    }
  }

  // Run AFTER the priming pass: many sites swap in a fixed header only once
  // scrolling starts, so a load-time-only walk misses it.
  wp.on('mark-fixed', () => {
    let fixed = 0;
    let bottom = 0;
    for (const el of walkAll(document.documentElement)) {
      let pos;
      try { pos = getComputedStyle(el).position; } catch (_) { continue; }
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const isBottomBar = pos === 'fixed' && r.top > window.innerHeight * 0.6;
      el.setAttribute(isBottomBar ? 'data-wp-fixed-bottom' : 'data-wp-fixed', '');
      wp.state.fixedEls.push(el);
      isBottomBar ? bottom++ : fixed++;
    }
    // Bottom bars never belong in the output: hidden from tile 0 onwards.
    wp.injectStyle(`[data-wp-fixed-bottom]{visibility:hidden!important;}`, HIDE_BOTTOM_ID);
    return { fixed, bottom };
  });

  // Called after tile 1 is captured: headers appear exactly once, at the top.
  wp.on('hide-fixed', () => {
    wp.injectStyle(`[data-wp-fixed]{visibility:hidden!important;}`, HIDE_ID);
    return {};
  });

  wp.on('restore', () => {
    for (const el of wp.state.styleEls) { try { el.remove(); } catch (_) {} }
    wp.state.styleEls = [];
    for (const el of wp.state.fixedEls) {
      try { el.removeAttribute('data-wp-fixed'); el.removeAttribute('data-wp-fixed-bottom'); } catch (_) {}
    }
    wp.state.fixedEls = [];
    for (const v of wp.state.pausedVideos) { try { v.play(); } catch (_) {} }
    wp.state.pausedVideos = [];
    try {
      wp.setScrollY(wp.state.startScrollY);
      if (wp.state.scroller !== 'window') window.scrollTo(0, wp.state.startWindowScrollY || 0);
    } catch (_) {}
    return {};
  });
})();
