/* ============================================================
 * exporter/zip-writer.js — ZIP writer thuần JS (STORE method)
 * Đóng gói bundle: GLB + textures + manifest + screenshot.
 * ZIP hợp lệ 100% (uncompressed STORE — không cần thư viện ngoài).
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- DOS date/time ---------- */
  function dosDateTime(date) {
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: dosTime, date: dosDate };
  }

  const ZipWriter = {};

  /* files: [{ name: 'path/file.glb', data: Uint8Array }] */
  ZipWriter.create = function (files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, date } = dosDateTime();

    files.forEach(function (file) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);
      const entryOffset = offset;

      /* Local file header (30 bytes + name) */
      const lfh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);       // signature
      lv.setUint16(4, 20, true);               // version needed
      lv.setUint16(6, 0x0800, true);           // flags: UTF-8
      lv.setUint16(8, 0, true);                // method STORE
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);     // compressed size
      lv.setUint32(22, data.length, true);     // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lfh.set(nameBytes, 30);

      localParts.push(lfh, data);

      /* Central directory header */
      const cdh = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, entryOffset, true);
      cdh.set(nameBytes, 46);
      centralParts.push(cdh);

      offset += lfh.length + data.length;
    });

    const centralStart = offset;
    let centralSize = 0;
    centralParts.forEach(function (p) { centralSize += p.length; });

    /* End of central directory */
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);

    const total = centralStart + centralSize + 22;
    const out = new Uint8Array(total);
    let cur = 0;
    localParts.forEach(function (p) { out.set(p, cur); cur += p.length; });
    centralParts.forEach(function (p) { out.set(p, cur); cur += p.length; });
    out.set(eocd, cur);

    return new Blob([out], { type: 'application/zip' });
  };

  /* ---------- Convenience: dataURL → Uint8Array ---------- */
  ZipWriter.dataURLToBytes = function (dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  window.PixiStudio.ZipWriter = ZipWriter;
})();
