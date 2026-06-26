// ===========================================================================
// server.js — CQB-SIM Online Server
//
// What this does, in plain terms:
// 1. Serves the game's HTML/JS files to anyone who visits the website.
// 2. Opens a WebSocket "phone line" that stays connected while people play.
// 3. Keeps track of "rooms" (like separate game sessions, each with a code).
// 4. Whenever one player does something (move a unit, draw a wall, change
//    formation), the server receives it and immediately re-sends ("broadcasts")
//    that same message to every other player in the same room.
// 5. The server is "authoritative" for room membership and relaying messages,
//    but the actual game math (collision, formation slots) still runs on
//    each player's own browser for responsiveness. This is a simple
//    "relay" architecture -- good enough for a small group of trusted players
//    (like training with friends), not hardened against cheating.
// ===========================================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve all static files (index.html, etc.) from the /public folder
app.use(express.static(__dirname));

// ---------------------------------------------------------------------------
// In-memory room storage.
// Each room is identified by a short code like "AB12CD".
// rooms = {
//   "AB12CD": {
//     clients: Set of WebSocket connections currently in this room,
//     mapData: the last known state of the map (walls/doors/etc.),
//     units:   the last known state of all units (position, aim, etc.),
//   }
// }
// This is "in-memory" meaning if the server restarts, all rooms are lost.
// That's fine for a training tool; it's not meant to persist data long-term.
// ---------------------------------------------------------------------------
const rooms = {};

function generateRoomCode() {
  // 6-character code using uppercase letters and digits, easy to read aloud
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

function createRoom() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms[code]); // make sure it's unique

  rooms[code] = {
    clients: new Set(),
    mapData: { walls: [], doors: [], windows: [], covers: [], spawns: [] },
    units: [], // each entry: {id, number, x, z, aimAngle, color, status, role, controlledBy}
  };
  return code;
}

function broadcastToRoom(roomCode, message, excludeWs) {
  const room = rooms[roomCode];
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastPlayerCount(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  broadcastToRoom(roomCode, {
    type: 'player_count',
    count: room.clients.size,
  }, null);
}

// ---------------------------------------------------------------------------
// WebSocket connection handling
// Each connected browser gets its own `ws` object. We track which room
// and player id it belongs to directly on the object for convenience.
// ---------------------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerId = crypto.randomUUID();
  ws.isAlive = true;

  // Heartbeat: Render's infrastructure (and many proxies/load balancers in
  // general) can silently drop idle connections. Periodically pinging each
  // client and listening for the automatic 'pong' reply lets us detect dead
  // connections early, and the back-and-forth traffic itself helps keep the
  // connection from being treated as idle and getting reset.
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return; // ignore malformed messages
    }

    switch (msg.type) {
      // -----------------------------------------------------------------
      case 'create_room': {
        const code = createRoom();
        ws.roomCode = code;
        rooms[code].clients.add(ws);
        ws.send(JSON.stringify({ type: 'room_created', roomCode: code, playerId: ws.playerId }));
        broadcastPlayerCount(code);
        break;
      }

      // -----------------------------------------------------------------
      case 'join_room': {
        const code = (msg.roomCode || '').toUpperCase().trim();
        const room = rooms[code];
        if (!room) {
          ws.send(JSON.stringify({ type: 'join_error', message: 'Room not found. Check the code and try again.' }));
          return;
        }
        ws.roomCode = code;
        room.clients.add(ws);
        // Send the new player the current state of the room so their screen matches everyone else's
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomCode: code,
          playerId: ws.playerId,
          mapData: room.mapData,
          units: room.units,
        }));
        broadcastPlayerCount(code);
        break;
      }

      // -----------------------------------------------------------------
      // Map editing: walls, doors, covers, etc. Whatever one player draws,
      // everyone else needs to see too, and the server keeps the master copy
      // so that anyone joining later gets the up-to-date map.
      case 'map_update': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        room.mapData = msg.mapData;
        broadcastToRoom(ws.roomCode, { type: 'map_update', mapData: msg.mapData }, ws);
        break;
      }

      // -----------------------------------------------------------------
      // Full unit list sync (used when units are added/removed, or formation applied)
      case 'units_sync': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        room.units = msg.units;
        broadcastToRoom(ws.roomCode, { type: 'units_sync', units: msg.units }, ws);
        break;
      }

      // -----------------------------------------------------------------
      // High-frequency position/aim updates while someone is actively
      // controlling a unit (WASD + mouse). Kept as a separate lightweight
      // message type so it can be sent rapidly without resending everything.
      case 'unit_move': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const unit = room.units.find(u => u.id === msg.unitId);
        if (unit) {
          unit.x = msg.x;
          unit.z = msg.z;
          unit.aimAngle = msg.aimAngle;
          unit.status = msg.status;
        }
        broadcastToRoom(ws.roomCode, {
          type: 'unit_move',
          unitId: msg.unitId,
          x: msg.x,
          z: msg.z,
          aimAngle: msg.aimAngle,
          status: msg.status,
        }, ws);
        break;
      }

      // -----------------------------------------------------------------
      // Claiming/releasing control of a unit, so two people don't fight
      // over the same unit at the same time.
      case 'unit_claim': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const unit = room.units.find(u => u.id === msg.unitId);
        if (unit) {
          unit.controlledBy = msg.claim ? ws.playerId : null;
        }
        broadcastToRoom(ws.roomCode, {
          type: 'unit_claim',
          unitId: msg.unitId,
          controlledBy: msg.claim ? ws.playerId : null,
        }, ws);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && rooms[ws.roomCode]) {
      const room = rooms[ws.roomCode];
      room.clients.delete(ws);
      // release any units this player was controlling
      let releasedAny = false;
      for (const unit of room.units) {
        if (unit.controlledBy === ws.playerId) {
          unit.controlledBy = null;
          releasedAny = true;
        }
      }
      if (releasedAny) {
        broadcastToRoom(ws.roomCode, { type: 'units_sync', units: room.units }, null);
      }
      broadcastPlayerCount(ws.roomCode);
      // Clean up empty rooms after a delay (in case everyone briefly disconnects)
      if (room.clients.size === 0) {
        setTimeout(() => {
          if (rooms[ws.roomCode] && rooms[ws.roomCode].clients.size === 0) {
            delete rooms[ws.roomCode];
          }
        }, 5 * 60 * 1000); // 5 minutes
      }
    }
  });
});

// Send a ping to every connected client every 25 seconds. If a client didn't
// answer the PREVIOUS ping with a pong (ws.isAlive still false), we assume
// the connection is dead and close it -- this also frees up the room's
// memory if that was the last person in it. This periodic traffic is also
// what keeps Render's proxy from treating the connection as idle.
const HEARTBEAT_INTERVAL_MS = 25000;
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CQB-SIM Online server running on port ${PORT}`);
});
