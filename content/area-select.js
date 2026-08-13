// Drag-select area capture overlay. The overlay is page content, so it is fully
// removed (and two frames are awaited) before the shot — nothing of ours may
// ever appear in a capture (competitor 1-star: "includes the darkened screen").
(() => {
  const wp = globalThis.__wp;
  if (!wp || wp.handlers['area-select']) return;

  wp.on('area-select', () => new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .shade{position:fixed;background:rgba(0,0,0,.35);pointer-events:none;}
        .box{position:fixed;border:1.5px solid #2dd4a7;background:transparent;pointer-events:none;display:none;}
        .tip{position:fixed;top:12px;left:50%;transform:translateX(-50%);
             font:13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(20,24,22,.92);
             padding:6px 14px;border-radius:999px;pointer-events:none;}
      </style>
      <div class="shade" id="s0"></div><div class="shade" id="s1"></div>
      <div class="shade" id="s2"></div><div class="shade" id="s3"></div>
      <div class="box" id="box"></div>
      <div class="tip">Drag to select an area — Esc to cancel</div>`;
    document.documentElement.appendChild(host);

    const box = root.getElementById('box');
    const shades = [0, 1, 2, 3].map((i) => root.getElementById('s' + i));
    const setShades = (r) => {
      const W = innerWidth; const H = innerHeight;
      const cs = [
        { l: 0, t: 0, w: W, h: r.y },
        { l: 0, t: r.y, w: r.x, h: r.h },
        { l: r.x + r.w, t: r.y, w: W - r.x - r.w, h: r.h },
        { l: 0, t: r.y + r.h, w: W, h: H - r.y - r.h },
      ];
      shades.forEach((el, i) => {
        el.style.left = cs[i].l + 'px'; el.style.top = cs[i].t + 'px';
        el.style.width = Math.max(0, cs[i].w) + 'px'; el.style.height = Math.max(0, cs[i].h) + 'px';
      });
    };
    setShades({ x: 0, y: 0, w: 0, h: 0 });
    shades[0].style.cssText += `left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;`;

    let sx = 0; let sy = 0; let dragging = false;
    const rect = () => ({
      x: Math.min(sx, cx), y: Math.min(sy, cy),
      w: Math.abs(cx - sx), h: Math.abs(cy - sy),
    });
    let cx = 0; let cy = 0;

    const finish = async (result) => {
      window.removeEventListener('keydown', onKey, true);
      host.remove();
      await wp.raf2(); // overlay must be out of the compositor before the shot
      await wp.sleep(60);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish({ cancelled: true }); }
    };
    window.addEventListener('keydown', onKey, true);

    host.addEventListener('mousedown', (e) => {
      dragging = true; sx = cx = e.clientX; sy = cy = e.clientY;
      box.style.display = 'block';
      e.preventDefault();
    });
    host.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      cx = e.clientX; cy = e.clientY;
      const r = rect();
      box.style.left = r.x + 'px'; box.style.top = r.y + 'px';
      box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
      setShades(r);
    });
    host.addEventListener('mouseup', () => {
      if (!dragging) return;
      const r = rect();
      if (r.w < 4 || r.h < 4) { finish({ cancelled: true }); return; }
      finish({ ...r, innerWidth: window.innerWidth }); // result page derives scale from this
    });
  }));
})();
