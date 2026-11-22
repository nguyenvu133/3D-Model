import { chromium } from "playwright-core";
import fs from "node:fs";
const b = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto((process.env.QA_BASE) + "/index.html", { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => window.THREE && THREE.FBXLoader, { timeout: 90000 });
const src = fs.readFileSync("Meshy_AI_tripo_convert_monter1_20261122_texture.fbx").toString("base64");
const r = await p.evaluate(async ({src}) => {
  const bin = atob(src); const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(u.buffer, "");
  const out = [];
  root.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material)?o.material[0]:o.material;
    out.push({ flipY_map: m.map ? m.map.flipY : null, wrapS: m.map ? m.map.wrapS : null, imgType: m.map && m.map.image ? (m.map.image.constructor && m.map.image.constructor.name) : null, imgW: m.map && m.map.image ? m.map.image.width : null, uvFlip: o.geometry.attributes.uv ? {u0:+o.geometry.attributes.uv.getX(0).toFixed(4), v0:+o.geometry.attributes.uv.getY(0).toFixed(4)} : null }); });
  return { tex: out, srcFormat: root.userData && root.userData.srcJson ? "fbx-json" : "binary", ud: Object.keys(root.userData||{}) };
}, {src});
console.log(JSON.stringify(r, null, 1));
await b.close();
