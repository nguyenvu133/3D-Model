/* ============================================================
 * rig/arp-vp-measure.js — PHẦN 7 "Đo đạc + tham chiếu trong
 * viewport" của vòng mở rộng Viewport (Auto Rig Pro Blend).
 *
 * Hiện số đo ngay trong viewport (nhãn sprite luôn quay về camera
 * + đường đo có vạch cuối), overlay tham chiếu T-pose/A-pose
 * (ghost lines mờ), đường mặt đất + lưới, đơn vị cm/m.
 *
 * NGUỒN SỐ ĐO (dùng lại, không đo lại từ đầu):
 *   • Model CHƯA rig: dùng AutoRigPro.measureLandmarks (cùng
 *     primitive với tab Smart) + công thức y hệt
 *     ArpSmart.computeMeasurements (cao = H; tay = |vai→cổ tay|
 *     thẳng; chân = groinY − groundY; vai = 2×shoulderWidth).
 *     Khi ArpSmart đã đo sẵn cho đúng model đó thì gọi thẳng
 *     ArpSmart.computeMeasurements() để khớp tuyệt đối.
 *   • Model ĐÃ rig: đo từ vị trí world của xương hiện tại
 *     (Hips/HeadTop_End/vai/tay/hông/chân). LƯU Ý: số đo khớp
 *     xương KHÁC số đo mặt mesh của Smart theo định nghĩa —
 *     vai-khớp Mixamo nằm sát cổ (~19cm trên Thiếu Lâm 1.8m)
 *     trong khi vai-mặt-mesh đo tới mặt ngoài delta (~46cm);
 *     tay/chân đo theo tư thế HIỆN TẠI (pose), không phải
 *     T-pose. Cao thì khớp nhau (HeadTop_End − đất).
 *   • Không rig, không đo được landmark: chỉ đo chiều cao từ
 *     bounding box mesh + báo "chưa có rig".
 *
 * NHÃN: THREE.Sprite + CanvasTexture nên luôn quay về camera
 * (như nhãn xương). Vẽ canvas có try/catch + guard từng hàm ctx
 * để chạy được cả khi canvas 2D không có thật (jsdom harness):
 * khi đó sprite vẫn tạo được, text lưu trong userData.text để
 * test đọc; trên trình duyệt thật thì vẽ pill + chữ bình thường.
 *
 * LƯỚI: KHÔNG tạo GridHelper mới — bật/tắt qua
 * PixiStudio.GridEnv.setVisible (grid đã có trong viewport).
 * Đường mặt đất là Line riêng của module tại y = groundY.
 *
 * ĐĂNG KÝ LAYER (defensive): nếu window.PixiStudio.ArpViewport
 * tồn tại và có registerLayer thì đăng ký 'measure' + 'reference';
 * nếu chưa có thì chỉ expose PixiStudio.ArpVpMeasure để
 * toolbar/preset gọi show()/hide()/refresh()/setPose()/setUnit().
 *
 * CHỈ MỞ RỘNG — không sửa file ARP hiện có, không sửa model test.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var LABEL_COLORS = {
    height: 0xffd166, armLeft: 0xef476f, armRight: 0xef476f,
    legLeft: 0x4cc9f0, legRight: 0x4cc9f0, shoulder: 0x7b61ff,
    ground: 0x2ee6a8, status: 0xff9f1c
  };
  var LABEL_TITLES = {
    height: 'Cao', armLeft: 'Tay trái', armRight: 'Tay phải',
    legLeft: 'Chân trái', legRight: 'Chân phải', shoulder: 'Vai'
  };
  /* Xương lõi cho overlay tham chiếu (bỏ ngón tay/twist cho đỡ rối). */
  var REF_BONES = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'
  ];
  var NEEDED_BONES = ['Hips', 'LeftShoulder', 'RightShoulder', 'LeftHand',
    'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftFoot', 'RightFoot'];

  var ArpVpMeasure = {
    visible: false,
    measureVisible: true,
    refVisible: false,
    refPose: 'T',            /* 'T' | 'A' */
    unit: 'cm',              /* 'cm' | 'm' */
    groundVisible: true,
    gridVisible: true,
    measurements: null,      /* kết quả đo lần cuối (xem measure()) */
    landmarks: null,
    target: null,
    group: null,             /* Group chứa đường đo + nhãn + đường đất */
    refGroup: null,          /* Group overlay T/A-pose */
    groundLine: null,
    labels: {},              /* id -> THREE.Sprite */
    lines: {}                /* id -> THREE.Line/LineSegments */
  };

  function notify(type, title, message, duration) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  function getScene() {
    if (PixiStudio.Viewport && PixiStudio.Viewport.scene) return PixiStudio.Viewport.scene;
    return null;
  }

  function getCamera() {
    if (PixiStudio.Viewport && PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.camera) return PixiStudio.Viewport.orbit.camera;
    return null;
  }

  function getTarget(target) {
    if (target) return target;
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) return PixiStudio.Viewport.getMainModel();
    return null;
  }

  /* ---------- Tên xương chuẩn hoá ----------
     FBXLoader r128 lược dấu ':' (mixamorig:Hips → mixamorigHips),
     file khác có thể giữ 'mixamorig:Hips' hoặc 'Model:mixamorig:Hips'.
     Chuẩn hoá: bỏ hết tới ':' cuối, rồi bỏ tiền tố 'mixamorig'. */
  function normalizeBoneName(name) {
    var n = String(name || '');
    var idx = n.lastIndexOf(':');
    if (idx >= 0) n = n.slice(idx + 1);
    n = n.replace(/^mixamorig/, '');
    return n;
  }
  ArpVpMeasure._normalizeBoneName = normalizeBoneName;

  function collectBones(target) {
    var map = {};
    if (!target || !target.traverse) return map;
    target.traverse(function (o) {
      if (!o.isBone) return;
      var n = normalizeBoneName(o.name);
      if (n && !map[n]) map[n] = o;
    });
    return map;
  }

  function collectMeshes(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isArpMarker || o.userData.isArpGhost || o.userData.isBoneVisual ||
          o.userData.isArpMeasure || o.userData.isArpReference)) return;
      /* CỐ TÌNH KHÔNG loại mesh có userData.skipSkin: skipSkin chỉ nghĩa là
         "mesh này đã được skin" (AutoRigPro tạo SkinnedMesh với cờ này,
         auto-rig-pro.js:758) — nó VẪN là mesh nhân vật thật. Loại nó thì
         đo đạc trên model vừa rig xong sẽ báo "Model rỗng" (bbox null).
         Cùng quy ước với mixamo-safe-export.js:161,477 và arp-export.js:302. */
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  function bboxOf(target) {
    var meshes = collectMeshes(target);
    if (!meshes.length) return null;
    target.updateMatrixWorld(true);
    var box = new THREE.Box3();
    meshes.forEach(function (m) { box.expandByObject(m); });
    if (box.isEmpty()) return null;
    return box;
  }

  function boneWorld(bone) {
    var v = new THREE.Vector3();
    bone.getWorldPosition(v);
    return v;
  }

  /* ---------- Công thức số đo từ landmark — Y HỆT
     ArpSmart.computeMeasurements (cao/tay/chân/vai/hông). ---------- */
  function computeFromLandmarks(lm) {
    if (!lm) return null;
    var dxArm = Math.max(0, lm.handX - lm.shoulderWidth);
    var dyArm = Math.max(0, lm.shoulderY - lm.wristY);
    var arm = Math.sqrt(dxArm * dxArm + dyArm * dyArm);
    return {
      height: lm.H,
      armLength: arm, armLeft: arm, armRight: arm,
      legLength: lm.groinY - lm.groundY,
      legLeft: lm.groinY - lm.groundY, legRight: lm.groinY - lm.groundY,
      shoulderWidth: 2 * lm.shoulderWidth,
      hipWidth: 2 * lm.hipX,
      armReach: lm.handX
    };
  }
  ArpVpMeasure._computeFromLandmarks = computeFromLandmarks;

  /* ---------- Đo từ skeleton (model đã rig) ----------
     Trả về null khi thiếu xương cần thiết. Cao = HeadTop_End (hoặc
     Head) − đất (bbox min.y); tay/chân = khoảng cách thẳng 2 đầu
     theo tư thế hiện tại; vai = |vai trái − vai phải|. */
  function measureFromSkeleton(target, bones, box) {
    var ok = true;
    NEEDED_BONES.forEach(function (n) { if (!bones[n]) ok = false; });
    if (!ok) return null;
    var head = bones.HeadTop_End || bones.Head;
    if (!head) return null;
    target.updateMatrixWorld(true);
    var p = {};
    ['Hips', 'LeftShoulder', 'RightShoulder', 'LeftHand', 'RightHand',
     'LeftUpLeg', 'RightUpLeg', 'LeftFoot', 'RightFoot'].forEach(function (n) {
      p[n] = boneWorld(bones[n]);
    });
    var headTopY = boneWorld(head).y;
    var groundY = box ? box.min.y : Math.min(p.LeftFoot.y, p.RightFoot.y);
    var armL = p.LeftShoulder.distanceTo(p.LeftHand);
    var armR = p.RightShoulder.distanceTo(p.RightHand);
    var legL = p.LeftUpLeg.distanceTo(p.LeftFoot);
    var legR = p.RightUpLeg.distanceTo(p.RightFoot);
    return {
      source: 'skeleton',
      values: {
        height: headTopY - groundY,
        armLength: (armL + armR) / 2, armLeft: armL, armRight: armR,
        legLength: (legL + legR) / 2, legLeft: legL, legRight: legR,
        shoulderWidth: p.LeftShoulder.distanceTo(p.RightShoulder),
        hipWidth: p.LeftUpLeg.distanceTo(p.RightUpLeg),
        armReach: (Math.abs(p.LeftHand.x - p.Hips.x) + Math.abs(p.RightHand.x - p.Hips.x)) / 2
      },
      endpoints: {
        height: null, /* dựng từ bbox, xem buildVisuals */
        armLeft: [p.LeftShoulder, p.LeftHand],
        armRight: [p.RightShoulder, p.RightHand],
        legLeft: [p.LeftUpLeg, p.LeftFoot],
        legRight: [p.RightUpLeg, p.RightFoot],
        shoulder: [p.LeftShoulder, p.RightShoulder]
      },
      groundY: groundY, headTopY: headTopY,
      cx: p.Hips.x, cz: p.Hips.z,
      H: headTopY - groundY
    };
  }

  /* ---------- Đo từ landmark (model chưa rig) ----------
     Endpoints lấy từ boneWorldPositions (cùng vị trí khớp ghost
     của Smart) để đường đo trùng khớp xương tham chiếu. */
  function measureFromLandmarks(target, lm) {
    var ARP = PixiStudio.AutoRigPro;
    var values;
    /* ArpSmart đã đo sẵn cho đúng model này → dùng thẳng kết quả
       của Smart để khớp tuyệt đối (không đo lại từ đầu). */
    var Smart = PixiStudio.ArpSmart;
    if (Smart && Smart.landmarks === lm && Smart.computeMeasurements) {
      values = Smart.computeMeasurements();
    } else {
      values = computeFromLandmarks(lm);
    }
    if (!values) return null;
    var pos = null;
    if (ARP && ARP._test && ARP._test.boneWorldPositions) {
      pos = ARP._test.boneWorldPositions(lm, {});
    }
    var endpoints = null;
    if (pos) {
      endpoints = {
        height: null,
        armLeft: [pos.LeftShoulder, pos.LeftHand],
        armRight: [pos.RightShoulder, pos.RightHand],
        legLeft: [pos.LeftUpLeg, pos.LeftFoot],
        legRight: [pos.RightUpLeg, pos.RightFoot],
        shoulder: [pos.LeftShoulder, pos.RightShoulder]
      };
    }
    return {
      source: 'landmarks',
      values: values,
      endpoints: endpoints,
      groundY: lm.groundY, headTopY: lm.headTopY,
      cx: lm.cx, cz: lm.cz, H: lm.H,
      landmarks: lm
    };
  }

  /* ---------- Đo chính: skeleton → landmarks → bbox ---------- */
  function measure(target) {
    target = getTarget(target);
    if (!target) return { status: 'empty', source: null, values: null, message: 'Chưa có model nào.' };
    var box = bboxOf(target);
    if (!box) return { status: 'empty', source: null, values: null, message: 'Model rỗng hoặc không có mesh.' };
    var size = box.getSize(new THREE.Vector3());
    var bones = collectBones(target);
    var skel = measureFromSkeleton(target, bones, box);
    if (skel) {
      skel.status = 'ok';
      skel.message = 'Đo từ skeleton (' + Object.keys(bones).length + ' xương).';
      skel.box = box;
      return skel;
    }
    var ARP = PixiStudio.AutoRigPro;
    if (ARP && ARP.measureLandmarks) {
      var lm = ARP.measureLandmarks(target);
      if (lm) {
        var res = measureFromLandmarks(target, lm);
        if (res) {
          res.status = 'ok';
          res.message = 'Đo từ landmark mesh (chưa rig).';
          res.box = box;
          return res;
        }
      }
    }
    /* Không rig, không đo được landmark: chỉ đo chiều cao từ bbox. */
    return {
      status: 'bbox-only', source: 'bbox',
      values: { height: size.y, armLength: null, armLeft: null, armRight: null, legLength: null, legLeft: null, legRight: null, shoulderWidth: null, hipWidth: null, armReach: null },
      endpoints: null,
      groundY: box.min.y, headTopY: box.max.y,
      cx: box.getCenter(new THREE.Vector3()).x, cz: box.getCenter(new THREE.Vector3()).z,
      H: size.y, box: box,
      message: 'Chưa có rig — chỉ đo được chiều cao từ bounding box.'
    };
  }
  ArpVpMeasure._measure = measure;

  /* ---------- Định dạng đơn vị ---------- */
  function formatValue(meters) {
    if (meters == null || !isFinite(meters)) return '—';
    if (ArpVpMeasure.unit === 'm') return meters.toFixed(2) + ' m';
    return (meters * 100).toFixed(1) + ' cm';
  }
  ArpVpMeasure.formatValue = formatValue;

  function labelText(id, valueMeters) {
    return LABEL_TITLES[id] + ' ' + formatValue(valueMeters);
  }

  /* ---------- Nhãn sprite (luôn quay về camera) ----------
     Vẽ pill + chữ lên canvas rồi làm CanvasTexture. Mọi thao tác
     ctx đều guard (jsdom không có canvas 2D thật): khi đó sprite
     vẫn tạo được với texture trống, text lưu trong userData.text. */
  function makeLabelSprite(text, colorHex, H) {
    var sprite = null;
    var canvas = null, ctx = null;
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        canvas = document.createElement('canvas');
        if (canvas) {
          canvas.width = 512; canvas.height = 128;
          if (canvas.getContext) ctx = canvas.getContext('2d');
        }
      }
    } catch (e) { canvas = null; ctx = null; }
    if (ctx) {
      try {
        var font = 'bold 56px system-ui, -apple-system, sans-serif';
        if (typeof ctx.measureText === 'function') {
          try { ctx.font = font; } catch (e) {}
          var w = ctx.measureText(text).width;
          if (w > 440) { canvas.width = Math.ceil(w) + 72; }
        }
        var cw = canvas.width, ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = 'rgba(10,12,24,0.78)';
        if (typeof ctx.beginPath === 'function') {
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(4, 12, cw - 8, ch - 24, 24);
          else ctx.rect(4, 12, cw - 8, ch - 24);
          ctx.fill();
        } else if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(4, 12, cw - 8, ch - 24);
        }
        /* chấm màu ở đầu nhãn */
        ctx.fillStyle = '#' + ('000000' + colorHex.toString(16)).slice(-6);
        if (typeof ctx.beginPath === 'function' && typeof ctx.arc === 'function') {
          ctx.beginPath(); ctx.arc(44, ch / 2, 16, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        try { ctx.font = font; } catch (e) {}
        try { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; } catch (e) {}
        if (typeof ctx.fillText === 'function') ctx.fillText(text, 72, ch / 2 + 2);
      } catch (e) { /* canvas stub lạ: bỏ qua phần vẽ, giữ text */ }
    }
    if (!window.THREE) return null;
    var tex = null;
    if (canvas) {
      try { tex = new THREE.CanvasTexture(canvas); } catch (e) { tex = null; }
    }
    var mat = new THREE.SpriteMaterial({ map: tex || null, color: 0xffffff, transparent: true, depthTest: false });
    sprite = new THREE.Sprite(mat);
    var h = Math.max(0.02, (H || 1.8) * 0.055);
    var aspect = canvas ? (canvas.width / Math.max(1, canvas.height)) : 4;
    sprite.scale.set(h * aspect, h, 1);
    sprite.renderOrder = 999;
    sprite.userData.isArpMeasure = true;
    sprite.userData.text = text;
    sprite.userData.labelId = null;
    return sprite;
  }

  /* ---------- Đường đo + vạch cuối ----------
     Line nối 2 điểm + 2 vạch ngắn vuông góc ở 2 đầu (dài 3% H).
     Hướng vạch: vuông góc với đường đo trong mặt phẳng nhìn từ
     camera (fallback: vuông góc với trục Z rồi trục Y). */
  function makeMeasureLine(a, b, colorHex, H) {
    var group = new THREE.Group();
    group.userData.isArpMeasure = true;
    var va = new THREE.Vector3(a.x, a.y, a.z);
    var vb = new THREE.Vector3(b.x, b.y, b.z);
    var lineMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95, depthTest: false });
    var lg = new THREE.BufferGeometry().setFromPoints([va, vb]);
    var line = new THREE.Line(lg, lineMat);
    line.renderOrder = 998;
    line.userData.isArpMeasure = true;
    group.add(line);
    var dir = vb.clone().sub(va);
    var len = dir.length();
    if (len > 1e-9) {
      dir.normalize();
      var cam = getCamera();
      var perp = new THREE.Vector3(0, 0, 1);
      if (cam) {
        var fwd = new THREE.Vector3();
        try { cam.getWorldDirection(fwd); } catch (e) { fwd.set(0, 0, -1); }
        perp = new THREE.Vector3().crossVectors(dir, fwd);
        if (perp.lengthSq() < 1e-6) perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
      } else {
        perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
        if (perp.lengthSq() < 1e-6) perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      }
      perp.normalize().multiplyScalar(Math.max(0.01, (H || 1.8) * 0.03));
      var tickPts = [
        va.clone().sub(perp), va.clone().add(perp),
        vb.clone().sub(perp), vb.clone().add(perp)
      ];
      var tg = new THREE.BufferGeometry().setFromPoints(tickPts);
      var ticks = new THREE.LineSegments(tg, lineMat);
      ticks.renderOrder = 998;
      ticks.userData.isArpMeasure = true;
      group.add(ticks);
    }
    return group;
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse(function (o) {
      if (o.geometry && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m.map && m.map.dispose) { try { m.map.dispose(); } catch (e) {} }
          if (m.dispose) { try { m.dispose(); } catch (e) {} }
        });
      }
    });
  }

  function v3(p) { return new THREE.Vector3(p.x, p.y, p.z); }

  /* ---------- Dựng visuals từ kết quả đo ---------- */
  function buildVisuals(m) {
    var scene = getScene();
    if (!scene || !window.THREE) return false;
    if (!ArpVpMeasure.group) {
      ArpVpMeasure.group = new THREE.Group();
      ArpVpMeasure.group.name = '__arp_measure__';
      scene.add(ArpVpMeasure.group);
    }
    var g = ArpVpMeasure.group;
    while (g.children.length) {
      var c = g.children[0];
      g.remove(c);
      disposeGroup(c);
    }
    ArpVpMeasure.labels = {};
    ArpVpMeasure.lines = {};
    ArpVpMeasure.groundLine = null;
    if (!m || !m.values) return false;
    var H = m.H || 1.8;
    var vals = m.values;
    var box = m.box;
    var halfW = box ? Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z) / 2 : H * 0.4;

    function addLine(id, a, b, labelPos) {
      var lineGroup = makeMeasureLine(a, b, LABEL_COLORS[id] || 0xffffff, H);
      lineGroup.name = 'measure-' + id;
      g.add(lineGroup);
      ArpVpMeasure.lines[id] = lineGroup;
      var sprite = makeLabelSprite(labelText(id, vals[id === 'shoulder' ? 'shoulderWidth' : id]), LABEL_COLORS[id] || 0xffffff, H);
      if (sprite) {
        sprite.userData.labelId = id;
        sprite.position.copy(labelPos);
        g.add(sprite);
        ArpVpMeasure.labels[id] = sprite;
      }
      return lineGroup;
    }
    function mid(a, b) {
      return new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }

    /* --- Chiều cao: đường dọc bên phải model --- */
    var hx = m.cx + halfW + Math.max(0.05, H * 0.06);
    var hA = { x: hx, y: m.groundY, z: m.cz };
    var hB = { x: hx, y: m.headTopY, z: m.cz };
    addLine('height', hA, hB, new THREE.Vector3(hx + H * 0.03, (m.groundY + m.headTopY) / 2, m.cz));

    if (m.endpoints) {
      var ep = m.endpoints;
      if (ep.armLeft) addLine('armLeft', ep.armLeft[0], ep.armLeft[1], mid(ep.armLeft[0], ep.armLeft[1]).add(new THREE.Vector3(0, H * 0.02, H * 0.02)));
      if (ep.armRight) addLine('armRight', ep.armRight[0], ep.armRight[1], mid(ep.armRight[0], ep.armRight[1]).add(new THREE.Vector3(0, H * 0.02, H * 0.02)));
      if (ep.legLeft) addLine('legLeft', ep.legLeft[0], ep.legLeft[1], mid(ep.legLeft[0], ep.legLeft[1]).add(new THREE.Vector3(0, 0, H * 0.03)));
      if (ep.legRight) addLine('legRight', ep.legRight[0], ep.legRight[1], mid(ep.legRight[0], ep.legRight[1]).add(new THREE.Vector3(0, 0, H * 0.03)));
      if (ep.shoulder) addLine('shoulder', ep.shoulder[0], ep.shoulder[1], mid(ep.shoulder[0], ep.shoulder[1]).add(new THREE.Vector3(0, H * 0.04, 0)));
    }

    /* --- Đường mặt đất (y = groundY) qua tâm model --- */
    var gl = new THREE.Group();
    gl.name = 'measure-ground';
    gl.userData.isArpMeasure = true;
    var gMat = new THREE.LineBasicMaterial({ color: LABEL_COLORS.ground, transparent: true, opacity: 0.9, depthTest: false });
    var gGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(m.cx - halfW - H * 0.2, m.groundY, m.cz),
      new THREE.Vector3(m.cx + halfW + H * 0.2, m.groundY, m.cz)
    ]);
    var gLine = new THREE.Line(gGeo, gMat);
    gLine.renderOrder = 998;
    gLine.userData.isArpMeasure = true;
    gl.add(gLine);
    gl.visible = ArpVpMeasure.groundVisible;
    g.add(gl);
    ArpVpMeasure.groundLine = gl;
    var gSprite = makeLabelSprite('Mặt đất y=' + m.groundY.toFixed(2), LABEL_COLORS.ground, H);
    if (gSprite) {
      gSprite.userData.labelId = 'ground';
      gSprite.position.set(m.cx - halfW - H * 0.2, m.groundY + H * 0.03, m.cz);
      g.add(gSprite);
      ArpVpMeasure.labels.ground = gSprite;
    }

    /* --- Trạng thái bbox-only: nhãn "chưa có rig" --- */
    if (m.status === 'bbox-only') {
      var sSprite = makeLabelSprite('Chưa có rig — chỉ đo được chiều cao', LABEL_COLORS.status, H);
      if (sSprite) {
        sSprite.userData.labelId = 'status';
        sSprite.position.set(m.cx, m.headTopY + H * 0.08, m.cz);
        g.add(sSprite);
        ArpVpMeasure.labels.status = sSprite;
      }
    }
    return true;
  }

  /* ---------- Overlay tham chiếu T/A-pose (ghost lines mờ) ---------- */
  function buildReference() {
    var scene = getScene();
    if (!scene || !window.THREE) return false;
    if (!ArpVpMeasure.refGroup) {
      ArpVpMeasure.refGroup = new THREE.Group();
      ArpVpMeasure.refGroup.name = '__arp_reference__';
      scene.add(ArpVpMeasure.refGroup);
    }
    var g = ArpVpMeasure.refGroup;
    while (g.children.length) {
      var c = g.children[0];
      g.remove(c);
      disposeGroup(c);
    }
    ArpVpMeasure.refJoints = {};
    var ARP = PixiStudio.AutoRigPro;
    var lm = ArpVpMeasure.landmarks;
    if (!lm && ARP && ARP.measureLandmarks && ArpVpMeasure.target) {
      lm = ARP.measureLandmarks(ArpVpMeasure.target);
      ArpVpMeasure.landmarks = lm;
    }
    if (!lm || !ARP || !ARP._test || !ARP._test.boneWorldPositions) return false;
    var pos = ARP._test.boneWorldPositions(lm, { pose: ArpVpMeasure.refPose });
    var defs = (ARP.BONE_DEFS || []).filter(function (d) {
      return REF_BONES.indexOf(d.name) >= 0;
    });
    var H = lm.H;
    var lineMat = new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.45, depthTest: false });
    var pts = [];
    defs.forEach(function (d) {
      if (!d.parent) return;
      var a = pos[d.parent], b = pos[d.name];
      if (!a || !b) return;
      pts.push(v3(a), v3(b));
    });
    if (pts.length) {
      var lg = new THREE.BufferGeometry().setFromPoints(pts);
      var lines = new THREE.LineSegments(lg, lineMat);
      lines.renderOrder = 997;
      lines.userData.isArpReference = true;
      g.add(lines);
      ArpVpMeasure.refLines = lines;
    }
    var jointMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.6, depthTest: false });
    var r = Math.max(0.006, H * 0.012);
    REF_BONES.forEach(function (name) {
      var p = pos[name];
      if (!p) return;
      var geo = new THREE.SphereGeometry(r, 10, 8);
      var mesh = new THREE.Mesh(geo, jointMat);
      mesh.position.copy(p);
      mesh.renderOrder = 997;
      mesh.userData.isArpReference = true;
      mesh.userData.boneName = name;
      g.add(mesh);
      ArpVpMeasure.refJoints[name] = mesh;
    });
    g.visible = ArpVpMeasure.refVisible;
    return true;
  }

  /* ---------- API chính ---------- */
  ArpVpMeasure.show = function (target) {
    var scene = getScene();
    if (!scene || !window.THREE) { notify('error', 'Đo đạc viewport', 'THREE/viewport chưa sẵn sàng.'); return false; }
    ArpVpMeasure.visible = true;
    if (ArpVpMeasure.group) ArpVpMeasure.group.visible = ArpVpMeasure.measureVisible;
    if (ArpVpMeasure.refGroup) ArpVpMeasure.refGroup.visible = ArpVpMeasure.refVisible;
    return ArpVpMeasure.refresh(target);
  };

  ArpVpMeasure.hide = function () {
    ArpVpMeasure.visible = false;
    if (ArpVpMeasure.group) ArpVpMeasure.group.visible = false;
    if (ArpVpMeasure.refGroup) ArpVpMeasure.refGroup.visible = false;
    return true;
  };

  /* Đo lại từ skeleton/model hiện tại (rig lại / đổi model) rồi
     dựng lại đường đo + nhãn + overlay tham chiếu. */
  ArpVpMeasure.refresh = function (target) {
    if (!window.THREE) return false;
    var m = measure(target);
    ArpVpMeasure.target = getTarget(target);
    if (m.status === 'empty') {
      ArpVpMeasure.measurements = null;
      ArpVpMeasure.landmarks = null;
      if (ArpVpMeasure.group) {
        while (ArpVpMeasure.group.children.length) {
          var c = ArpVpMeasure.group.children[0];
          ArpVpMeasure.group.remove(c);
          disposeGroup(c);
        }
      }
      ArpVpMeasure.labels = {};
      ArpVpMeasure.lines = {};
      return false;
    }
    ArpVpMeasure.measurements = {
      status: m.status, source: m.source, message: m.message,
      height: m.values.height, armLength: m.values.armLength,
      armLeft: m.values.armLeft, armRight: m.values.armRight,
      legLength: m.values.legLength, legLeft: m.values.legLeft,
      legRight: m.values.legRight, shoulderWidth: m.values.shoulderWidth,
      hipWidth: m.values.hipWidth, armReach: m.values.armReach,
      groundY: m.groundY, headTopY: m.headTopY, cx: m.cx, cz: m.cz, H: m.H
    };
    if (m.landmarks) ArpVpMeasure.landmarks = m.landmarks;
    else if (m.source === 'skeleton' && PixiStudio.AutoRigPro && PixiStudio.AutoRigPro.measureLandmarks) {
      /* Có rig nhưng vẫn cần landmark để vẽ overlay tham chiếu. */
      try { ArpVpMeasure.landmarks = PixiStudio.AutoRigPro.measureLandmarks(ArpVpMeasure.target); } catch (e) { ArpVpMeasure.landmarks = null; }
    }
    var scene = getScene();
    if (scene) {
      buildVisuals(m);
      if (ArpVpMeasure.group) ArpVpMeasure.group.visible = ArpVpMeasure.visible && ArpVpMeasure.measureVisible;
      if (ArpVpMeasure.refVisible) buildReference();
    }
    return true;
  };

  ArpVpMeasure.setPose = function (pose) {
    if (pose !== 'T' && pose !== 'A') return false;
    ArpVpMeasure.refPose = pose;
    if (ArpVpMeasure.refVisible) buildReference();
    return true;
  };

  ArpVpMeasure.setUnit = function (unit) {
    if (unit !== 'cm' && unit !== 'm') return false;
    if (ArpVpMeasure.unit === unit) return true;
    ArpVpMeasure.unit = unit;
    /* Vẽ lại nhãn với đơn vị mới (không đo lại mesh). */
    if (ArpVpMeasure.measurements) {
      var m = ArpVpMeasure.measurements;
      Object.keys(ArpVpMeasure.labels).forEach(function (id) {
        var spr = ArpVpMeasure.labels[id];
        if (!spr || !LABEL_TITLES[id]) return;
        var key = id === 'shoulder' ? 'shoulderWidth' : id;
        var text = labelText(id, m[key]);
        spr.userData.text = text;
        if (spr.material && spr.material.map && spr.material.map.image) {
          var canvas = spr.material.map.image;
          if (canvas && canvas.getContext) {
            var ctx = canvas.getContext('2d');
            if (ctx && typeof ctx.fillText === 'function') {
              try {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'rgba(10,12,24,0.78)';
                if (typeof ctx.fillRect === 'function') ctx.fillRect(4, 12, canvas.width - 8, canvas.height - 24);
                ctx.fillStyle = '#ffffff';
                try { ctx.font = 'bold 56px system-ui, -apple-system, sans-serif'; } catch (e) {}
                try { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; } catch (e) {}
                ctx.fillText(text, 72, canvas.height / 2 + 2);
                spr.material.map.needsUpdate = true;
              } catch (e) { /* canvas stub: chỉ cập nhật text */ }
            }
          }
        }
      });
    }
    return true;
  };

  ArpVpMeasure.setReferenceVisible = function (on) {
    ArpVpMeasure.refVisible = !!on;
    if (on) {
      if (!ArpVpMeasure.landmarks) ArpVpMeasure.refresh();
      buildReference();
    }
    if (ArpVpMeasure.refGroup) ArpVpMeasure.refGroup.visible = ArpVpMeasure.refVisible && ArpVpMeasure.visible;
    return ArpVpMeasure.refVisible;
  };

  ArpVpMeasure.setMeasurementsVisible = function (on) {
    ArpVpMeasure.measureVisible = !!on;
    if (ArpVpMeasure.group) ArpVpMeasure.group.visible = ArpVpMeasure.measureVisible && ArpVpMeasure.visible;
    return ArpVpMeasure.measureVisible;
  };

  ArpVpMeasure.setGroundVisible = function (on) {
    ArpVpMeasure.groundVisible = !!on;
    if (ArpVpMeasure.groundLine) ArpVpMeasure.groundLine.visible = ArpVpMeasure.groundVisible;
    return ArpVpMeasure.groundVisible;
  };

  /* Lưới: dùng lại GridEnv có sẵn của viewport, KHÔNG tạo grid mới. */
  ArpVpMeasure.setGridVisible = function (on) {
    ArpVpMeasure.gridVisible = !!on;
    var GridEnv = PixiStudio.GridEnv;
    if (GridEnv && typeof GridEnv.setVisible === 'function') {
      try { GridEnv.setVisible(ArpVpMeasure.gridVisible); } catch (e) { return false; }
      return true;
    }
    return false;
  };

  ArpVpMeasure.getGridVisible = function () {
    var GridEnv = PixiStudio.GridEnv;
    if (GridEnv && typeof GridEnv.visible !== 'undefined') return !!GridEnv.visible;
    return ArpVpMeasure.gridVisible;
  };

  ArpVpMeasure.getMeasurements = function () {
    return ArpVpMeasure.measurements;
  };

  ArpVpMeasure.getLabelText = function (id) {
    var spr = ArpVpMeasure.labels[id];
    return spr ? spr.userData.text : null;
  };

  ArpVpMeasure.getState = function () {
    return {
      visible: ArpVpMeasure.visible,
      measureVisible: ArpVpMeasure.measureVisible,
      refVisible: ArpVpMeasure.refVisible,
      refPose: ArpVpMeasure.refPose,
      unit: ArpVpMeasure.unit,
      groundVisible: ArpVpMeasure.groundVisible,
      gridVisible: ArpVpMeasure.getGridVisible(),
      measurements: ArpVpMeasure.measurements
    };
  };

  ArpVpMeasure.remove = function () {
    var scene = getScene();
    if (ArpVpMeasure.group) {
      if (scene) scene.remove(ArpVpMeasure.group);
      disposeGroup(ArpVpMeasure.group);
      ArpVpMeasure.group = null;
    }
    if (ArpVpMeasure.refGroup) {
      if (scene) scene.remove(ArpVpMeasure.refGroup);
      disposeGroup(ArpVpMeasure.refGroup);
      ArpVpMeasure.refGroup = null;
    }
    ArpVpMeasure.labels = {};
    ArpVpMeasure.lines = {};
    ArpVpMeasure.measurements = null;
    ArpVpMeasure.landmarks = null;
    ArpVpMeasure.visible = false;
    return true;
  };

  /* Đo lại khi model mới load (nếu bus có sự kiện này; không có
     thì toolbar/preset gọi refresh() trực tiếp — vẫn đúng). */
  try {
    if (bus && typeof bus.on === 'function') {
      bus.on('model:loaded', function () { if (ArpVpMeasure.visible) ArpVpMeasure.refresh(); });
    }
  } catch (e) { /* bus không hỗ trợ on: bỏ qua */ }

  /* ---------- Đăng ký layer vào registry chung (defensive) ---------- */
  ArpVpMeasure._registeredLayers = [];
  try {
    var VP = PixiStudio.ArpViewport;
    if (VP && typeof VP.registerLayer === 'function') {
      VP.registerLayer('measure', {
        show: ArpVpMeasure.show, hide: ArpVpMeasure.hide,
        refresh: ArpVpMeasure.refresh, setUnit: ArpVpMeasure.setUnit,
        setVisible: ArpVpMeasure.setMeasurementsVisible,
        getMeasurements: ArpVpMeasure.getMeasurements
      });
      VP.registerLayer('reference', {
        show: function () { return ArpVpMeasure.setReferenceVisible(true); },
        hide: function () { return ArpVpMeasure.setReferenceVisible(false); },
        refresh: ArpVpMeasure.refresh, setPose: ArpVpMeasure.setPose,
        setVisible: ArpVpMeasure.setReferenceVisible
      });
      ArpVpMeasure._registeredLayers = ['measure', 'reference'];
    }
  } catch (e) { ArpVpMeasure._registeredLayers = []; }

  window.PixiStudio.ArpVpMeasure = ArpVpMeasure;
})();
