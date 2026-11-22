import fs from "node:fs";
// reader với prop THÔ (giữ S/I/L)
function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 27; const len = buf.length;
  const rp = (end) => {
    if (off >= end) return null;
    const t = String.fromCharCode(buf[off]);
    if (t === "Y") { const v = dv.getInt16(off + 1, true); off += 3; return v; }
    if (t === "C") { const v = buf[off + 1]; off += 2; return v; }
    if (t === "I") { const v = dv.getInt32(off + 1, true); off += 5; return v; }
    if (t === "F") { const v = dv.getFloat32(off + 1, true); off += 5; return v; }
    if (t === "D") { const v = dv.getFloat64(off + 1, true); off += 9; return v; }
    if (t === "L") { const v = Number(dv.getBigInt64(off + 1, true)); off += 9; return v; }
    if (t === "S") { const n = dv.getUint32(off + 1, true); const s = buf.subarray(off + 5, off + 5 + n).toString("utf8"); off += 5 + n; return s; }
    if (t === "R") { const n = dv.getUint32(off + 1, true); off += 5 + n; return "<raw>"; }
    if ("fdlibc".indexOf(t) >= 0) { const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true); const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n; off += 13 + (enc === 0 ? size : clen); return "<" + t + "[" + n + "]>"; }
    off += 1; return "<" + t + ">";
  };
  const rn = (limit) => {
    if (off + 13 > limit) return null;
    const start = off, end = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
    if (end < start || end > limit) return null;
    const name = buf.subarray(off + 13, off + 13 + nlen).toString("utf8");
    off += 13 + nlen;
    const propsEnd = off + plen;
    const props = [];
    for (let i = 0; i < nprops && off < propsEnd; i++) props.push(rp(propsEnd));
    off = propsEnd;
    const children = [];
    while (off < end) { const c = rn(end); if (!c) break; children.push(c); }
    if (off < end) off = end;
    return { name, props, children };
  };
  const nodes = [];
  while (off < len - 16) { const n = rn(len - 16); if (!n) break; nodes.push(n); }
  return nodes;
}

const file = process.argv[2] || "assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx";
const nodes = parse(fs.readFileSync(file));
const objs = nodes.find(n => n.name === "Objects");
const conn = nodes.find(n => n.name === "Connections");
const nameOf = {};
if (objs) objs.children.forEach(c => { nameOf[c.props[0]] = (c.name + "::" + String(c.props[1]).replace(/^\w+::/, "")); });
const rows = conn ? conn.children.filter(c => c.name === "C").map(c => ({ t: c.props[0], a: c.props[1], b: c.props[2] })) : [];
// các connection liên quan Deformer / Pose / Model
const interesting = rows.filter(r => /Deformer|Pose/.test(nameOf[r.a] || "") || /Deformer|Pose/.test(nameOf[r.b] || ""));
console.log("tổng connection:", rows.length, "| liên quan Deformer/Pose:", interesting.length);
console.log("--- mẫu 14 ---");
interesting.slice(0, 14).forEach(r => console.log("  ", r.t, (nameOf[r.a] || r.a), "->", (nameOf[r.b] || (r.b === 0 ? "ROOT" : r.b))));
// đếm kiểu cha của Deformer
const parents = {};
interesting.forEach(r => { if (/Deformer::/.test(nameOf[r.a] || "")) { const k = (nameOf[r.b] || String(r.b)).split("::")[0]; parents[k] = (parents[k] || 0) + 1; } });
console.log("Deformer là child của:", JSON.stringify(parents));
// Model:: name mẫu (bones) + Mesh model tên gì
const models = (objs ? objs.children : []).filter(c => c.name === "Model");
console.log("Model count:", models.length);
console.log("Mesh model:", models.filter(m => m.props[2] === "Mesh").map(m => [m.props[0], m.props[1], m.props[2]]).slice(0, 2));
console.log("LimbNode mẫu:", models.filter(m => m.props[2] === "LimbNode").map(m => m.props[1]).slice(0, 6));
