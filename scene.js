// ===========================================================================
// scene.js — Core Three.js scene, camera, lighting, ground grid, render loop
// ===========================================================================

const SCENE = (() => {
  let scene, camera, renderer;
  let groundPlane, gridHelper;
  let clock;

  // Camera config (top-down tilted ~70deg)
  const CAM_TILT_DEG = 70; // angle from vertical-down; 90 = pure top-down, lower = more angled
  const CAM_MIN_DIST = 6;
  const CAM_MAX_DIST = 55;
  let camDistance = 22;
  let camTarget = new THREE.Vector3(0, 0, 0); // point camera looks at (on ground plane)

  const MAP_SIZE = 60; // world units (meters), map spans -30..30

  function init(containerEl) {
    clock = new THREE.Clock();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d0a);
    scene.fog = new THREE.Fog(0x0a0d0a, 40, 90);

    // Camera: perspective, positioned high and angled down
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerEl.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0x405040, 0.65);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xcde8d0, 0.85);
    dirLight.position.set(20, 35, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 100;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x224433, 0.25);
    fillLight.position.set(-15, 10, -10);
    scene.add(fillLight);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x141a12,
      roughness: 0.95,
      metalness: 0.05,
    });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    groundPlane.name = 'groundPlane';
    scene.add(groundPlane);

    // Grid overlay (tactical map look)
    gridHelper = new THREE.GridHelper(MAP_SIZE, MAP_SIZE / 1, 0x2a3a28, 0x1a2418);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Subtle boundary line
    const boundaryGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE));
    const boundaryMat = new THREE.LineBasicMaterial({ color: 0x3a8a5a, transparent: true, opacity: 0.4 });
    const boundary = new THREE.LineSegments(boundaryGeo, boundaryMat);
    boundary.rotation.x = -Math.PI / 2;
    boundary.position.y = 0.02;
    scene.add(boundary);

    window.addEventListener('resize', onResize);
  }

  function updateCameraPosition() {
    const tiltRad = THREE.MathUtils.degToRad(CAM_TILT_DEG);
    const horizontalDist = camDistance * Math.cos(tiltRad);
    const verticalDist = camDistance * Math.sin(tiltRad);
    camera.position.set(
      camTarget.x,
      verticalDist,
      camTarget.z + horizontalDist
    );
    camera.lookAt(camTarget.x, 0, camTarget.z);
  }

  function panCamera(dx, dz) {
    // dx/dz already scaled by caller; move target on ground plane
    camTarget.x += dx;
    camTarget.z += dz;
    // clamp within map bounds
    const half = MAP_SIZE / 2 - 2;
    camTarget.x = THREE.MathUtils.clamp(camTarget.x, -half, half);
    camTarget.z = THREE.MathUtils.clamp(camTarget.z, -half, half);
    updateCameraPosition();
  }

  function zoomCamera(delta) {
    camDistance += delta;
    camDistance = THREE.MathUtils.clamp(camDistance, CAM_MIN_DIST, CAM_MAX_DIST);
    updateCameraPosition();
  }

  function resetCamera() {
    camTarget.set(0, 0, 0);
    camDistance = 22;
    updateCameraPosition();
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Project a screen point onto the ground plane (y=0), returns THREE.Vector3 or null
  const _raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  function screenToGround(clientX, clientY) {
    _ndc.x = (clientX / window.innerWidth) * 2 - 1;
    _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_ndc, camera);
    const planeY0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    const hit = _raycaster.ray.intersectPlane(planeY0, target);
    return hit ? target : null;
  }

  function worldToScreen(worldPos) {
    const v = worldPos.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  function raycastObjects(clientX, clientY, objects) {
    _ndc.x = (clientX / window.innerWidth) * 2 - 1;
    _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_ndc, camera);
    return _raycaster.intersectObjects(objects, true);
  }

  function getScene() { return scene; }
  function getCamera() { return camera; }
  function getRenderer() { return renderer; }
  function getClock() { return clock; }
  function getMapSize() { return MAP_SIZE; }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    init, render,
    panCamera, zoomCamera, resetCamera,
    screenToGround, worldToScreen, raycastObjects,
    getScene, getCamera, getRenderer, getClock, getMapSize,
  };
})();
