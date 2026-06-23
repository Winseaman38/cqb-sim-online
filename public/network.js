// ===========================================================================
// network.js — WebSocket client: connects to the server, creates/joins rooms,
// sends local actions out, and applies incoming actions from other players.
// ===========================================================================

const NETWORK = (() => {
  let ws = null;
  let roomCode = null;
  let playerId = null;
  let connected = false;

  // Throttle for high-frequency unit_move messages (don't flood the network
  // every single animation frame; ~20 updates/sec is plenty for smoothness)
  let lastMoveSendTime = 0;
  const MOVE_SEND_INTERVAL_MS = 50;

  function getWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  function connect(onOpenCallback) {
    ws = new WebSocket(getWsUrl());
    ws.onopen = () => {
      connected = true;
      if (onOpenCallback) onOpenCallback();
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
      UI.toast('Disconnected from server. Try refreshing the page.', 'danger');
    };
    ws.onerror = () => {
      UI.toast('Connection error. Is the server running?', 'danger');
    };
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
        // IMPORTANT: do NOT apply mapData/units here. The 3D engine
        // (MAPEDITOR.init/UNITS.init) hasn't run yet at this point for a
        // joining player -- only the room screen has loaded so far. Pass
        // the data along to onRoomReady, which applies it AFTER the engine
        // is initialized.
        UI.onRoomReady(roomCode, false, msg.mapData, msg.units);
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
