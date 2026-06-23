// ===========================================================================
// main.js — UI helper module (toasts, unit list, formation menu, help overlay)
// + application bootstrap and render loop
// ===========================================================================

const UI = (() => {
  let formationMenuOpen = false;

  function init() {
    // Tool rail buttons
    document.querySelectorAll('.rail-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        MAPEDITOR.setTool(btn.dataset.tool);
        refreshToolButtons();
      });
    });
    refreshToolButtons();

    document.getElementById('btn-undo').addEventListener('click', () => MAPEDITOR.undo());
    document.getElementById('btn-clear-map').addEventListener('click', () => {
      if (confirm('Clear entire map? This cannot be undone after further edits.')) MAPEDITOR.clearMap();
    });
    document.getElementById('btn-save-map').addEventListener('click', () => MAPEDITOR.saveMapToFile());
    document.getElementById('btn-load-map').addEventListener('click', () => {
      document.getElementById('file-load-map').click();
    });
    document.getElementById('file-load-map').addEventListener('change', (e) => {
      if (e.target.files[0]) MAPEDITOR.loadMapFromFile(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('btn-add-unit').addEventListener('click', () => {
      UNITS.spawnUnitAt((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    });

    document.getElementById('btn-editor-toggle').addEventListener('click', () => {
      CONTROLS.setPlayMode(false);
      refreshToolButtons();
    });
    document.getElementById('btn-play-toggle').addEventListener('click', () => {
      const goingToPlay = !CONTROLS.getPlayMode();
      CONTROLS.setPlayMode(goingToPlay);
    });

    document.getElementById('btn-help').addEventListener('click', toggleHelp);
    document.getElementById('help-close-btn').addEventListener('click', closeHelp);
    document.getElementById('help-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'help-overlay') closeHelp();
    });

    document.getElementById('fm-close').addEventListener('click', closeFormationMenu);

    buildFormationMenuContent();
    refreshUnitList();
  }

  function setHint(text) {
    document.getElementById('hint-text').textContent = text;
  }

  function refreshToolButtons() {
    const current = MAPEDITOR.getTool();
    document.querySelectorAll('.rail-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === current);
    });
  }

  // ---------------- Toasts ----------------
  function toast(message, type = 'info') {
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'danger' ? 'danger-toast' : type === 'warn' ? '' : 'info-toast');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ---------------- Unit roster list ----------------
  function refreshUnitList() {
    const list = document.getElementById('unit-list');
    list.innerHTML = '';
    const units = UNITS.getAllUnits();
    document.getElementById('unit-count').textContent = units.length;

    for (const unit of units) {
      const row = document.createElement('div');
      row.className = 'unit-row' + (unit.selected ? ' selected' : '') + (unit.isControlled ? ' controlling' : '');

      const dot = document.createElement('div');
      dot.className = 'unit-color-dot';
      dot.style.background = '#' + unit.color.toString(16).padStart(6, '0');
      dot.style.color = '#' + unit.color.toString(16).padStart(6, '0');

      const label = document.createElement('div');
      label.className = 'unit-label';
      label.textContent = 'UNIT #' + unit.number + (unit.role ? ' · ' + unit.role : '');

      const status = document.createElement('div');
      status.className = 'unit-status';
      status.textContent = unit.isControlled ? 'CTRL' : unit.status;

      const del = document.createElement('div');
      del.className = 'unit-del';
      del.textContent = '✕';
      del.title = 'Remove unit';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        UNITS.removeUnit(unit);
      });

      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(status);
      row.appendChild(del);

      row.addEventListener('click', () => {
        if (!CONTROLS.getPlayMode()) return;
        UNITS.clearAllSelection();
        UNITS.setSelected(unit, true);
        refreshUnitList();
        updateSelectedCount();
      });

      list.appendChild(row);
    }
  }

  function updateSelectedCount() {
    document.getElementById('stat-selected').textContent = UNITS.getSelectedUnits().length;
  }

  function setFormationLabel(label) {
    document.getElementById('stat-formation').textContent = label.toUpperCase();
  }

  // ---------------- Formation menu (Alt+A) ----------------
  function buildFormationMenuContent() {
    const grid = document.getElementById('formation-options');
    grid.innerHTML = '';
    const icons = {
      stack: '▤', wedge: '▲', line: '▬', diamond: '◆', file: '▮',
    };
    for (const f of FORMATIONS.getFormationTypes()) {
      const opt = document.createElement('div');
      opt.className = 'fm-option';
      opt.dataset.formation = f.key;
      opt.innerHTML = `<div style="font-size:20px;">${icons[f.key] || '◇'}</div><div>${f.label}</div>`;
      opt.addEventListener('click', () => {
        const selected = UNITS.getSelectedUnits();
        if (selected.length === 0) {
          toast('Select units first', 'warn');
          return;
        }
        // default facing: average current aim angle, or toward map center
        let facing = 0;
        if (selected.length > 0) facing = selected[0].aimAngle;
        FORMATIONS.applyFormation(selected, f.key, facing);
        document.querySelectorAll('.fm-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        toast('Formation: ' + f.label, 'info');
      });
      grid.appendChild(opt);
    }

    const colorRow = document.getElementById('color-options');
    colorRow.innerHTML = '';
    for (const c of UNITS.TEAM_COLORS) {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      sw.title = c.name;
      sw.addEventListener('click', () => {
        const selected = UNITS.getSelectedUnits();
        if (selected.length === 0) {
          toast('Select units first', 'warn');
          return;
        }
        for (const u of selected) UNITS.setTeamColor(u, c.hex);
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        refreshUnitList();
        toast('Team color updated', 'info');
      });
      colorRow.appendChild(sw);
    }
  }

  function openFormationMenu() {
    if (UNITS.getSelectedUnits().length === 0) {
      toast('Select one or more units first (drag-select)', 'warn');
      return;
    }
    const menu = document.getElementById('formation-menu');
    menu.classList.add('open');
    // position near center-ish, offset from cursor not tracked here; place center screen
    menu.style.left = (window.innerWidth / 2 - 170) + 'px';
    menu.style.top = '90px';
    formationMenuOpen = true;
  }
  function closeFormationMenu() {
    document.getElementById('formation-menu').classList.remove('open');
    formationMenuOpen = false;
  }

  // ---------------- Help overlay ----------------
  function toggleHelp() {
    const overlay = document.getElementById('help-overlay');
    overlay.classList.toggle('open');
  }
  function closeHelp() {
    document.getElementById('help-overlay').classList.remove('open');
  }

  // ---------------- Stat bar tick ----------------
  function tickStatusBar() {
    updateSelectedCount();
  }

  return {
    init, setHint, refreshToolButtons, toast, refreshUnitList, updateSelectedCount,
    setFormationLabel, openFormationMenu, closeFormationMenu, toggleHelp, closeHelp,
    tickStatusBar,
  };
})();

