// Lazy-load priming pass (pain #5): scroll the real scroller bottom-to-top BEFORE
// capturing, with ADAPTIVE settles (not fixed sleeps), so native loading=lazy and
// IntersectionObserver content exists before the first tile is shot.
// Also detects infinite scroll (pain #9): scrollHeight growing while we prime.
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['prime']) return;

  const STEP_CAP_MS = 1500;   // per-step ceiling
  const PASS_CAP_MS = 20000;  // whole-pass ceiling — simple pages stay fast
  const QUIET_MS = 150;       // resource-network quiet window

  let lastResourceAt = 0;
  try {
    new PerformanceObserver(() => { lastResourceAt = Date.now(); })
      .observe({ type: 'resource', buffered: false });
  } catch (_) { /* observer unsupported: settle falls back to rAF+images */ }

  async function settleStep(deadline) {
    await wp.raf2();
    const stepDeadline = Math.min(Date.now() + STEP_CAP_MS, deadline);
    // Wait for the network to go quiet (new lazy fetches finish starting).
    while (Date.now() < stepDeadline) {
      if (Date.now() - lastResourceAt >= QUIET_MS) break;
      await wp.sleep(50);
    }
    await wp.imagesSettled(Math.max(0, stepDeadline - Date.now()));
  }

  wp.on('prime', async () => {
    const passDeadline = Date.now() + PASS_CAP_MS;
    let { total, viewport } = wp.scrollerHeights();
    let infinite = false;
    let prevTotal = total;
    let growthStreak = 0;

    // Scroll-lock probe: pages with a modal open (body overflow:hidden or a
    // scroll trap) report a tall scrollHeight but refuse to actually scroll —
    // without this check the capture would "succeed" as N identical tiles.
    if (total > viewport * 1.5) {
      wp.setScrollY(viewport);
      await wp.raf2();
      if (wp.getScrollY() < viewport * 0.25) {
        wp.setScrollY(viewport); // one retry — some pages settle layout late
        await wp.raf2();
        if (wp.getScrollY() < viewport * 0.25) {
          wp.setScrollY(0);
          return { totalCss: total, infinite: false, scrollLocked: true };
        }
      }
      wp.setScrollY(0);
      await wp.raf2();
    }

    let y = 0;
    while (y < total - viewport && Date.now() < passDeadline) {
      y += viewport;
      wp.setScrollY(y);
      await settleStep(passDeadline);
      ({ total } = wp.scrollerHeights());
      if (total - prevTotal > viewport) {
        if (++growthStreak >= 2) { infinite = true; break; } // page feeds itself: stop honestly
      } else {
        growthStreak = 0;
      }
      prevTotal = total;
    }

    // Back to the top; one settle so above-the-fold state is clean for tile 1.
    wp.setScrollY(0);
    await settleStep(Math.min(Date.now() + STEP_CAP_MS, passDeadline + STEP_CAP_MS));

    const finalTotal = wp.scrollerHeights().total;
    return { totalCss: infinite ? Math.min(finalTotal, total) : finalTotal, infinite };
  });
})();
