/* ============================================================
 * renderer/three-renderer.js — WebGL renderer (Three.js)
 * ============================================================ */
(function () {
  'use strict';

  const ThreeRenderer = {
    renderer: null,
    webgl2: false,
    maxTextureSize: 0,
    capabilities: {}
  };

  ThreeRenderer.create = function (canvas) {
    if (!window.THREE) {
      console.error('[ThreeRenderer] THREE chưa load (CDN thất bại?)');
      return null;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,                       /* nền CSS gradient làm background */
      preserveDrawingBuffer: false,      /* screenshot tự render trước khi capture */
      powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(1); /* SAFE MODE: pixelRatio 1 — fix IAB GPU block */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);   /* alpha 0 — để nền gradient hiện */

    ThreeRenderer.renderer = renderer;

    /* Capabilities thật từ WebGL context */
    const gl = renderer.getContext();
    ThreeRenderer.webgl2 = renderer.capabilities.isWebGL2 === true;
    ThreeRenderer.maxTextureSize = renderer.capabilities.maxTextureSize || 0;
    ThreeRenderer.capabilities = {
      webgl2: ThreeRenderer.webgl2,
      maxTextureSize: ThreeRenderer.maxTextureSize,
      maxVertexTextures: renderer.capabilities.maxVertexTextures,
      extensions: {
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
        floatTextures: !!gl.getExtension('OES_texture_float'),
        standardDerivatives: !!(gl.getExtension('OES_standard_derivatives'))
      }
    };

    /* WebGPU detect (thông tin, chưa dùng render path) */
    ThreeRenderer.webgpuAvailable = !!(navigator.gpu && navigator.gpu.requestAdapter);

    return renderer;
  };

  ThreeRenderer.resize = function (width, height) {
    if (!ThreeRenderer.renderer) return;
    ThreeRenderer.renderer.setSize(width, height, false);
  };

  /* Render 1 camera full-view */
  ThreeRenderer.render = function (scene, camera) {
    if (!ThreeRenderer.renderer) return;
    ThreeRenderer.renderer.setScissorTest(false);
    ThreeRenderer.renderer.setViewport(0, 0, ThreeRenderer.renderer.domElement.width / ThreeRenderer.renderer.getPixelRatio(),
      ThreeRenderer.renderer.domElement.height / ThreeRenderer.renderer.getPixelRatio());
    ThreeRenderer.renderer.render(scene, camera);
  };

  /* Render quad với scissor (quad view) — rects đã ở đơn vị CSS px */
  ThreeRenderer.renderQuad = function (scene, cameras, rects) {
    const r = ThreeRenderer.renderer;
    if (!r) return;
    r.setScissorTest(true);
    for (let i = 0; i < cameras.length && i < 4; i++) {
      const rc = rects[i];
      const x = rc.x, y = rc.y, w = rc.w, h = rc.h;
      if (w <= 0 || h <= 0) continue;
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(scene, cameras[i]);
    }
    r.setScissorTest(false);
  };

  /* Render offscreen ở độ phân giải tuỳ ý → trả về dataURL */
  ThreeRenderer.renderToImage = function (scene, camera, width, height, format) {
    if (!ThreeRenderer.renderer) return null;
    const r = ThreeRenderer.renderer;
    const oldSize = new THREE.Vector2();
    r.getSize(oldSize);
    const oldPR = r.getPixelRatio();

    /* Canvas tạm riêng để không phá viewport chính */
    const tmp = new THREE.WebGLRenderer({
      antialias: true, alpha: true, preserveDrawingBuffer: true
    });
    tmp.setPixelRatio(1);
    tmp.setSize(width, height, false);
    tmp.shadowMap.enabled = true;
    tmp.shadowMap.type = THREE.PCFSoftShadowMap;
    tmp.outputEncoding = THREE.sRGBEncoding;
    tmp.toneMapping = THREE.ACESFilmicToneMapping;
    tmp.toneMappingExposure = 1.12;
    tmp.setClearColor(0x000000, 0);

    /* Nền gradient vẽ canvas 2D phía sau */
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    const grad = ctx.createRadialGradient(width / 2, height * 0.2, 40, width / 2, height * 0.3, Math.max(width, height) * 0.9);
    grad.addColorStop(0, '#26263a');
    grad.addColorStop(0.55, '#171722');
    grad.addColorStop(1, '#0e0e14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    tmp.render(scene, camera);
    const src = tmp.domElement;
    ctx.drawImage(src, 0, 0, width, height);
    const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = out.toDataURL(mime, 0.94);

    tmp.dispose();
    tmp.forceContextLoss && tmp.forceContextLoss();

    return dataUrl;
  };

  window.PixiStudio.ThreeRenderer = ThreeRenderer;
})();
