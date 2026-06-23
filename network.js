// ===========================================================================
// network.js — WebSocket client: connects to the server, creates/joins rooms,
// sends local actions out, and applies incoming actions from other players.
// ===========================================================================

const NETWORK = (() => {
  let ws = null;
  let roomCode = null;
  let playerId = null;
  let connected = false;
  let intentionalDisconnect = false;
  let onOpenCallbackRef = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_DELAY_MS = 8000;

  // Throttle for high-frequency unit_move messages (don't flood the network
  // every single animation frame; ~20 updates/sec is plenty for smoothness)
  let lastMoveSendTime = 0;
  const MOVE_SEND_INTERVAL_MS = 50;

  function getWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  function connect(onOpenCallback) {
    intentionalDisconnect = false;
    onOpenCallbackRef = onOpenCallback;
    openSocket();
  }

  function openSocket() {
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      connected = true;
      reconnectAttempts = 0;
      // Re-announce ourselves to the room if this was a reconnect after
      // already being in a room (rather than the very first connection).
      if (roomCode && window.UI) {
        UI.toast('Reconnected to server', 'info');
        send({ type: 'join_room', roomCode });
      } else if (onOpenCallbackRef) {
        onOpenCallbackRef();
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = () => {
      connected = false;
      if (intentionalDisconnect) return;
      // Render and most free-tier hosts can drop idle/cold-starting
      // connections; retry with exponential backoff instead of giving up
      // immediately. This also covers the very first connection attempt
      // landing while the server is still waking up from sleep.
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire right after this in virtually all browsers, so
      // the actual retry scheduling happens there -- this just informs the
      // player something is wrong if it's taking a while.
      if (reconnectAttempts === 0) {
        UI.toast('Connecting to server...', 'info');
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    reconnectAttempts++;
    if (reconnectAttempts === 1) {
      UI.toast('Connection lost, retrying...', 'warn');
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        roomCode = msg.roomCode;
        playerId = msg.playerId;
        UI.onRoomReady(roomCode, true);
        break;

      case 'room_joined':
        roomCode = msg.roomCode;
        playerId = msg.playerId;
        if (window.UI && UI.isGameInitialized && UI.isGameInitialized()) {
          // The engine is already running -- this is a RECONNECT after a
          // dropped connection mid-game, not the first time joining. Safe
          // to apply the catch-up state immediately.
          if (msg.mapData) MAPEDITOR.applyRemoteMapUpdate(msg.mapData);
          if (msg.units) UNITS.applyRemoteUnitsSync(msg.units);
        } else {
          // First time joining: the 3D engine (MAPEDITOR.init/UNITS.init)
          // hasn't run yet -- only the room screen has loaded so far. Pass
          // the data along to onRoomReady, which applies it AFTER the
          // engine is initialized.
          UI.onRoomReady(roomCode, false, msg.mapData, msg.units);
        }
        break;

      case 'join_error':
        UI.toast(msg.message, 'danger');
        UI.onJoinFailed();
        break;

      case 'player_count':
        UI.updatePlayerCount(msg.count);
        break;

      case 'map_update':
        MAPEDITOR.applyRemoteMapUpdate(msg.mapData);
        break;

      case 'units_sync':
        UNITS.applyRemoteUnitsSync(msg.units);
        break;

      case 'unit_move':
        UNITS.applyRemoteUnitMove(msg.unitId, msg.x, msg.z, msg.aimAngle, msg.status);
        break;

      case 'unit_claim':
        UNITS.applyRemoteUnitClaim(msg.unitId, msg.controlledBy);
        break;

      default:
        break;
    }
  }

  function send(obj) {
    if (ws && connected) {
      ws.send(JSON.stringify(obj));
    }
  }

  function createRoom() {
    send({ type: 'create_room' });
  }

  function joinRoom(code) {
    send({ type: 'join_room', roomCode: code });
  }

  function sendMapUpdate(mapData) {
    send({ type: 'map_update', mapData });
  }

  function sendUnitsSync(units) {
    // strip out fields that don't need to travel over the network (mesh references etc.)
    const lightweight = units.map(u => ({
      id: u.id, number: u.number, x: u.x, z: u.z, aimAngle: u.aimAngle,
      color: u.color, status: u.status, role: u.role, formationSlot: u.formationSlot,
      sectorAngle: u.sectorAngle, controlledBy: u.controlledBy || null,
    }));
    send({ type: 'units_sync', units: lightweight });
  }

  function sendUnitMove(unitId, x, z, aimAngle, status) {
    const now = performance.now();
    if (now - lastMoveSendTime < MOVE_SEND_INTERVAL_MS) return;
    lastMoveSendTime = now;
    send({ type: 'unit_move', unitId, x, z, aimAngle, status });
  }

  function sendUnitClaim(unitId, claim) {
    send({ type: 'unit_claim', unitId, claim });
  }

  function getRoomCode() { return roomCode; }
  function getPlayerId() { return playerId; }
  function isConnected() { return connected; }

  return {
    connect, createRoom, joinRoom,
    sendMapUpdate, sendUnitsSync, sendUnitMove, sendUnitClaim,
    getRoomCode, getPlayerId, isConnected,
  };
})();
