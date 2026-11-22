import fs from "node:fs";
const file = process.argv[2] || "docs/m2m-v10/sample-export.fbx";
const buf = fs.readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 27;
const log = [];
function readProp() {
  const t = String.fromCharCode(buf[off]);
  if (t === "Y") { off += 3; return "<Y>"; }
  if (t === "C") { off += 2; return "<C>"; }
  if (t === "I") { off += 5; return "<I>"; }
  if (t === "F") { off += 5; return "<F>"; }
  if (t === "D") { off += 9; return "<D>"; }
  if (t === "L") { off += 9; return "<L>"; }
  if (t === "S") { const n = dv.getUint32(off + 1, true); off += 5 + n; return "<S:" + n + ">"; }
  if (t === "R") { const n = dv.getUint32(off + 1, true); off += 5 + n; return "<R>"; }
  if ("fdlibc".indexOf(t) >= 0) {
    const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
    const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n;
    off += 13 + (enc === 0 ? size : clen);
    return "<" + t + "[" + n + "]>";
  }
  // không nhận ra type
  log.push("UNKNOWN prop type at " + (off - 1) + ": " + JSON.stringify(String.fromCharCode(t)));
  off += 1;
  return "<" + t + ">";
}
function readNode(depth) {
  if (off + 13 > buf.length) return null;
  const start = off;
  const end = dv.getUint32(off), nprops = dv.getUint32(off + 4), plen = dv.getUint32(off + 8), nlen = buf[off + 12];
  if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
  const name = buf.subarray(off + 13, off + 13 + nlen).toString("utf8");
  off += 13 + nlen;
  const propsEnd = off + plen;
  const props = [];
  for (let i = 0; i < nprops; i++) props.push(readProp());
  if (off !== propsEnd) log.push("PROP MISMATCH '" + name + "' start=" + start + " propsEnd=" + propsEnd + " got=" + off + " nprops=" + nprops);
  if (log.length < 12) log.push(" ".repeat(depth) + name + " [" + start + ".." + end + "] props=" + nprops + " " + props.join(","));
  const children = [];
  while (off < end) { const c = readNode(depth + 1); if (!c) break; children.push(c); }
  if (off !== end) { log.push("END MISMATCH '" + name + "' expected=" + end + " got=" + off); off = end; }
  return { name, props, children };
}
const nodes = [];
while (off < buf.length - 16) { const n = readNode(0); if (!n) break; nodes.push(n); }
console.log("parsed top nodes:", nodes.map(n => n.name).join(", "));
console.log("final off=", off, "fileLen=", buf.length);
console.log(log.slice(0, 40).join("\n"));
