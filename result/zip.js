// Minimal dependency-free ZIP writer (STORE method, no compression — PNGs are
// already compressed). Used for the "PNG slices" oversize export choice (pain #8:
// never split silently, always the user's explicit pick).
'use strict';

/* exported WPZip */
const WPZip = (() => {
  const enc = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(v) { return new Uint8Array([v & 255, (v >> 8) & 255]); }
  function u32(v) { return new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]); }

  /**
   * @param {Array<{name: string, data: Uint8Array}>} files
   * @returns {Blob}
   */
  function build(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const push = (...parts) => { for (const p of parts) { chunks.push(p); offset += p.length; } };

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const localOffset = offset;
      push(
        u32(0x04034b50), u16(20), u16(0x0800 /* UTF-8 names */), u16(0 /* store */),
        u16(0), u16(0), // mod time/date: fixed zero (reproducible output)
        u32(crc), u32(f.data.length), u32(f.data.length),
        u16(name.length), u16(0), name, f.data
      );
      central.push({ name, crc, size: f.data.length, localOffset });
    }

    const centralStart = offset;
    for (const c of central) {
      push(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(c.localOffset), c.name
      );
    }
    const centralSize = offset - centralStart;
    push(
      u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length),
      u32(centralSize), u32(centralStart), u16(0)
    );

    return new Blob(chunks, { type: 'application/zip' });
  }

  return { build };
})();
