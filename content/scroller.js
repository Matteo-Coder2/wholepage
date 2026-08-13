// Tile positioning: scroll, confirm settled, report the ACTUAL position.
// Browsers clamp and fractionalize scroll offsets; the result page computes
// destination offsets from the read-back value, never the requested one —
// that is what eliminates the 1px double-edge seams (pain #16).
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['scroll-to']) return;

  wp.on('scroll-to', async (msg) => {
    wp.setScrollY(msg.y);
    await wp.raf2();
    if (msg.settle) {
      // Light re-check: priming already loaded content; this kills the residual
      // half-loaded-frame race right before the shot.
      await wp.imagesSettled(400);
      await wp.raf2();
    }
    return { actualY: wp.getScrollY() };
  });
})();
