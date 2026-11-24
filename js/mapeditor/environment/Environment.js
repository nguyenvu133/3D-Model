/* ============================================================
 * mapeditor/environment/Environment.js — Sky, fog, thời tiết,
 * ngày/đêm, tuyết rơi. Preset thật (đổi màu trời/fog/đèn/tuyết).
 * Bloom KHÔNG làm — ghi rõ planned trong panel (không giả vờ).
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var PRESETS = {
    snow: {
      name: 'Tuyết rơi', sky: 0x9db8d9, fogColor: 0x9db8d9, fogNear: 60, fogFar: 180,
      sunColor: 0xfff2cc, sunIntensity: 1.05, hemiIntensity: 0.85, snow: true
    },
    sunny: {
      name: 'Nắng', sky: 0x7ec0ee, fogColor: 0xa8d0e8, fogNear: 80, fogFar: 260,
      sunColor: 0xfff8e0, sunIntensity: 1.35, hemiIntensity: 0.95, snow: false
    },
    cloudy: {
      name: 'Nhiều mây', sky: 0x8a9aa8, fogColor: 0x8a9aa8, fogNear: 45, fogFar: 140,
      sunColor: 0xe8e8e8, sunIntensity: 0.7, hemiIntensity: 0.6, snow: false
    },
    night: {
      name: 'Đêm', sky: 0x0a0e1e, fogColor: 0x0a0e1e, fogNear: 30, fogFar: 120,
      sunColor: 0x8aa0ff, sunIntensity: 0.25, hemiIntensity: 0.25, snow: false
    },
    sunset: {
      name: 'Hoàng hôn', sky: 0xe8805a, fogColor: 0xd86a4a, fogNear: 55, fogFar: 170,
      sunColor: 0xff9a50, sunIntensity: 0.9, hemiIntensity: 0.55, snow: false
    },
    dawn: {
      name: 'Bình minh', sky: 0xf2c9a0, fogColor: 0xe8b890, fogNear: 70, fogFar: 220,
      sunColor: 0xffd9a0, sunIntensity: 0.8, hemiIntensity: 0.7, snow: false
    },
    storm: {
      name: 'Bão tố', sky: 0x4a5260, fogColor: 0x4a5260, fogNear: 25, fogFar: 90,
      sunColor: 0xb8c8d8, sunIntensity: 0.45, hemiIntensity: 0.4, snow: false
    },
    mist: {
      name: 'Sương mù dày', sky: 0xb8c8d0, fogColor: 0xb8c8d0, fogNear: 15, fogFar: 70,
      sunColor: 0xe8e8e8, sunIntensity: 0.6, hemiIntensity: 0.6, snow: false
    }
  };

  /* preset sương mù (chỉ fog, không đổi thời tiết) */
  var FOG_PRESETS = {
    clear: { name: 'Sương mỏng', near: 100, far: 320 },
    normal: { name: 'Mặc định', near: 60, far: 180 },
    dense: { name: 'Sương dày', near: 20, far: 90 }
  };

  var Environment = {
    current: 'snow',
    timeOfDay: 10
  };

  Environment.apply = function (env) {
    if (!env || !ME.Viewport3D || !ME.Viewport3D.scene) return;
    var V = ME.Viewport3D;
    var sky = new THREE.Color(env.sky !== undefined ? env.sky : 0x9db8d9);
    V.scene.background = sky;
    if (env.fog) {
      V.scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
    }
    if (env.sun) {
      V.sun.color.setHex(env.sun.color);
      V.sun.intensity = env.sun.intensity;
    }
    if (V.hemi && env.sun) V.hemi.intensity = 0.85 * (env.sun.intensity || 1);
    if (env.snow !== undefined) V.setSnowVisible(env.snow);
    if (env.timeOfDay !== undefined) Environment.timeOfDay = env.timeOfDay;
  };

  Environment.applyPreset = function (name) {
    var p = PRESETS[name];
    if (!p || !ME.Viewport3D || !ME.Viewport3D.scene) return false;
    Environment.current = name;
    var env = {
      weather: name, sky: p.sky,
      fog: { color: p.fogColor, near: p.fogNear, far: p.fogFar },
      sun: { color: p.sunColor, intensity: p.sunIntensity },
      timeOfDay: Environment.timeOfDay,
      snow: p.snow
    };
    Environment.apply(env);
    if (ME.MapEditor && ME.MapEditor.data) {
      ME.MapEditor.data.environment = env;
    }
    return true;
  };

  /* ngày/đêm: giờ 0-24 → góc mặt trời + cường độ */
  Environment.setTimeOfDay = function (hour) {
    hour = Math.max(0, Math.min(24, hour));
    Environment.timeOfDay = hour;
    var V = ME.Viewport3D;
    if (!V || !V.sun) return;
    var ang = (hour - 6) / 12 * Math.PI; /* 6h mọc, 18h lặn */
    var elev = Math.sin(ang);
    var dayFactor = Math.max(0.08, Math.min(1, elev * 1.4 + 0.25));
    V.sun.position.set(Math.cos(ang) * 60, Math.max(8, elev * 60 + 12), 20);
    V.sun.intensity = 1.05 * dayFactor;
    if (V.hemi) V.hemi.intensity = 0.85 * Math.max(0.15, dayFactor);
    /* trời tối dần về đêm */
    var night = 1 - Math.max(0, Math.min(1, dayFactor * 1.2));
    var sky = new THREE.Color(V.scene.background);
    var daySky = new THREE.Color(0x9db8d9);
    var nightSky = new THREE.Color(0x0a0e1e);
    sky.copy(daySky).lerp(nightSky, night);
    V.scene.background = sky;
    if (V.scene.fog) V.scene.fog.color.copy(sky);
    if (ME.MapEditor && ME.MapEditor.data && ME.MapEditor.data.environment) {
      ME.MapEditor.data.environment.timeOfDay = hour;
    }
  };

  Environment.setFog = function (near, far) {
    var V = ME.Viewport3D;
    if (!V || !V.scene || !V.scene.fog) return;
    V.scene.fog.near = near;
    V.scene.fog.far = far;
    if (ME.MapEditor && ME.MapEditor.data && ME.MapEditor.data.environment && ME.MapEditor.data.environment.fog) {
      ME.MapEditor.data.environment.fog.near = near;
      ME.MapEditor.data.environment.fog.far = far;
    }
  };

  Environment.applyFogPreset = function (name) {
    var p = FOG_PRESETS[name];
    if (!p) return false;
    Environment.setFog(p.near, p.far);
    return true;
  };

  Environment.PRESETS = PRESETS;
  Environment.FOG_PRESETS = FOG_PRESETS;
  ME.Environment = Environment;
})();
