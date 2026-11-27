/* ============================================================
 * scene/scene-culling.js — Occlusion culling theo cell + phòng
 * PixiStudio.OcclusionCulling
 *
 * 1) CELL CULLING (chính): chia scene thành lưới cell (mặc định
 *    4m), mỗi object đăng ký vào các cell mà bounding box của nó
 *    chạm tới. Mỗi frame (khi camera di chuyển đủ xa) chỉ hiện
 *    object thuộc cell camera + các cell kề TRONG frustum; object
 *    ngoài các cell đó bị visible=false TẠM THỜI và khôi phục khi
 *    camera quay lại. Vật user đã ẩn tay (visible=false trước khi
 *    bật culling) KHÔNG bị đụng tới và KHÔNG bị hiện lại.
 *
 * 2) PORTAL / ROOM CULLING (đơn giản, thử nghiệm): tự phát hiện
 *    tường (box mỏng + cao) rồi flood-fill mặt bằng XZ thành các
 *    phòng; chỉ render phòng camera đang đứng + phòng kề qua portal
 *    (khe hở tường) nằm trong frustum. Nếu không phát hiện được
 *    >= 2 phòng thì tự rơi về cell culling.
 *
 * GIỚI HẠN NÓI THẲNG:
 *  - Đây là heuristic theo cell/phòng, KHÔNG phải occlusion query
 *    của GPU (không đo depth thật): vật to chắn vật nhỏ trong cùng
 *    1 cell vẫn được render; vật ở biên cell có thể bị cull thừa /
 *    thiếu 1 frame khi camera di chuyển nhanh (đã giảm bằng bán kính
 *    cell kề + ngưỡng di chuyển nhỏ).
 *  - Chỉ cull object đã đăng ký trong index (primitive trong
 *    Scene.registry + mesh trong modelRoot). Light, helper, gizmo,
 *    grid, bone-visual KHÔNG bao giờ bị cull.
 *  - Room detection chỉ xét mặt bằng XZ và tường hình hộp mỏng;
 *    tường nghiêng / tường cong / nhà nhiều tầng không nhận diện
 *    đúng — khi đó dùng cell culling.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || null;
  function emit(evt, data) { if (bus) { try { bus.emit(evt, data); } catch (e) {} } }

  var Culling = {
    enabled: false,
    cellSize: 4,            // mét
    neighborRadius: 1,      // số vòng cell kề quanh cell camera
    moveThreshold: 0.25,    // m — camera di chuyển ít hơn thì không tính lại
    updateEveryMs: 100,     // tính lại tối đa mỗi 100ms kể cả khi camera đứng yên (đỡ tốn frame)
    portalMode: false,      // true = dùng room/portal thay vì cell
    /* index */
    entries: {},            // uuid -> { object3D, cells:[key], rooms:[name], userVisible, culled }
    cells: {},              // key "x,z" -> [uuid,...]
    rooms: [],              // [{ name, minX,maxX,minZ,maxZ, objects:[uuid], portals:[{x,z,to}] }]
    wallCells: null,        // Set key "gx,gz" (grid 1m) bị tường chặn — dùng cho room detect
    stats: { total: 0, culled: 0, visible: 0, cells: 0, rooms: 0, lastUpdateMs: 0, updates: 0 },
    _lastCamPos: null,
    _lastUpdateAt: 0,
    _frustum: null,
    _camCell: null,
    _camRoom: null
  };

  /* ---------- TIỆN ÍCH CELL ---------- */
  Culling.cellKey = function (cx, cz) { return cx + ',' + cz; };

  Culling.cellOf = function (x, z) {
    var s = Culling.cellSize;
    return { cx: Math.floor(x / s), cz: Math.floor(z / s) };
  };

  /* ---------- BUILD INDEX ---------- */
  Culling.collectObjects = function () {
    var out = [], seen = {};
    function push(o) {
      if (!o || seen[o.uuid]) return;
      if (o.isLight || (o.userData && (o.userData.isBoneVisual || o.userData.isArpBoneLabel))) return;
      if (o.isMesh || o.isGroup || o.isObject3D) { seen[o.uuid] = true; out.push(o); }
    }
    var S = PixiStudio.Scene;
    if (S && S.registry) {
      Object.keys(S.registry).forEach(function (uuid) {
        var reg = S.registry[uuid];
        if (reg && reg.object3D) push(reg.object3D);
      });
    }
    var root = PixiStudio.Viewport && PixiStudio.Viewport.modelRoot;
    if (root) {
      root.children.forEach(function (child) { push(child); });
    }
    return out;
  };

  /* Đăng ký object vào các cell mà bbox của nó chạm tới. Object lớn
   * (vd mặt đất) chạm nhiều cell — cố ý, để không bao giờ cull nhầm. */
  Culling.buildIndex = function (objects) {
    objects = objects || Culling.collectObjects();
    /* GIỮ userVisible cũ khi rebuild trong lúc culling đang bật: nếu
       snapshot lại visible lúc này thì vật đang bị cull (visible=false
       tạm thời) sẽ bị ghi nhầm thành "user ẩn tay" và không bao giờ
       hiện lại nữa. */
    var oldEntries = Culling.entries || {};
    Culling.entries = {};
    Culling.cells = {};
    if (typeof THREE === 'undefined') return 0;
    var box = new THREE.Box3();
    objects.forEach(function (o) {
      try {
        o.updateWorldMatrix(true, false);
        box.setFromObject(o);
      } catch (e) { return; }
      if (box.isEmpty()) return;
      var cMin = Culling.cellOf(box.min.x, box.min.z);
      var cMax = Culling.cellOf(box.max.x, box.max.z);
      var cellKeys = [];
      for (var cx = cMin.cx; cx <= cMax.cx; cx++) {
        for (var cz = cMin.cz; cz <= cMax.cz; cz++) {
          var key = Culling.cellKey(cx, cz);
          cellKeys.push(key);
          (Culling.cells[key] = Culling.cells[key] || []).push(o.uuid);
        }
      }
      var prev = oldEntries[o.uuid];
      /* Phân biệt "user ẩn tay" với "culling ẩn tạm" khi rebuild:
         visible=false + entry ĐANG bị cull (culled=true) -> do culling
         ẩn, giữ userVisible cũ; visible=false + entry KHÔNG bị cull
         -> user vừa ẩn tay, ghi userVisible=false. Khi culling tắt
         thì culled luôn false nên snapshot mới luôn đúng. */
      var userVisible;
      if (prev && o.visible === false && prev.culled) userVisible = prev.userVisible;
      else userVisible = (o.visible !== false);
      Culling.entries[o.uuid] = {
        object3D: o, cells: cellKeys, rooms: (prev && prev.rooms) || [],
        userVisible: userVisible, culled: false
      };
    });
    Culling.stats.total = Object.keys(Culling.entries).length;
    Culling.stats.cells = Object.keys(Culling.cells).length;
    Culling._lastCamPos = null;
    emit('culling:indexed', { total: Culling.stats.total, cells: Culling.stats.cells });
    return Culling.stats.total;
  };

  Culling.rebuild = function () {
    var n = Culling.buildIndex();
    if (Culling.portalMode) Culling.buildRooms();
    if (Culling.enabled) Culling.update(Culling._lastCamera, true);
    return n;
  };

  /* ---------- FRUSTUM ---------- */
  function frustumFor(camera) {
    if (!camera || !camera.updateMatrixWorld) return null;
    if (typeof THREE === 'undefined') return null;
    camera.updateMatrixWorld();
    var m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    var f = Culling._frustum || (Culling._frustum = new THREE.Frustum());
    f.setFromProjectionMatrix(m);
    return f;
  }

  /* Cell có giao frustum không (test 8 góc của hộp cell). */
  function cellInFrustum(cx, cz, frustum) {
    if (!frustum) return true;
    var s = Culling.cellSize;
    var min = new THREE.Vector3(cx * s, -50, cz * s);
    var max = new THREE.Vector3((cx + 1) * s, 50, (cz + 1) * s);
    var box = new THREE.Box3(min, max);
    return frustum.intersectsBox(box);
  }

  /* ---------- UPDATE (CELL MODE) ---------- */
  Culling.update = function (camera, force) {
    if (!Culling.enabled) return Culling.stats;
    if (!camera) { camera = Culling._lastCamera; if (!camera) return Culling.stats; }
    Culling._lastCamera = camera;
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var t0 = now;
    if (!force) {
      if (now - Culling._lastUpdateAt < Culling.updateEveryMs) return Culling.stats;
      if (Culling._lastCamPos) {
        var dx = camera.position.x - Culling._lastCamPos.x;
        var dy = camera.position.y - Culling._lastCamPos.y;
        var dz = camera.position.z - Culling._lastCamPos.z;
        if (dx * dx + dy * dy + dz * dz < Culling.moveThreshold * Culling.moveThreshold) return Culling.stats;
      }
    }
    Culling._lastUpdateAt = now;
    if (!Culling._lastCamPos) Culling._lastCamPos = { x: 0, y: 0, z: 0 };
    Culling._lastCamPos.x = camera.position.x;
    Culling._lastCamPos.y = camera.position.y;
    Culling._lastCamPos.z = camera.position.z;

    if (Culling.portalMode && Culling.rooms.length >= 2) return Culling._updateRooms(camera, t0);
    return Culling._updateCells(camera, t0);
  };

  Culling._updateCells = function (camera, t0) {
    var frustum = frustumFor(camera);
    var cc = Culling.cellOf(camera.position.x, camera.position.z);
    Culling._camCell = cc;
    var R = Culling.neighborRadius;
    var visibleCells = {};
    for (var cx = cc.cx - R; cx <= cc.cx + R; cx++) {
      for (var cz = cc.cz - R; cz <= cc.cz + R; cz++) {
        if (cellInFrustum(cx, cz, frustum)) visibleCells[Culling.cellKey(cx, cz)] = true;
      }
    }
    var culled = 0, visible = 0;
    Object.keys(Culling.entries).forEach(function (uuid) {
      var e = Culling.entries[uuid];
      var show = false;
      for (var i = 0; i < e.cells.length; i++) {
        if (visibleCells[e.cells[i]]) { show = true; break; }
      }
      /* vật user đã ẩn tay thì giữ ẩn bất kể cell */
      var want = !!(show && e.userVisible);
      if (e.object3D.visible !== want) e.object3D.visible = want;
      e.culled = !show && e.userVisible;
      if (e.culled) culled++; else if (want) visible++;
    });
    Culling.stats.culled = culled;
    Culling.stats.visible = visible;
    Culling.stats.updates++;
    Culling.stats.lastUpdateMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    return Culling.stats;
  };

  /* ---------- ROOM / PORTAL ---------- */
  /* Phát hiện tường: primitive box có bbox mỏng 1 trục XZ (<0.6m) và cao >1.5m.
   * Tường cùng 1 đường thẳng (cùng cột/hàng lưới) được gộp thành 1 "tường
   * dài"; khe hở GIỮA 2 đoạn tường cùng đường thẳng = CỬA (doorway).
   * Flood-fill mặt bằng XZ (lưới 1m) với ô tường + ô cửa đều bị chặn —
   * nhờ chặn cả cửa mà 2 phòng 2 bên tường mới tách nhau; mỗi vùng
   * liên thông = 1 phòng, và mỗi ô cửa ghi lại portal nối 2 phòng
   * 2 bên nó. Nếu không có khe hở (tường kín) thì không có portal. */
  Culling.buildRooms = function (objects) {
    Culling.rooms = [];
    Culling.wallCells = {};
    if (typeof THREE === 'undefined') return [];
    objects = objects || Culling.collectObjects();
    var walls = [];
    var sceneBox = new THREE.Box3();
    var tmpBox = new THREE.Box3();
    objects.forEach(function (o) {
      try { o.updateWorldMatrix(true, false); tmpBox.setFromObject(o); } catch (e) { return; }
      if (tmpBox.isEmpty()) return;
      sceneBox.union(tmpBox);
      var sx = tmpBox.max.x - tmpBox.min.x, sz = tmpBox.max.z - tmpBox.min.z, sy = tmpBox.max.y - tmpBox.min.y;
      var thinX = (sx < 0.6 && sz > 0.8), thinZ = (sz < 0.6 && sx > 0.8);
      if ((thinX || thinZ) && sy > 1.5) {
        walls.push({ min: tmpBox.min.clone(), max: tmpBox.max.clone(), thinX: thinX, thinZ: thinZ });
      }
    });
    if (walls.length < 2 || sceneBox.isEmpty()) { Culling.stats.rooms = 0; return []; }

    /* lưới 1m bao quanh scene (giới hạn 64x64 để flood-fill rẻ) */
    var GS = 1;
    var minX = Math.floor(sceneBox.min.x) - 1, maxX = Math.ceil(sceneBox.max.x) + 1;
    var minZ = Math.floor(sceneBox.min.z) - 1, maxZ = Math.ceil(sceneBox.max.z) + 1;
    var gw = Math.min(64, maxX - minX + 1), gh = Math.min(64, maxZ - minZ + 1);
    if (gw <= 0 || gh <= 0) return [];
    function gx(x) { return Math.floor((x - minX) / GS); }
    function gz(z) { return Math.floor((z - minZ) / GS); }
    var blocked = {};
    walls.forEach(function (w) {
      for (var x = gx(w.min.x); x <= gx(w.max.x); x++) {
        for (var z = gz(w.min.z); z <= gz(w.max.z); z++) {
          if (x >= 0 && x < gw && z >= 0 && z < gh) blocked[x + ',' + z] = true;
        }
      }
    });
    Culling.wallCells = blocked;

    /* --- gộp tường cùng đường thẳng, tìm cửa (khe hở giữa 2 đoạn) --- */
    /* line: { thinX, fixed (cột gx hoặc hàng gz), lo, hi (cột/hàng còn lại),
       segs: [[a,b],...] } — cửa = khoảng trống giữa 2 đoạn kề nhau. */
    var lines = {};
    walls.forEach(function (w) {
      if (w.thinX) {
        var key = 'x:' + gx((w.min.x + w.max.x) / 2) + ':' + gx(w.min.x) + '-' + gx(w.max.x);
        var line = lines[key] || (lines[key] = { thinX: true, c0: gx(w.min.x), c1: gx(w.max.x), segs: [] });
        line.segs.push([gz(w.min.z), gz(w.max.z)]);
      } else {
        var key2 = 'z:' + gz((w.min.z + w.max.z) / 2) + ':' + gz(w.min.z) + '-' + gz(w.max.z);
        var line2 = lines[key2] || (lines[key2] = { thinX: false, c0: gz(w.min.z), c1: gz(w.max.z), segs: [] });
        line2.segs.push([gx(w.min.x), gx(w.max.x)]);
      }
    });
    var doorCells = []; /* {x, z, thinX, c0, c1} — ô cửa (bị chặn khi flood-fill) */
    Object.keys(lines).forEach(function (k) {
      var ln = lines[k];
      ln.segs.sort(function (a, b) { return a[0] - b[0]; });
      for (var i = 0; i + 1 < ln.segs.length; i++) {
        var gapA = ln.segs[i][1] + 1, gapB = ln.segs[i + 1][0] - 1;
        if (gapA > gapB) continue;
        for (var g = gapA; g <= gapB; g++) {
          if (ln.thinX) {
            for (var cx = ln.c0; cx <= ln.c1; cx++) {
              if (cx >= 0 && cx < gw && g >= 0 && g < gh) {
                blocked[cx + ',' + g] = true;
                doorCells.push({ x: cx, z: g, thinX: true, c0: ln.c0, c1: ln.c1 });
              }
            }
          } else {
            for (var cz = ln.c0; cz <= ln.c1; cz++) {
              if (g >= 0 && g < gw && cz >= 0 && cz < gh) {
                blocked[g + ',' + cz] = true;
                doorCells.push({ x: g, z: cz, thinX: false, c0: ln.c0, c1: ln.c1 });
              }
            }
          }
        }
      }
    });

    /* flood-fill 4 hướng */
    var roomId = {};
    var rooms = [];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var sx0 = 0; sx0 < gw; sx0++) {
      for (var sz0 = 0; sz0 < gh; sz0++) {
        var k0 = sx0 + ',' + sz0;
        if (blocked[k0] || roomId[k0] !== undefined) continue;
        var id = rooms.length;
        var q = [[sx0, sz0]];
        roomId[k0] = id;
        var minGX = sx0, maxGX = sx0, minGZ = sz0, maxGZ = sz0, count = 0;
        while (q.length) {
          var cur = q.pop(); count++;
          if (cur[0] < minGX) minGX = cur[0]; if (cur[0] > maxGX) maxGX = cur[0];
          if (cur[1] < minGZ) minGZ = cur[1]; if (cur[1] > maxGZ) maxGZ = cur[1];
          for (var d = 0; d < 4; d++) {
            var nx = cur[0] + dirs[d][0], nz = cur[1] + dirs[d][1];
            if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
            var nk = nx + ',' + nz;
            if (blocked[nk] || roomId[nk] !== undefined) continue;
            roomId[nk] = id; q.push([nx, nz]);
          }
        }
        rooms.push({
          name: 'Room ' + (id + 1), id: id,
          minX: minX + minGX * GS, maxX: minX + (maxGX + 1) * GS,
          minZ: minZ + minGZ * GS, maxZ: minZ + (maxGZ + 1) * GS,
          cells: count, objects: [], portals: []
        });
      }
    }
    /* portal từ ô cửa: 2 phòng 2 bên ô cửa */
    var portalSeen = {};
    doorCells.forEach(function (dc) {
      var a, b;
      if (dc.thinX) {
        a = roomId[(dc.c0 - 1) + ',' + dc.z];
        b = roomId[(dc.c1 + 1) + ',' + dc.z];
      } else {
        a = roomId[dc.x + ',' + (dc.c0 - 1)];
        b = roomId[dc.x + ',' + (dc.c1 + 1)];
      }
      if (a === undefined || b === undefined || a === b) return;
      var pk = Math.min(a, b) + '-' + Math.max(a, b) + '@' + dc.x + ',' + dc.z;
      if (portalSeen[pk]) return;
      portalSeen[pk] = true;
      var px = minX + (dc.x + 0.5) * GS, pz = minZ + (dc.z + 0.5) * GS;
      rooms[a].portals.push({ x: px, z: pz, to: b });
      rooms[b].portals.push({ x: px, z: pz, to: a });
    });
    Culling.rooms = rooms;
    Culling._roomId = roomId;
    Culling._roomGrid = { minX: minX, minZ: minZ, gs: GS, gw: gw, gh: gh };
    Culling.stats.rooms = rooms.length;

    /* gán object vào phòng theo vị trí XZ của tâm bbox */
    Object.keys(Culling.entries).forEach(function (uuid) {
      var e = Culling.entries[uuid];
      var box2 = new THREE.Box3();
      try { box2.setFromObject(e.object3D); } catch (err) { return; }
      if (box2.isEmpty()) return;
      var cxp = (box2.min.x + box2.max.x) / 2, czp = (box2.min.z + box2.max.z) / 2;
      var rid = Culling.roomAt(cxp, czp);
      e.rooms = rid === null ? [] : [rid];
      if (rid !== null && rooms[rid]) rooms[rid].objects.push(uuid);
    });
    emit('culling:rooms', { rooms: rooms.length, walls: walls.length, doors: doorCells.length });
    return rooms;
  };

  Culling.roomAt = function (x, z) {
    if (!Culling._roomId || !Culling._roomGrid) return null;
    var g = Culling._roomGrid;
    var ix = Math.floor((x - g.minX) / g.gs), iz = Math.floor((z - g.minZ) / g.gs);
    if (ix < 0 || iz < 0 || ix >= g.gw || iz >= g.gh) return null;
    var id = Culling._roomId[ix + ',' + iz];
    return id === undefined ? null : id;
  };

  Culling._updateRooms = function (camera, t0) {
    var frustum = frustumFor(camera);
    var camRoom = Culling.roomAt(camera.position.x, camera.position.z);
    Culling._camRoom = camRoom;
    var visibleRooms = {};
    if (camRoom === null) {
      /* camera ngoài mọi phòng (vd ngoài trời): hiện tất cả phòng */
      Culling.rooms.forEach(function (r) { visibleRooms[r.id] = true; });
    } else {
      visibleRooms[camRoom] = true;
      var room = Culling.rooms[camRoom];
      if (room) {
        room.portals.forEach(function (p) {
          /* portal chỉ mở khi nó nằm trong frustum camera */
          var pv = new THREE.Vector3(p.x, camera.position.y, p.z);
          if (!frustum || frustum.containsPoint(pv)) visibleRooms[p.to] = true;
        });
      }
    }
    var culled = 0, visible = 0;
    Object.keys(Culling.entries).forEach(function (uuid) {
      var e = Culling.entries[uuid];
      /* object chưa gán phòng (vd tường, vật ngoài mặt bằng) -> luôn hiện.
         Ép boolean: visibleRooms[id] vắng mặt trả undefined, không được
         để undefined rò thành object.visible (lỗi thật: visible=undefined). */
      var show = e.rooms.length === 0 || !!visibleRooms[e.rooms[0]];
      var want = !!(show && e.userVisible);
      if (e.object3D.visible !== want) e.object3D.visible = want;
      e.culled = !show && e.userVisible;
      if (e.culled) culled++; else if (want) visible++;
    });
    Culling.stats.culled = culled;
    Culling.stats.visible = visible;
    Culling.stats.updates++;
    Culling.stats.lastUpdateMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    return Culling.stats;
  };

  /* ---------- BẬT / TẮT ---------- */
  Culling.setEnabled = function (on, opts) {
    opts = opts || {};
    if (on && !Object.keys(Culling.entries).length) Culling.buildIndex();
    if (on && Culling.portalMode) Culling.buildRooms();
    Culling.enabled = !!on;
    if (!on) Culling.restoreAll();
    else Culling._lastCamPos = null;
    emit('culling:toggled', { enabled: Culling.enabled });
    return Culling.enabled;
  };

  /* Khôi phục visible gốc cho mọi object đã index. */
  Culling.restoreAll = function () {
    Object.keys(Culling.entries).forEach(function (uuid) {
      var e = Culling.entries[uuid];
      if (e.object3D.visible !== e.userVisible) e.object3D.visible = e.userVisible;
      e.culled = false;
    });
    Culling.stats.culled = 0;
  };

  Culling.setCellSize = function (size) {
    Culling.cellSize = Math.max(1, Math.min(16, size || 4));
    Culling.buildIndex();
    if (Culling.enabled) Culling.update(Culling._lastCamera, true);
    return Culling.cellSize;
  };

  Culling.setPortalMode = function (on) {
    Culling.portalMode = !!on;
    if (on) {
      var rooms = Culling.buildRooms();
      if (rooms.length < 2) {
        Culling.portalMode = false;
        emit('culling:portalFallback', { rooms: rooms.length, reason: 'không đủ 2 phòng — rơi về cell culling' });
        return false;
      }
    }
    if (Culling.enabled) Culling.update(Culling._lastCamera, true);
    return Culling.portalMode;
  };

  Culling.statsSnapshot = function () {
    var s = Culling.stats;
    return {
      enabled: Culling.enabled, portalMode: Culling.portalMode,
      total: s.total, culled: s.culled, visible: s.visible,
      cells: s.cells, rooms: s.rooms,
      cellSize: Culling.cellSize, neighborRadius: Culling.neighborRadius,
      cameraCell: Culling._camCell, cameraRoom: Culling._camRoom,
      lastUpdateMs: Math.round(s.lastUpdateMs * 100) / 100, updates: s.updates
    };
  };

  /* Đo frame time của update() trên N lần gọi (harness/benchmark):
   * trả về { calls, totalMs, avgMs }. */
  Culling.benchmarkUpdate = function (camera, calls) {
    calls = calls || 100;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (var i = 0; i < calls; i++) Culling.update(camera, true);
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return { calls: calls, totalMs: t1 - t0, avgMs: (t1 - t0) / calls };
  };

  /* ---------- UI PANEL ---------- */
  Culling.renderPanel = function (container) {
    var wrap = container || (typeof document !== 'undefined' ? document.getElementById('scene-page-body') : null);
    if (!wrap || typeof document === 'undefined') return null;
    var old = wrap.querySelector('[data-culling-panel]');
    if (old) old.remove();

    var block = document.createElement('div');
    block.className = 'page-block';
    block.setAttribute('data-culling-panel', '1');
    var h = document.createElement('h4');
    h.textContent = 'Occlusion Culling (cell + portal)';
    block.appendChild(h);
    var note = document.createElement('div');
    note.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:6px;';
    note.textContent = 'Heuristic theo cell/phòng — không phải occlusion query GPU. Vật ngoài cell/phòng camera bị ẩn tạm, quay lại sẽ hiện. Vật user ẩn tay không bị đụng.';
    block.appendChild(note);

    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    var lbl = document.createElement('span');
    lbl.textContent = 'Cell:';
    lbl.style.fontSize = '12px';
    row1.appendChild(lbl);
    var sel = document.createElement('select');
    sel.className = 'arp-select';
    sel.style.cssText = 'padding:4px 6px;';
    [2, 4, 8].forEach(function (s) {
      var o = document.createElement('option');
      o.value = String(s); o.textContent = s + 'm';
      if (s === Culling.cellSize) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { Culling.setCellSize(parseInt(sel.value, 10) || 4); refresh(); };
    row1.appendChild(sel);
    var portalChk = document.createElement('label');
    portalChk.style.cssText = 'font-size:12px;display:flex;gap:4px;align-items:center;';
    var portalBox = document.createElement('input');
    portalBox.type = 'checkbox';
    portalBox.checked = Culling.portalMode;
    portalBox.onchange = function () {
      var ok = Culling.setPortalMode(portalBox.checked);
      if (!ok && portalBox.checked) {
        portalBox.checked = false;
        status.textContent = 'Không phát hiện đủ 2 phòng (cần tường box mỏng + cao) — đã rơi về cell culling.';
      }
      refresh();
    };
    portalChk.appendChild(portalBox);
    portalChk.appendChild(document.createTextNode('Portal / Room'));
    row1.appendChild(portalChk);
    block.appendChild(row1);

    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;';
    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn sm';
    toggleBtn.textContent = Culling.enabled ? 'Tắt culling' : 'Bật culling';
    toggleBtn.onclick = function () {
      var on = Culling.setEnabled(!Culling.enabled);
      toggleBtn.textContent = on ? 'Tắt culling' : 'Bật culling';
      refresh();
    };
    row2.appendChild(toggleBtn);
    var rebuildBtn = document.createElement('button');
    rebuildBtn.className = 'btn sm';
    rebuildBtn.textContent = 'Rebuild index';
    rebuildBtn.onclick = function () { Culling.rebuild(); refresh(); };
    row2.appendChild(rebuildBtn);
    block.appendChild(row2);

    var status = document.createElement('div');
    status.style.cssText = 'font-size:12px;margin-top:6px;min-height:16px;';
    block.appendChild(status);

    function refresh() {
      var s = Culling.statsSnapshot();
      status.textContent = s.enabled
        ? ('BẬT — ' + s.culled + '/' + s.total + ' object đã cull, ' + s.visible + ' đang hiện, ' + s.cells + ' cell, ' +
           (s.portalMode ? s.rooms + ' phòng (portal)' : 'cell ' + s.cellSize + 'm') +
           ', update ' + s.lastUpdateMs + 'ms.')
        : ('TẮT — ' + s.total + ' object đã index, ' + s.cells + ' cell' + (s.rooms ? ', ' + s.rooms + ' phòng' : '') + '.');
    }
    refresh();
    Culling._refreshUI = refresh;
    wrap.appendChild(block);
    return block;
  };

  window.PixiStudio.OcclusionCulling = Culling;
})();