// ===========================================================================
// Bootstrap
// ===========================================================================
(function bootstrap() {
  const loadingFill = document.getElementById('loading-bar-fill');
  const advance = (p) => { loadingFill.style.width = p + '%'; };

  let gameInitialized = false;
  let isHost = false; // true if this player created the room (so they should seed default units)

  // ---- Room screen wiring ----
  const roomScreen = document.getElementById('room-screen');
  const roomStatus = document.getElementById('room-status');
  const inputRoomCode = document.getElementById('input-room-code');

  document.getElementById('btn-create-room').addEventListener('click', () => {
    roomStatus.textContent = 'Connecting...';
    isHost = true;
    NETWORK.connect(() => {
      NETWORK.createRoom();
    });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = inputRoomCode.value.trim().toUpperCase();
    if (code.length < 4) {
      roomStatus.textContent = 'Enter the room code your friend shared with you.';
      return;
    }
    roomStatus.textContent = 'Connecting...';
    isHost = false;
    NETWORK.connect(() => {
      NETWORK.joinRoom(code);
    });
  });

  inputRoomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join-room').click();
  });
  inputRoomCode.addEventListener('input', () => {
    inputRoomCode.value = inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  document.getElementById('btn-copy-room-code').addEventListener('click', () => {
    const code = document.getElementById('room-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
      UI.toast('Room code copied', 'info');
    }).catch(() => {
      UI.toast('Could not copy automatically — copy it manually: ' + code, 'warn');
    });
  });

  // Called by network.js when create_room or join_room succeeds.
  // mapData/units are only present when JOINING an existing room (so this
  // player can catch up to what's already there); they're applied AFTER
  // the 3D engine is initialized below, never before.
  UI.onRoomReady = function (roomCode, asHost, mapData, remoteUnits) {
    roomScreen.style.display = 'none';
    document.getElementById('room-code-display').textContent = roomCode;
    document.getElementById('room-badge').classList.add('visible');

    if (!gameInitialized) {
      initGame(asHost, mapData, remoteUnits);
      gameInitialized = true;
    }
  };

  UI.onJoinFailed = function () {
    roomStatus.textContent = 'Could not join that room. Double check the code.';
  };

  UI.updatePlayerCount = function (count) {
    document.getElementById('player-count-display').textContent = count;
  };

  // ---- Actual game initialization, runs once a room is successfully entered ----
  function initGame(asHost, remoteMapData, remoteUnits) {
    document.getElementById('loading-screen').style.display = 'flex';
    advance(15);
    SCENE.init(document.getElementById('scene-container'));
    advance(40);
    MAPEDITOR.init(SCENE.getScene());
    advance(55);
    UNITS.init(SCENE.getScene());
    advance(70);
    CONTROLS.init();
    advance(85);
    UI.init();
    advance(100);

    setTimeout(() => {
      document.getElementById('loading-screen').style.display = 'none';
    }, 250);

    if (asHost) {
      // Only the player who CREATED the room starts with default units —
      // otherwise every joining player would also spawn their own duplicate
      // pair, since spawnUnitAt broadcasts.
      UNITS.spawnUnitAt(-2, 0, UNITS.TEAM_COLORS[0].hex);
      UNITS.spawnUnitAt(-2, 1, UNITS.TEAM_COLORS[0].hex);
      if (window.NETWORK && NETWORK.isConnected()) {
        NETWORK.sendUnitsSync(UNITS.getAllUnits());
      }
    } else {
      // Joining player: now that the engine exists (mapGroup/unitGroup are
      // ready), it's safe to apply the room's current state we received.
      if (remoteMapData) MAPEDITOR.loadMapFromData(remoteMapData);
      if (remoteUnits) UNITS.applyRemoteUnitsSync(remoteUnits);
    }

    CONTROLS.setPlayMode(false);

    let lastStatTick = 0;
    function animate() {
      requestAnimationFrame(animate);
      const deltaTime = Math.min(SCENE.getClock().getDelta(), 0.1);

      CONTROLS.tickControlMovement(deltaTime);
      UNITS.tick(deltaTime);

      lastStatTick += deltaTime;
      if (lastStatTick > 0.25) {
        lastStatTick = 0;
        UI.tickStatusBar();
      }

      SCENE.render();
    }
    animate();
  }
})();
