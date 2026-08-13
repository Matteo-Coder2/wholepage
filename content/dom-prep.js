// DOM preparation: animation freeze, fixed/sticky neutralization, full restore.
//
// Fixed elements are viewport-anchored, so scroll-and-stitch stamps them into
// every tile ("a fence down the page"). Strategy, hardened by adversarial review:
// - position:sticky  → UNSTUCK (position:static inline) — hiding them blanks
//   in-flow content like sticky sidebars/TOCs; unsticking keeps them exactly
//   once, at their natural place in the flow.
// - position:fixed   → visible in tile 1 only, then hidden. Bottom-anchored
//   bars (cookie banners, chat bubbles) are hidden from tile 0.
// - fixed/sticky inside a transformed/filtered ancestor scroll WITH the content
//   (containing-block rules) — they are normal content and must NOT be touched.
// - All changes are INLINE styles with !important: document-level stylesheets
//   cannot reach into shadow roots, and visibility:hidden on an ancestor is
//   defeated by any descendant declaring its own visibility:visible; inline
//   visibility + clip-path survives both.
// - hide-fixed re-scans the DOM: many sites swap in a fixed header only after
//   scrolling starts, so a single walk at the top of the page misses them.
// EVERYTHING is restored afterwards — capture must never leave a mark.
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['freeze']) return;

  const FREEZE_ID = '__wp-freeze';
  const MAX_WALK = 20000;
  const processed = new WeakSet();
  const mods = []; // {el, prop, prev, prevPriority}

  function setImportant(el, props) {
    for (const [prop, val] of props) {
      mods.push({ el, prop, prev: el.style.getPropertyValue(prop), prevPriority: el.style.getPropertyPriority(prop) });
      el.style.setProperty(prop, val, 'important');
    }
  }

  const HIDE = [['visibility', 'hidden'], ['clip-path', 'inset(100%)']];
  const UNSTICK = [['position', 'static']];

  wp.on('freeze', () => {
    wp.injectStyle(
      `*,*::before,*::after{animation-play-state:paused!important;transition:none!important;scroll-snap-type:none!important;}` +
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

  // position:fixed/sticky inside a transformed/filtered/perspective ancestor is
  // containing-block-relative — it scrolls with the page and is normal content.
  function hasTransformedAncestor(el) {
    let a = el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
    while (a && a !== document.documentElement) {
      let cs;
      try { cs = getComputedStyle(a); } catch (_) { return false; }
      if (
        cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' ||
        (cs.backdropFilter && cs.backdropFilter !== 'none') ||
        (cs.willChange && /transform|perspective|filter/.test(cs.willChange))
      ) return true;
      a = a.parentElement || (a.getRootNode() instanceof ShadowRoot ? a.getRootNode().host : null);
    }
    return false;
  }

  // hideNewFixed=false: first pass (before tile 0) — sticky unstuck, bottom bars
  // hidden, top/floating fixed recorded for hiding after tile 1.
  // hideNewFixed=true: later passes — any not-yet-seen fixed element appeared
  // only because of scrolling, so it is hidden immediately.
  function scan(hideNewFixed) {
    let found = 0;
    for (const el of walkAll(document.documentElement)) {
      if (processed.has(el)) continue;
      let pos;
      try { pos = getComputedStyle(el).position; } catch (_) { continue; }
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (hasTransformedAncestor(el)) { processed.add(el); continue; } // normal content
      processed.add(el);
      found++;
      if (pos === 'sticky') {
        setImportant(el, UNSTICK); // appears once, at its natural flow position
      } else if (hideNewFixed || r.top > window.innerHeight * 0.6) {
        setImportant(el, HIDE); // bottom bars + scroll-swapped headers: never in output
      } else {
        wp.state.fixedEls.push(el); // in tile 1 once, hidden afterwards
      }
    }
    return found;
  }

  // Runs AFTER the priming pass, page back at top, BEFORE tile 0.
  wp.on('mark-fixed', () => ({ found: scan(false) }));

  // Called after tile 1 is captured: hide the recorded fixed elements and
  // re-scan for ones that appeared mid-scroll.
  wp.on('hide-fixed', () => {
    for (const el of wp.state.fixedEls) setImportant(el, HIDE);
    wp.state.fixedEls = [];
    // A modal <dialog>'s ::backdrop is a separate top-layer box that element
    // styles cannot reach — without this rule it dims every remaining tile.
    wp.injectStyle('dialog::backdrop{visibility:hidden!important;}', '__wp-hide-backdrop');
    return { late: scan(true) };
  });

  wp.on('restore', () => {
    for (const el of wp.state.styleEls) { try { el.remove(); } catch (_) {} }
    wp.state.styleEls = [];
    for (let i = mods.length - 1; i >= 0; i--) {
      const m = mods[i];
      try {
        if (m.prev) m.el.style.setProperty(m.prop, m.prev, m.prevPriority);
        else m.el.style.removeProperty(m.prop);
      } catch (_) {}
    }
    mods.length = 0;
    wp.state.fixedEls = [];
    for (const v of wp.state.pausedVideos) { try { v.play(); } catch (_) {} }
    wp.state.pausedVideos = [];
    try {
      wp.setScrollY(wp.state.startScrollY);
      if (wp.state.scroller !== 'window') window.scrollTo(wp.state.startScrollX || 0, wp.state.startWindowScrollY || 0);
      else window.scrollTo(wp.state.startScrollX || 0, wp.state.startScrollY);
    } catch (_) {}
    return {};
  });
})();
