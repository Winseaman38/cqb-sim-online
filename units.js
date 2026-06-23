// ===========================================================================
// units.js — Unit entities: spawn, WASD movement w/ collision stop,
// mouse-aim direction, FOV cone visual, selection state, team color
// ===========================================================================

const UNITS = (() => {
  let unitGroup;
  let units = []; // {id, mesh, fovMesh, x, z, aimAngle, color, team, selected,
                  //  isControlled, status, formationSlot, moveTarget}
  let nextUnitNumber = 1;

  const UNIT_RADIUS = 0.32;
  const MOVE_SPEED = 3.2; // m/s
  const FOV_ANGLE_DEG = 58; // realistic focused aiming FOV
  const FOV_RANGE = 9;

  const TEAM_COLORS = [
    { name: 'Green', hex: 0x4ade80 },
    { name: 'Cyan', hex: 0x38bdf8 },
    { name: 'Amber', hex: 0xfacc15 },
    { name: 'Magenta', hex: 0xe879f9 },
    { name: 'Orange', hex: 0xfb923c },
  ];

  function init(scene) {
    unitGroup = new THREE.Group();
    unitGroup.name = 'unitGroup';
    scene.add(unitGroup);
  }

  function spawnUnitAt(x, z, colorHex, remoteId, remoteNumber) {
    const id = remoteId || ('unit_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
    const color = colorHex !== undefined ? colorHex : TEAM_COLORS[0].hex;
    const assignedNumber = remoteNumber !== undefined ? remoteNumber : nextUnitNumber;

    const group = new THREE.Group();

    // Body (capsule-ish: cylinder + sphere cap)
    const bodyGeo = new THREE.CylinderGeometry(UNIT_RADIUS, UNIT_RADIUS, 1.1, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.55;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const headGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.position.y = 1.25;
    headMesh.castShadow = true;
    group.add(headMesh);

    // Direction indicator (nose cone pointing aim direction)
    const noseGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const noseMesh = new THREE.Mesh(noseGeo, noseMat);
    noseMesh.position.set(0.32, 0.55, 0);
    noseMesh.rotation.z = -Math.PI / 2;
    group.add(noseMesh);

    // Selection ring (hidden by default)
    const ringGeo = new THREE.RingGeometry(UNIT_RADIUS + 0.08, UNIT_RADIUS + 0.18, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.03;
    ringMesh.visible = false;
    group.add(ringMesh);

    // Number label sprite
    const labelSprite = makeNumberSprite(assignedNumber);
    labelSprite.position.y = 1.75;
    group.add(labelSprite);

    group.position.set(x, 0, z);
    unitGroup.add(group);

    // FOV cone mesh (green coverage visual, separate from fog grid but useful direct feedback)
    const fovMesh = makeFovConeMesh(color);
    unitGroup.add(fovMesh);

    if (remoteNumber === undefined) nextUnitNumber++;
    else nextUnitNumber = Math.max(nextUnitNumber, remoteNumber + 1);

    const unit = {
      id,
      number: assignedNumber,
      mesh: group,
      bodyMesh, ringMesh, labelSprite,
      fovMesh,
      x, z,
      aimAngle: 0, // radians, 0 = +X axis
      color,
      team: 0,
      selected: false,
      isControlled: false,
      controlledBy: null, // playerId of whoever currently has this unit in direct control (network)
      status: 'HOLD', // HOLD, MOVING, COVERING, BLOCKED
      formationSlot: null,
      role: null,
      moveTarget: null,
      sectorAngle: null, // assigned cover sector (radians) from formation logic
    };
    units.push(unit);
    updateUnitVisual(unit);
    if (window.UI) UI.refreshUnitList();
    return unit;
  }

  function makeNumberSprite(num) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(10,13,10,0.85)';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num, 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 0.5);
    return sprite;
  }

  function makeFovConeMesh(color) {
    // 2D FOV guide: just the two boundary lines + an arc outline, flat on the ground.
    // No fill, no fog — purely a visual aim/coverage reference line.
    const segments = 20;
    const angleRad = THREE.MathUtils.degToRad(FOV_ANGLE_DEG);
    const points = [];

    points.push(new THREE.Vector3(0, 0, 0));
    points.push(new THREE.Vector3(Math.cos(-angleRad / 2) * FOV_RANGE, 0, Math.sin(-angleRad / 2) * FOV_RANGE));
    for (let i = 0; i <= segments; i++) {
      const a = -angleRad / 2 + (angleRad * i) / segments;
      points.push(new THREE.Vector3(Math.cos(a) * FOV_RANGE, 0, Math.sin(a) * FOV_RANGE));
    }
    points.push(new THREE.Vector3(0, 0, 0));

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Line(geo, mat);
    mesh.position.y = 0.02;
    mesh.renderOrder = 1;
    return mesh;
  }

  function updateUnitVisual(unit) {
    unit.mesh.position.set(unit.x, 0, unit.z);
    unit.mesh.rotation.y = -unit.aimAngle;
    unit.fovMesh.position.set(unit.x, 0.02, unit.z);
    unit.fovMesh.rotation.y = -unit.aimAngle;
    const myPlayerId = window.NETWORK ? NETWORK.getPlayerId() : null;
    const controlledByOther = unit.controlledBy && unit.controlledBy !== myPlayerId;
    unit.ringMesh.visible = unit.selected || unit.isControlled || controlledByOther;
    if (unit.isControlled) {
      unit.ringMesh.material.color.set(0xfacc15); // yellow = you are controlling this
    } else if (controlledByOther) {
      unit.ringMesh.material.color.set(0xef4444); // red = another player is controlling this
    } else {
      unit.ringMesh.material.color.set(0xffffff); // white = just selected, free to take
    }
  }

  // ---- Movement: direct movement + collision stop (Option C) ----
  function moveUnitDirection(unit, dirX, dirZ, deltaTime) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.001) return;
    const nx = dirX / len, nz = dirZ / len;
    const step = MOVE_SPEED * deltaTime;
    const targetX = unit.x + nx * step;
    const targetZ = unit.z + nz * step;

    const blocked = checkCollision(unit, targetX, targetZ);
    if (!blocked) {
      unit.x = targetX;
      unit.z = targetZ;
      unit.status = 'MOVING';
    } else {
      // try sliding along each axis independently (basic wall-slide so it doesn't feel too sticky)
      const blockedX = checkCollision(unit, targetX, unit.z);
      const blockedZ = checkCollision(unit, unit.x, targetZ);
      if (!blockedX) { unit.x = targetX; unit.status = 'MOVING'; }
      else if (!blockedZ) { unit.z = targetZ; unit.status = 'MOVING'; }
      else { unit.status = 'BLOCKED'; }
    }
    clampToMapBounds(unit);
    updateUnitVisual(unit);

    if (window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendUnitMove(unit.id, unit.x, unit.z, unit.aimAngle, unit.status);
    }
  }

  function clampToMapBounds(unit) {
    const half = (window.SCENE ? SCENE.getMapSize() : 60) / 2 - 0.5;
    unit.x = THREE.MathUtils.clamp(unit.x, -half, half);
    unit.z = THREE.MathUtils.clamp(unit.z, -half, half);
  }

  function checkCollision(unit, targetX, targetZ) {
    // walls
    const walls = window.MAPEDITOR ? MAPEDITOR.getWallSegments() : [];
    for (const w of walls) {
      if (pointSegmentDist(targetX, targetZ, w.x1, w.z1, w.x2, w.z2) < UNIT_RADIUS + w.thickness / 2) {
        return true;
      }
    }
    // cover objects (box AABB)
    const covers = window.MAPEDITOR ? MAPEDITOR.getCoverBoxes() : [];
    for (const c of covers) {
      if (targetX > c.minX - UNIT_RADIUS && targetX < c.maxX + UNIT_RADIUS &&
          targetZ > c.minZ - UNIT_RADIUS && targetZ < c.maxZ + UNIT_RADIUS) {
        return true;
      }
    }
    return false;
  }

  function pointSegmentDist(px, pz, x1, z1, x2, z2) {
    const ab = { x: x2 - x1, z: z2 - z1 };
    const abLenSq = ab.x * ab.x + ab.z * ab.z;
    let t = abLenSq < 0.0001 ? 0 : ((px - x1) * ab.x + (pz - z1) * ab.z) / abLenSq;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const cx = x1 + ab.x * t, cz = z1 + ab.z * t;
    return Math.hypot(px - cx, pz - cz);
  }

  // soft separation between units so stacks don't overlap-stick but can stand close
  function resolveUnitSeparation() {
    const MIN_DIST = UNIT_RADIUS * 1.7;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < MIN_DIST && dist > 0.001) {
          const overlap = (MIN_DIST - dist) / 2;
          const nx = dx / dist, nz = dz / dist;
          if (!a.isControlled) { a.x -= nx * overlap; a.z -= nz * overlap; }
          if (!b.isControlled) { b.x += nx * overlap; b.z += nz * overlap; }
        }
      }
    }
  }

  // ---- Aim direction (mouse, used in direct control mode) ----
  function setUnitAimAngle(unit, angle) {
    unit.aimAngle = angle;
    updateUnitVisual(unit);
    if (window.NETWORK && NETWORK.isConnected() && unit.isControlled) {
      NETWORK.sendUnitMove(unit.id, unit.x, unit.z, unit.aimAngle, unit.status);
    }
  }

  // ---- Move-to target (used for group commands in selection mode) ----
  function setMoveTarget(unit, x, z) {
    unit.moveTarget = { x, z };
    unit.status = 'MOVING';
  }

  function tickMoveTargets(deltaTime) {
    for (const unit of units) {
      if (unit.isControlled || !unit.moveTarget) continue;
      const dx = unit.moveTarget.x - unit.x;
      const dz = unit.moveTarget.z - unit.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        unit.moveTarget = null;
        unit.status = unit.sectorAngle !== null ? 'COVERING' : 'HOLD';
        if (unit.sectorAngle !== null) setUnitAimAngle(unit, unit.sectorAngle);
        continue;
      }
      moveUnitDirection(unit, dx, dz, deltaTime);
      // face movement direction while moving (will be overridden by sector logic on arrival)
      setUnitAimAngle(unit, Math.atan2(dz, dx));
    }
  }

  // ---- Selection state ----
  function setSelected(unit, selected) {
    unit.selected = selected;
    updateUnitVisual(unit);
  }
  function clearAllSelection() {
    for (const u of units) setSelected(u, false);
  }
  function getSelectedUnits() {
    return units.filter(u => u.selected);
  }
  function setTeamColor(unit, hex) {
    unit.color = hex;
    unit.bodyMesh.material.color.set(hex);
    unit.fovMesh.material.color.set(hex);
    broadcastFullUnitsSync();
  }

  function setControlled(unit, controlled) {
    unit.isControlled = controlled;
    if (controlled) unit.moveTarget = null;
    updateUnitVisual(unit);
    if (window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendUnitClaim(unit.id, controlled);
    }
  }

  // Returns true if this unit is free to take control of (nobody else has claimed it)
  function isUnitClaimedByOther(unit) {
    if (!window.NETWORK || !NETWORK.isConnected()) return false;
    return unit.controlledBy && unit.controlledBy !== NETWORK.getPlayerId();
  }
  function getControlledUnit() {
    return units.find(u => u.isControlled) || null;
  }

  function getUnitAt(clientX, clientY) {
    const meshes = units.map(u => u.bodyMesh);
    const hits = SCENE.raycastObjects(clientX, clientY, meshes);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object;
    return units.find(u => u.bodyMesh === hitMesh) || null;
  }

  function getAllUnits() { return units; }

  function removeUnit(unit) {
    unitGroup.remove(unit.mesh);
    unitGroup.remove(unit.fovMesh);
    units = units.filter(u => u.id !== unit.id);
    if (window.UI) UI.refreshUnitList();
    broadcastFullUnitsSync();
  }

  function broadcastFullUnitsSync() {
    if (window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendUnitsSync(units);
    }
  }

  // ---- Applying updates that came FROM the network (other players) ----
  // These never call NETWORK.send... themselves, to avoid echoing the
  // change right back out (which would create an infinite loop between
  // clients via the server).

  // Full roster sync: used when a player joins a room (catch up on full
  // current state), or when one player adds/removes a unit, changes team
  // color, or applies a formation. Reconciles our local unit list to match.
  function applyRemoteUnitsSync(remoteUnits) {
    if (window.DEBUGLOG) DEBUGLOG('applyRemoteUnitsSync: received ' + remoteUnits.length + ' units: ' + remoteUnits.map(u => u.id).join(','), 'recv');
    const myPlayerId = window.NETWORK ? NETWORK.getPlayerId() : null;
    const remoteIds = new Set(remoteUnits.map(r => r.id));

    // Remove any local units that no longer exist remotely
    for (const local of units.slice()) {
      if (!remoteIds.has(local.id)) {
        unitGroup.remove(local.mesh);
        unitGroup.remove(local.fovMesh);
        units = units.filter(u => u.id !== local.id);
      }
    }

    for (const remote of remoteUnits) {
      let local = units.find(u => u.id === remote.id);
      if (!local) {
        // a new unit was created by another player; create it locally too
        local = spawnUnitAt(remote.x, remote.z, remote.color, remote.id, remote.number);
      }
      // Don't let a remote sync override the position of a unit THIS player
      // is actively controlling right now -- that would cause jitter, since
      // our own movement is the most up-to-date for our own controlled unit.
      const iAmControllingThis = local.isControlled;
      if (!iAmControllingThis) {
        local.x = remote.x;
        local.z = remote.z;
        local.aimAngle = remote.aimAngle;
        local.status = remote.status;
      }
      local.role = remote.role;
      local.formationSlot = remote.formationSlot;
      local.sectorAngle = remote.sectorAngle;
      if (local.color !== remote.color) {
        setTeamColorLocalOnly(local, remote.color);
      }
      local.controlledBy = remote.controlledBy;
      // if someone else just claimed a unit I thought I was free to use, drop my local "selected" hint
      if (local.controlledBy && local.controlledBy !== myPlayerId) {
        local.isControlled = false;
      }
      updateUnitVisual(local);
    }
    if (window.UI) UI.refreshUnitList();
  }

  // Helper used only when applying a remote color change, so we don't
  // immediately re-broadcast it (setTeamColor() does broadcast, this doesn't).
  function setTeamColorLocalOnly(unit, hex) {
    unit.color = hex;
    unit.bodyMesh.material.color.set(hex);
    unit.fovMesh.material.color.set(hex);
  }

  // High-frequency position updates (someone else moving their controlled unit)
  function applyRemoteUnitMove(unitId, x, z, aimAngle, status) {
    let unit = units.find(u => u.id === unitId);
    if (!unit) {
      // This can happen if a unit_move arrives before we've ever received
      // a units_sync that included this unit (e.g. message ordering during
      // the join handshake). Previously this just silently dropped the
      // update, which is the root cause of host/joiner unit lists drifting
      // out of sync with each other. Create the unit on the fly instead.
      if (window.DEBUGLOG) DEBUGLOG('applyRemoteUnitMove: unit ' + unitId + ' not found locally, creating it', 'err');
      unit = spawnUnitAt(x, z, undefined, unitId);
    }
    if (unit.isControlled) return; // don't fight with our own active control
    unit.x = x;
    unit.z = z;
    unit.aimAngle = aimAngle;
    unit.status = status;
    updateUnitVisual(unit);
  }

  // Someone else claimed or released control of a unit
  function applyRemoteUnitClaim(unitId, controlledBy) {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    unit.controlledBy = controlledBy;
    const myPlayerId = window.NETWORK ? NETWORK.getPlayerId() : null;
    if (controlledBy && controlledBy !== myPlayerId) {
      // someone else took this unit; if we had it visually marked as ours somehow, clear that
      if (unit.isControlled) {
        unit.isControlled = false;
      }
    }
    updateUnitVisual(unit);
    if (window.UI) UI.refreshUnitList();
  }

  function tick(deltaTime) {
    tickMoveTargets(deltaTime);
    resolveUnitSeparation();
    for (const u of units) updateUnitVisual(u);
  }

  return {
    init, spawnUnitAt, moveUnitDirection, setUnitAimAngle,
    setMoveTarget, tickMoveTargets, tick,
    setSelected, clearAllSelection, getSelectedUnits, setTeamColor,
    setControlled, isUnitClaimedByOther, getControlledUnit, getUnitAt, getAllUnits, removeUnit,
    applyRemoteUnitsSync, applyRemoteUnitMove, applyRemoteUnitClaim,
    TEAM_COLORS, UNIT_RADIUS, FOV_ANGLE_DEG, FOV_RANGE,
  };
})();
