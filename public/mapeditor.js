// ===========================================================================
// mapeditor.js — Map editor: draw walls/doors/windows/cover objects,
// undo stack, save/load JSON, spawn point placement
// ===========================================================================

const MAPEDITOR = (() => {
  let mapGroup; // THREE.Group holding all map geometry
  let currentTool = 'select';
  let isEditorActive = true;

  // Map data model — single source of truth, geometry derived from this
  let mapData = {
    walls: [],   // {id, x1,z1,x2,z2, thickness, height}
    doors: [],   // {id, x,z, angle, width, isOpen}
    windows: [], // {id, x,z, angle, width}
    covers: [],  // {id, x,z, w,d, h}
    spawns: [],  // {id, x,z, team} -- team spawn markers (not units themselves)
  };

  let undoStack = [];
  const UNDO_LIMIT = 50;
  let applyingRemote = false; // true while applying a remote update, to prevent echo broadcasts

  // drawing state
  let isDrawing = false;
  let drawStart = null; // THREE.Vector3
  let previewMesh = null;

  const WALL_HEIGHT = 2.6;
  const WALL_THICKNESS = 0.2;

  function pushUndoSnapshot() {
    undoStack.push(JSON.stringify(mapData));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) {
      UI.toast('Nothing to undo', 'info');
      return;
    }
    mapData = JSON.parse(undoStack.pop());
    rebuildMapGeometry();
    UI.toast('Undo', 'info');
  }

  function init(scene) {
    mapGroup = new THREE.Group();
    mapGroup.name = 'mapGroup';
    scene.add(mapGroup);
  }

  function setTool(tool) {
    currentTool = tool;
    cancelDrawing();
    document.querySelectorAll('.rail-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    const hints = {
      select: 'Click an element to inspect/delete it.',
      wall: 'Click + drag to draw a wall. Release to place.',
      door: 'Click on or near a wall to place a door.',
      window: 'Click on or near a wall to place a window.',
      cover: 'Click + drag to size a cover object (crate/barrier).',
      spawn: 'Click to place a unit spawn point.',
      erase: 'Click + drag to erase elements (MS-Paint style brush).',
    };
    UI.setHint(hints[tool] || '');
  }

  function getTool() { return currentTool; }

  function setActive(active) {
    isEditorActive = active;
    mapGroup.visible = true; // map always visible; editor just controls interactivity
  }
  function isActive() { return isEditorActive; }

  // ---- Drawing interaction (called from controls.js) ----
  function onPointerDown(groundPoint) {
    if (!isEditorActive || !groundPoint) return;
    if (currentTool === 'wall' || currentTool === 'cover') {
      isDrawing = true;
      drawStart = groundPoint.clone();
    } else if (currentTool === 'door' || currentTool === 'window') {
      placeOpeningNearWall(groundPoint, currentTool);
    } else if (currentTool === 'spawn') {
      placeSpawn(groundPoint);
    } else if (currentTool === 'erase') {
      isDrawing = true;
      eraseNear(groundPoint);
    }
  }

  function onPointerMove(groundPoint) {
    if (!isDrawing || !groundPoint) return;
    if (currentTool === 'wall') {
      updateWallPreview(drawStart, groundPoint);
    } else if (currentTool === 'cover') {
      updateCoverPreview(drawStart, groundPoint);
    } else if (currentTool === 'erase') {
      eraseNear(groundPoint);
    }
  }

  function onPointerUp(groundPoint) {
    if (!isDrawing) return;
    if (currentTool === 'wall' && groundPoint && drawStart) {
      finalizeWall(drawStart, groundPoint);
    } else if (currentTool === 'cover' && groundPoint && drawStart) {
      finalizeCover(drawStart, groundPoint);
    }
    isDrawing = false;
    drawStart = null;
    clearPreview();
  }

  function cancelDrawing() {
    isDrawing = false;
    drawStart = null;
    clearPreview();
  }

  function clearPreview() {
    if (previewMesh) {
      mapGroup.remove(previewMesh);
      previewMesh.geometry.dispose();
      previewMesh.material.dispose();
      previewMesh = null;
    }
  }

  // ---- WALL ----
  function updateWallPreview(start, end) {
    clearPreview();
    const len = Math.max(0.1, start.distanceTo(end));
    const geo = new THREE.BoxGeometry(len, WALL_HEIGHT, WALL_THICKNESS);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.45 });
    previewMesh = new THREE.Mesh(geo, mat);
    positionWallMesh(previewMesh, start, end);
    mapGroup.add(previewMesh);
  }

  function positionWallMesh(mesh, start, end) {
    const midX = (start.x + end.x) / 2;
    const midZ = (start.z + end.z) / 2;
    const angle = Math.atan2(end.z - start.z, end.x - start.x);
    mesh.position.set(midX, WALL_HEIGHT / 2, midZ);
    mesh.rotation.y = -angle;
  }

  function finalizeWall(start, end) {
    if (start.distanceTo(end) < 0.3) return; // too short, ignore
    pushUndoSnapshot();
    const id = 'wall_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    mapData.walls.push({
      id, x1: start.x, z1: start.z, x2: end.x, z2: end.z,
      thickness: WALL_THICKNESS, height: WALL_HEIGHT,
    });
    rebuildMapGeometry();
    UI.toast('Wall placed', 'info');
  }

  // ---- COVER OBJECT ----
  function updateCoverPreview(start, end) {
    clearPreview();
    const w = Math.max(0.2, Math.abs(end.x - start.x));
    const d = Math.max(0.2, Math.abs(end.z - start.z));
    const h = 1.0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.4 });
    previewMesh = new THREE.Mesh(geo, mat);
    previewMesh.position.set((start.x + end.x) / 2, h / 2, (start.z + end.z) / 2);
    mapGroup.add(previewMesh);
  }

  function finalizeCover(start, end) {
    const w = Math.max(0.2, Math.abs(end.x - start.x));
    const d = Math.max(0.2, Math.abs(end.z - start.z));
    if (w < 0.3 || d < 0.3) return;
    pushUndoSnapshot();
    const id = 'cover_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    mapData.covers.push({
      id, x: (start.x + end.x) / 2, z: (start.z + end.z) / 2, w, d, h: 1.0,
    });
    rebuildMapGeometry();
    UI.toast('Cover object placed', 'info');
  }

  // ---- DOOR / WINDOW (snap to nearest wall) ----
  function placeOpeningNearWall(point, type) {
    let nearestWall = null;
    let nearestDist = Infinity;
    let nearestT = 0.5;
    for (const wall of mapData.walls) {
      const a = new THREE.Vector2(wall.x1, wall.z1);
      const b = new THREE.Vector2(wall.x2, wall.z2);
      const p = new THREE.Vector2(point.x, point.z);
      const ab = b.clone().sub(a);
      const abLenSq = ab.lengthSq();
      if (abLenSq < 0.0001) continue;
      let t = p.clone().sub(a).dot(ab) / abLenSq;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const closest = a.clone().add(ab.clone().multiplyScalar(t));
      const dist = closest.distanceTo(p);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestWall = wall;
        nearestT = t;
      }
    }
    if (!nearestWall || nearestDist > 2.5) {
      UI.toast('Place ' + type + ' closer to a wall', 'warn');
      return;
    }
    pushUndoSnapshot();
    const x = nearestWall.x1 + (nearestWall.x2 - nearestWall.x1) * nearestT;
    const z = nearestWall.z1 + (nearestWall.z2 - nearestWall.z1) * nearestT;
    const angle = Math.atan2(nearestWall.z2 - nearestWall.z1, nearestWall.x2 - nearestWall.x1);
    const id = type + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const opening = { id, x, z, angle, width: 1.0, wallId: nearestWall.id };
    if (type === 'door') {
      opening.isOpen = true;
      mapData.doors.push(opening);
    } else {
      mapData.windows.push(opening);
    }
    rebuildMapGeometry();
    UI.toast((type === 'door' ? 'Door' : 'Window') + ' placed', 'info');
  }

  // ---- SPAWN ----
  function placeSpawn(point) {
    pushUndoSnapshot();
    const id = 'spawn_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    mapData.spawns.push({ id, x: point.x, z: point.z });
    rebuildMapGeometry();
    UNITS.spawnUnitAt(point.x, point.z);
    UI.toast('Unit spawned', 'info');
  }

  // ---- ERASE ----
  function eraseNear(point) {
    const RADIUS = 1.0;
    let changed = false;
    const distToSegment = (px, pz, x1, z1, x2, z2) => {
      const a = new THREE.Vector2(x1, z1), b = new THREE.Vector2(x2, z2), p = new THREE.Vector2(px, pz);
      const ab = b.clone().sub(a);
      const abLenSq = ab.lengthSq();
      let t = abLenSq < 0.0001 ? 0 : p.clone().sub(a).dot(ab) / abLenSq;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const closest = a.clone().add(ab.clone().multiplyScalar(t));
      return closest.distanceTo(p);
    };

    const before = JSON.stringify(mapData);

    mapData.walls = mapData.walls.filter(w => distToSegment(point.x, point.z, w.x1, w.z1, w.x2, w.z2) > RADIUS);
    mapData.covers = mapData.covers.filter(c => Math.hypot(c.x - point.x, c.z - point.z) > RADIUS);
    mapData.doors = mapData.doors.filter(d => Math.hypot(d.x - point.x, d.z - point.z) > RADIUS);
    mapData.windows = mapData.windows.filter(w => Math.hypot(w.x - point.x, w.z - point.z) > RADIUS);
    mapData.spawns = mapData.spawns.filter(s => Math.hypot(s.x - point.x, s.z - point.z) > RADIUS);

    if (before !== JSON.stringify(mapData)) {
      changed = true;
      rebuildMapGeometry();
    }
    return changed;
  }

  // ---- GEOMETRY REBUILD ----
  function rebuildMapGeometry() {
    // clear existing
    while (mapGroup.children.length) {
      const child = mapGroup.children[0];
      mapGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7a72, roughness: 0.85, metalness: 0.1 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x4a7a9a, roughness: 0.3, transparent: true, opacity: 0.45 });
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x9a8a4a, roughness: 0.8 });
    const spawnMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5 });

    for (const wall of mapData.walls) {
      const start = new THREE.Vector3(wall.x1, 0, wall.z1);
      const end = new THREE.Vector3(wall.x2, 0, wall.z2);
      const len = start.distanceTo(end);

      // Check for openings on this wall to carve gaps (visual only, simplified as full wall + opening markers)
      const geo = new THREE.BoxGeometry(len, wall.height, wall.thickness);
      const mesh = new THREE.Mesh(geo, wallMat);
      positionWallMesh(mesh, start, end);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { type: 'wall', id: wall.id };
      mapGroup.add(mesh);
    }

    for (const door of mapData.doors) {
      const geo = new THREE.BoxGeometry(door.width, 2.0, 0.12);
      const mesh = new THREE.Mesh(geo, doorMat);
      mesh.position.set(door.x, 1.0, door.z);
      mesh.rotation.y = -door.angle;
      mesh.userData = { type: 'door', id: door.id };
      mesh.castShadow = true;
      mapGroup.add(mesh);

      // door frame indicator (fatal funnel marker, subtle)
      const frameGeo = new THREE.RingGeometry(0.05, 0.12, 16);
      const frameMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const frameMesh = new THREE.Mesh(frameGeo, frameMat);
      frameMesh.position.set(door.x, 0.02, door.z);
      frameMesh.rotation.x = -Math.PI / 2;
      mapGroup.add(frameMesh);
    }

    for (const win of mapData.windows) {
      const geo = new THREE.BoxGeometry(win.width, 1.0, 0.1);
      const mesh = new THREE.Mesh(geo, windowMat);
      mesh.position.set(win.x, 1.3, win.z);
      mesh.rotation.y = -win.angle;
      mesh.userData = { type: 'window', id: win.id };
      mapGroup.add(mesh);
    }

    for (const cover of mapData.covers) {
      const geo = new THREE.BoxGeometry(cover.w, cover.h, cover.d);
      const mesh = new THREE.Mesh(geo, coverMat);
      mesh.position.set(cover.x, cover.h / 2, cover.z);
      mesh.userData = { type: 'cover', id: cover.id };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mapGroup.add(mesh);
    }

    for (const spawn of mapData.spawns) {
      const geo = new THREE.RingGeometry(0.35, 0.45, 24);
      const mesh = new THREE.Mesh(geo, spawnMat);
      mesh.position.set(spawn.x, 0.03, spawn.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData = { type: 'spawn', id: spawn.id };
      mapGroup.add(mesh);
    }

    // Any time the map geometry is rebuilt because of a LOCAL edit (drawing,
    // erasing, undo, clearing), tell the server so other players see it too.
    // We skip this when the rebuild was triggered by an incoming remote
    // update, otherwise we'd echo the same change back out forever.
    if (!applyingRemote && window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendMapUpdate(mapData);
    }
  }

  function clearMap() {
    pushUndoSnapshot();
    mapData = { walls: [], doors: [], windows: [], covers: [], spawns: [] };
    rebuildMapGeometry();
    UI.toast('Map cleared', 'warn');
  }

  function getMapData() { return mapData; }

  function saveMapToFile() {
    const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cqb_map_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('Map saved to file', 'info');
  }

  function loadMapFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loaded = JSON.parse(e.target.result);
        pushUndoSnapshot();
        mapData = {
          walls: loaded.walls || [],
          doors: loaded.doors || [],
          windows: loaded.windows || [],
          covers: loaded.covers || [],
          spawns: loaded.spawns || [],
        };
        rebuildMapGeometry();
        UI.toast('Map loaded', 'info');
      } catch (err) {
        UI.toast('Failed to load map file', 'danger');
      }
    };
    reader.readAsText(file);
  }

  // ---- Network sync ----
  // When this client makes a change, broadcast it. We guard with a flag so
  // that applying a REMOTE update (received from another player) doesn't
  // immediately bounce right back out to the network (infinite echo).

  // Used once, right when a player joins a room, to instantly match the
  // map that's already on the server (and on every other player's screen).
  function loadMapFromData(remoteMapData) {
    applyingRemote = true;
    mapData = {
      walls: remoteMapData.walls || [],
      doors: remoteMapData.doors || [],
      windows: remoteMapData.windows || [],
      covers: remoteMapData.covers || [],
      spawns: remoteMapData.spawns || [],
    };
    rebuildMapGeometry();
    applyingRemote = false;
  }

  // Used continuously: whenever ANOTHER player draws/erases something,
  // the server relays it here and we redraw to match.
  function applyRemoteMapUpdate(remoteMapData) {
    applyingRemote = true;
    mapData = {
      walls: remoteMapData.walls || [],
      doors: remoteMapData.doors || [],
      windows: remoteMapData.windows || [],
      covers: remoteMapData.covers || [],
      spawns: remoteMapData.spawns || [],
    };
    rebuildMapGeometry();
    applyingRemote = false;
  }

  // Geometry queries used by other modules (collision, fog raycasting)
  function getWallSegments() {
    return mapData.walls.map(w => ({
      x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, thickness: w.thickness, id: w.id,
    }));
  }
  function getCoverBoxes() {
    return mapData.covers.map(c => ({
      minX: c.x - c.w / 2, maxX: c.x + c.w / 2,
      minZ: c.z - c.d / 2, maxZ: c.z + c.d / 2, id: c.id,
    }));
  }
  function getDoors() { return mapData.doors; }

  return {
    init, setTool, getTool, setActive, isActive,
    onPointerDown, onPointerMove, onPointerUp, cancelDrawing,
    undo, clearMap, getMapData, saveMapToFile, loadMapFromFile,
    loadMapFromData, applyRemoteMapUpdate,
    getWallSegments, getCoverBoxes, getDoors, rebuildMapGeometry,
  };
})();
