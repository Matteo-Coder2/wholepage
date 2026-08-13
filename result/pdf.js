// Minimal dependency-free PDF writer: JPEG pages via DCTDecode.
// Written in-house so the package ships zero third-party code (CWS remote-code
// rules + reviewability) and PDFs carry no vendor branding or hijacked links
// (FireShot's two most-hated PDF behaviors, pain #12).
'use strict';

/* exported WPPdf */
const WPPdf = (() => {
  const enc = new TextEncoder();

  /**
   * @param {Array<{jpeg: Uint8Array, wPx: number, hPx: number, wPt: number, hPt: number}>} pages
   * @returns {Blob}
   */
  function build(pages) {
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (bytes) => {
      chunks.push(bytes);
      pos += bytes.length;
    };
    const pushStr = (s) => push(enc.encode(s));
    const beginObj = (n) => { offsets[n] = pos; pushStr(`${n} 0 obj\n`); };

    pushStr('%PDF-1.4\n%âãÏÓ\n');

    // Object numbering: 1 catalog, 2 pages tree, then per page i:
    // (3+3i) page, (4+3i) contents, (5+3i) image.
    const pageObj = (i) => 3 + 3 * i;
    const contObj = (i) => 4 + 3 * i;
    const imgObj = (i) => 5 + 3 * i;
    const total = 2 + 3 * pages.length;

    beginObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    beginObj(2);
    const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
    pushStr(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

    pages.forEach((p, i) => {
      const w = p.wPt.toFixed(2);
      const h = p.hPt.toFixed(2);
      beginObj(pageObj(i));
      pushStr(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${imgObj(i)} 0 R >> >> ` +
        `/Contents ${contObj(i)} 0 R >>\nendobj\n`
      );

      const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
      const cBytes = enc.encode(content);
      beginObj(contObj(i));
      pushStr(`<< /Length ${cBytes.length} >>\nstream\n`);
      push(cBytes);
      pushStr('\nendstream\nendobj\n');

      beginObj(imgObj(i));
      pushStr(
        `<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${p.jpeg.length} >>\nstream\n`
      );
      push(p.jpeg);
      pushStr('\nendstream\nendobj\n');
    });

    const xrefPos = pos;
    pushStr(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let n = 1; n <= total; n++) {
      pushStr(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
    }
    pushStr(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  return { build };
})();
