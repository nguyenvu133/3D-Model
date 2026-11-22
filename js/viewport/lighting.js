/* ============================================================
 * viewport/lighting.js — Studio lighting 3 điểm + hemisphere
 * Ánh sáng studio ấm/lạnh xen kẽ cho chibi võ hiệp.
 * ============================================================ */
(function () {
  'use strict';

  const Lighting = { group: null, lights: {} };

  Lighting.create = function () {
    if (!window.THREE) return null;
    const group = new THREE.Group();
    group.name = '__lighting__';

    /* Hemisphere — nền trời lạnh / đất ấm */
    const hemi = new THREE.HemisphereLight(0x8a8aff, 0x2a2233, 0.55);
    hemi.name = 'Hemisphere Light';
    group.add(hemi);

    /* Key light — chính, mạnh, đổ shadow */
    const key = new THREE.DirectionalLight(0xfff4e0, 1.15);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    /* 1024 là đủ nét cho 1 nhân vật + mặt đất; 2048 tốn 4× pixel shadow mỗi frame
       (đo thật: giảm được ~3 FPS trong môi trường render software) */
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    key.name = 'Key Light (Directional)';
    group.add(key);

    /* Fill — xanh nhẹ từ trái, làm dịu shadow */
    const fill = new THREE.DirectionalLight(0x9fbfff, 0.35);
    fill.position.set(-6, 3, 2);
    fill.name = 'Fill Light (Directional)';
    group.add(fill);

    /* Rim — tím viền sau, tách model khỏi nền */
    const rim = new THREE.DirectionalLight(0xb79bff, 0.55);
    rim.position.set(-2, 5, -6);
    rim.name = 'Rim Light (Directional)';
    group.add(rim);

    /* Ambient nhẹ */
    const ambient = new THREE.AmbientLight(0x404050, 0.55);
    ambient.name = 'Ambient Light';
    group.add(ambient);

    /* Point light + Spot light — có sẵn trong hierarchy, mặc định ẩn */
    const point = new THREE.PointLight(0xffaa55, 0.9, 12);
    point.position.set(2.5, 2.5, 2.5);
    point.name = 'Point Light';
    point.visible = false;
    group.add(point);

    const spot = new THREE.SpotLight(0xffffff, 1.2, 20, Math.PI / 5, 0.35, 1);
    spot.position.set(0, 8, 0);
    spot.target.position.set(0, 0, 0);
    spot.name = 'Spot Light';
    spot.visible = false;
    group.add(spot);
    group.add(spot.target);

    Lighting.group = group;
    Lighting.lights = { hemi: hemi, key: key, fill: fill, rim: rim, ambient: ambient, point: point, spot: spot };
    return group;
  };

  Lighting.setShadows = function (on) {
    if (Lighting.lights.key) Lighting.lights.key.castShadow = !!on;
  };

  Lighting.setShadowQuality = function (size) {
    const key = Lighting.lights.key;
    if (!key) return 0;
    key.shadow.mapSize.set(size, size);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    if (PixiStudio.RendererManager && PixiStudio.RendererManager.markShadowDirty) PixiStudio.RendererManager.markShadowDirty();
    return size;
  };

  window.PixiStudio.Lighting = Lighting;
})();
