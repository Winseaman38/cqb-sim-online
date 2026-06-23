// ===========================================================================
// controls.js — Input handling: selection mode (drag-select, right-click team
// select, camera pan/zoom), direct control mode (WASD + mouse aim), mode switching
// ===========================================================================

const CONTROLS = (() => {
  let mode = 'selection'; // 'selection' | 'control'
  let isPlayMode = false; // false = editor active, true = play/simulation active

  // selection drag state
  let isDragSelecting = false;
  let dragStartScreen = null;

  // camera pan state
  let isPanning = false;
  let lastPanScreen = null;

  // keyboard state for direct control
  const keysDown = {};

  // mouse world position (for aim direction + editor drawing)
  let mouseClientX = 0, mouseClientY = 0;

  const container = () => document.getElementById('scene-container');

  function init() {
    const el = container();

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    updateModePill();
  }

  function setPlayMode(active) {
    isPlayMode = active;
    MAPEDITOR.setActive(!active);
    if (!active) {
      // returning to editor: drop out of direct control
      exitControlMode();
    }
    document.getElementById('tool-rail').style.display = active ? 'none' : 'block';
    document.getElementById('btn-play-toggle').classList.toggle('active', active);
    document.getElementById('stat-mode').textContent = active ? 'PLAY' : 'EDIT';
  }
  function getPlayMode() { return isPlayMode; }

  // ---------------- Mouse handling ----------------
  function onMouseDown(e) {
    mouseClientX = e.clientX; mouseClientY = e.clientY;

    if (e.button === 2) { // right click
      if (mode === 'control') return;
      const unit = UNITS.getUnitAt(e.clientX, e.clientY);
      if (unit) {
        selectTeamByColor(unit);
      } else {
        // right-click ground: if units selected, issue move command; else start camera pan
        const selected = UNITS.getSelectedUnits();
        if (selected.length > 0 && !isPlayModeEditorBlocking()) {
          const ground = SCENE.screenToGround(e.clientX, e.clientY);
          if (ground) issueGroupMove(selected, ground);
        } else {
          isPanning = true;
          lastPanScreen = { x: e.clientX, y: e.clientY };
        }
      }
      return;
    }

    if (e.button === 0) { // left click
      if (mode === 'control') return; // movement handled by keys, not clicks

      if (!MAPEDITOR.isActive()) {
        // PLAY MODE, selection mode: left click = select / enter direct control
        const unit = UNITS.getUnitAt(e.clientX, e.clientY);
        if (unit) {
          enterControlMode(unit);
          return;
        }
        // start drag-select
        isDragSelecting = true;
        dragStartScreen = { x: e.clientX, y: e.clientY };
        showSelectionBox(dragStartScreen, dragStartScreen);
      } else {
        // EDITOR MODE: drawing tools
        const ground = SCENE.screenToGround(e.clientX, e.clientY);
        MAPEDITOR.onPointerDown(ground);
      }
    }
  }

  function onMouseMove(e) {
    mouseClientX = e.clientX; mouseClientY = e.clientY;

    if (mode === 'control') {
      updateAimFromMouse(e.clientX, e.clientY);
      return;
    }

    if (isPanning && lastPanScreen) {
      const dx = e.clientX - lastPanScreen.x;
      const dy = e.clientY - lastPanScreen.y;
      // convert screen delta to world delta on ground plane (approx via camera basis)
      const panScale = 0.045 * (1 + 0); // tuned constant; could scale with zoom dist
      SCENE.panCamera(-dx * panScale, -dy * panScale);
      lastPanScreen = { x: e.clientX, y: e.clientY };
      return;
    }

    if (isDragSelecting && dragStartScreen) {
      showSelectionBox(dragStartScreen, { x: e.clientX, y: e.clientY });
      return;
    }

    if (MAPEDITOR.isActive()) {
      const ground = SCENE.screenToGround(e.clientX, e.clientY);
      MAPEDITOR.onPointerMove(ground);
    }
  }

  function onMouseUp(e) {
    if (e.button === 2) {
      isPanning = false;
      lastPanScreen = null;
      return;
    }
    if (e.button === 0) {
      if (isDragSelecting) {
        finalizeDragSelect(dragStartScreen, { x: e.clientX, y: e.clientY });
        isDragSelecting = false;
        dragStartScreen = null;
        hideSelectionBox();
        return;
      }
      if (MAPEDITOR.isActive()) {
        const ground = SCENE.screenToGround(e.clientX, e.clientY);
        MAPEDITOR.onPointerUp(ground);
      }
    }
  }

  function onWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.4 : -1.4;
      SCENE.zoomCamera(delta);
    }
  }

  function isPlayModeEditorBlocking() {
    return MAPEDITOR.isActive();
  }

  // ---------------- Selection box ----------------
  function showSelectionBox(start, end) {
    const box = document.getElementById('selection-box');
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    box.style.display = 'block';
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
  }
  function hideSelectionBox() {
    document.getElementById('selection-box').style.display = 'none';
  }

  function finalizeDragSelect(start, end) {
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    if (dist < 4) {
      // treat as simple click on empty space -> deselect all
      UNITS.clearAllSelection();
      UI.refreshUnitList();
      UI.updateSelectedCount();
      return;
    }
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);

    UNITS.clearAllSelection();
    for (const unit of UNITS.getAllUnits()) {
      const screenPos = SCENE.worldToScreen(new THREE.Vector3(unit.x, 0.6, unit.z));
      if (screenPos.x >= minX && screenPos.x <= maxX && screenPos.y >= minY && screenPos.y <= maxY) {
        UNITS.setSelected(unit, true);
      }
    }
    UI.refreshUnitList();
    UI.updateSelectedCount();
  }

  // ---------------- Team select (right click on unit) ----------------
  function selectTeamByColor(clickedUnit) {
    UNITS.clearAllSelection();
    for (const u of UNITS.getAllUnits()) {
      if (u.color === clickedUnit.color) UNITS.setSelected(u, true);
    }
    UI.refreshUnitList();
    UI.updateSelectedCount();
    UI.toast('Team selected (' + UNITS.getSelectedUnits().length + ' units)', 'info');
  }

  // ---------------- Group move command ----------------
  function issueGroupMove(selectedUnits, groundPoint) {
    const formation = FORMATIONS.getCurrentFormation();
    if (formation && selectedUnits.length > 1) {
      // move formation anchor to new point, keep current facing
      const fakeUnitList = selectedUnits;
      FORMATIONS.applyFormation(fakeUnitList, formation.type, formation.facingAngle);
      // override anchor to clicked point
      const def = FORMATIONS.FORMATION_DEFS[formation.type];
      const slots = def.slots(selectedUnits.length);
      const cosA = Math.cos(formation.facingAngle), sinA = Math.sin(formation.facingAngle);
      selectedUnits.forEach((unit, i) => {
        const slot = slots[i];
        const rx = slot.x * cosA - slot.z * sinA;
        const rz = slot.x * sinA + slot.z * cosA;
        UNITS.setMoveTarget(unit, groundPoint.x + rx, groundPoint.z + rz);
      });
    } else {
      for (const unit of selectedUnits) {
        UNITS.setMoveTarget(unit, groundPoint.x, groundPoint.z);
      }
    }
    if (window.NETWORK && NETWORK.isConnected()) {
      NETWORK.sendUnitsSync(UNITS.getAllUnits());
    }
  }

  // ---------------- Direct control mode ----------------
  function enterControlMode(unit) {
    if (UNITS.isUnitClaimedByOther(unit)) {
      UI.toast('Another player is already controlling this unit', 'warn');
      return;
    }
    UNITS.clearAllSelection();
    UNITS.setControlled(unit, true);
    mode = 'control';
    updateModePill();
    document.getElementById('control-vignette').classList.add('active');
    document.getElementById('crosshair').classList.add('active');
    UI.refreshUnitList();
    UI.setHint('WASD to move · Mouse to aim · Esc/Tab to exit');
  }

  function exitControlMode() {
    const unit = UNITS.getControlledUnit();
    if (unit) UNITS.setControlled(unit, false);
    mode = 'selection';
    updateModePill();
    document.getElementById('control-vignette').classList.remove('active');
    document.getElementById('crosshair').classList.remove('active');
    UI.refreshUnitList();
    UI.setHint('Left-drag: select units · Right-click: team-select · Ctrl+Scroll: zoom · Right-drag: pan');
  }

  function updateModePill() {
    const pill = document.getElementById('mode-pill');
    if (mode === 'control') {
      pill.textContent = 'DIRECT CONTROL';
      pill.classList.add('control-active');
    } else {
      pill.textContent = 'SELECTION MODE';
      pill.classList.remove('control-active');
    }
  }

  function updateAimFromMouse(clientX, clientY) {
    const unit = UNITS.getControlledUnit();
    if (!unit) return;
    const ground = SCENE.screenToGround(clientX, clientY);
    if (!ground) return;
    const angle = Math.atan2(ground.z - unit.z, ground.x - unit.x);
    UNITS.setUnitAimAngle(unit, angle);

    // update crosshair screen position
    const crosshair = document.getElementById('crosshair');
    crosshair.style.left = clientX + 'px';
    crosshair.style.top = clientY + 'px';
  }

  function tickControlMovement(deltaTime) {
    if (mode !== 'control') return;
    const unit = UNITS.getControlledUnit();
    if (!unit) return;
    let dx = 0, dz = 0;
    if (keysDown['w']) dz -= 1;
    if (keysDown['s']) dz += 1;
    if (keysDown['a']) dx -= 1;
    if (keysDown['d']) dx += 1;
    if (dx !== 0 || dz !== 0) {
      UNITS.moveUnitDirection(unit, dx, dz, deltaTime);
    } else {
      unit.status = 'COVERING';
    }
  }

  // ---------------- Keyboard ----------------
  function onKeyDown(e) {
    const key = e.key.toLowerCase();

    if (mode === 'control') {
      if (key === 'escape' || key === 'tab') {
        e.preventDefault();
        exitControlMode();
        return;
      }
      keysDown[key] = true;
      return;
    }

    // Selection mode shortcuts
    if (key === 'tab') {
      e.preventDefault();
      const btn = document.getElementById('btn-editor-toggle');
      setPlayMode(MAPEDITOR.isActive()); // toggles: if editor currently active -> switch to play
      return;
    }
    if (e.altKey && key === 'a') {
      e.preventDefault();
      UI.openFormationMenu();
      return;
    }
    if (key === 'h') { UI.toggleHelp(); return; }
    if (key === 'escape') { UI.closeFormationMenu(); UI.closeHelp(); return; }

    if (MAPEDITOR.isActive()) {
      const toolKeys = { '1': 'wall', '2': 'door', '3': 'window', '4': 'cover', '5': 'spawn', 'v': 'select', 'e': 'erase' };
      if (toolKeys[key]) {
        MAPEDITOR.setTool(toolKeys[key]);
        UI.refreshToolButtons();
      }
      if (e.ctrlKey && key === 'z') {
        e.preventDefault();
        MAPEDITOR.undo();
      }
    }
  }

  function onKeyUp(e) {
    const key = e.key.toLowerCase();
    keysDown[key] = false;
  }

  function getMode() { return mode; }

  return {
    init, setPlayMode, getPlayMode, getMode,
    tickControlMovement, enterControlMode, exitControlMode,
  };
})();
