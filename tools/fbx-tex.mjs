import fs from "node:fs";
function parseBinary(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 27; const len = buf.length;
  const rp = (end) => {
    if (off >= end) return null;
    const t = String.fromCharCode(buf[off]);
    if (t === "Y") { const v = dv.getInt16(off+1,true); off += 3; return v; }
    if (t === "C") { const v = buf[off+1]; off += 2; return v; }
    if (t === "I") { const v = dv.getInt32(off+1,true); off += 5; return v; }
    if (t === "F") { const v = dv.getFloat32(off+1,true); off += 5; return v; }
    if (t === "D") { const v = dv.getFloat64(off+1,true); off += 9; return v; }
    if (t === "L") { const v = Number(dv.getBigInt64(off+1,true)); off += 9; return v; }
    if (t === "S") { const n = dv.getUint32(off+1,true); const s = buf.subarray(off+5, off+5+n).toString("utf8"); off += 5+n; return s; }
    if (t === "R") { const n = dv.getUint32(off+1,true); const raw = buf.subarray(off+5, off+5+n); off += 5+n; return { raw: n, head: raw.subarray(0,12).toString("hex") }; }
    if ("fdlibc".indexOf(t) >= 0) { const n = dv.getUint32(off+1,true), enc = dv.getUint32(off+5,true), clen = dv.getUint32(off+9,true); const size = { f:4,d:8,l:8,i:4,b:1,c:1 }[t]*n; const o = off+13; off += 13 + (enc===0?size:clen); return { arr: t, n, dataOff: o }; }
    off += 1; return "<" + t + ">";
  };
  const rn = (limit) => {
    if (off + 13 > limit) return null;
    const start = off, end = dv.getUint32(off,true), nprops = dv.getUint32(off+4,true), plen = dv.getUint32(off+8,true), nlen = buf[off+12];
    if (end===0 && nprops===0 && plen===0 && nlen===0) { off += 13; return null; }
    if (end < start || end > limit) return null;
    const name = buf.subarray(off+13, off+13+nlen).toString("utf8");
    off += 13 + nlen;
    const propsEnd = off + plen; const props = [];
    for (let i=0;i<nprops && off<propsEnd;i++) props.push(rp(propsEnd));
    off = propsEnd;
    const children = [];
    while (off < end) { const c = rn(end); if (!c) break; children.push(c); }
    if (off < end) off = end;
    return { name, props, children };
  };
  const nodes = [];
  while (off < len-16) { const n = rn(len-16); if (!n) break; nodes.push(n); }
  return nodes;
}
const file = process.argv[2];
const nodes = parseBinary(fs.readFileSync(file));
const objs = nodes.find(n=>n.name==="Objects");
const conn = nodes.find(n=>n.name==="Connections");
console.log("--- Video nodes chi tiết ---");
(objs.children||[]).filter(c=>c.name==="Video").forEach((v,i)=>{
  console.log("video["+i+"]", JSON.stringify(v.props));
  v.children.forEach(ch=>console.log("   ", ch.name, JSON.stringify(ch.props).slice(0,120)));
});
console.log("--- Texture nodes ---");
(objs.children||[]).filter(c=>c.name==="Texture").forEach((t,i)=>{
  console.log("tex["+i+"]", JSON.stringify(t.props));
  t.children.forEach(ch=>console.log("   ", ch.name, JSON.stringify(ch.props).slice(0,80)));
});
console.log("--- Connection của Texture (type + property) ---");
const nameOf={}; (objs.children||[]).forEach(c=>{ nameOf[c.props[0]] = String(c.props[1]||"").replace(/\u0000.*$/,""); });
(conn.children||[]).filter(c=>c.name==="C").forEach(c=>{
  const a = nameOf[c.props[1]]||c.props[1], b = nameOf[c.props[2]]||c.props[2];
  if (/texture|video|material/i.test(String(a)+String(b)) || c.props[3]!==undefined) {
    console.log("  C:", c.props[0], "|", a, "->", b, "| prop:", JSON.stringify(c.props[3]));
  }
});
