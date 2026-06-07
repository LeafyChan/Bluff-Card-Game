const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../client/public')));

// ── Game state ──────────────────────────────────────────────────────────────
const rooms = {}; // roomId → game state

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['S','H','D','C'];

function buildDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createRoom(roomId) {
  return {
    roomId,
    phase: 'lobby',     // lobby | playing | reveal | gameover
    hostId: null,       // socket id of room creator
    players: [],        // [{ id, name, hand, connected }]
    pile: [],           // all cards in center pile { r, s, playerId }
    lastPlayed: [],     // cards from most recent play
    lastPlayerId: null,
    currentRank: null,
    turnIdx: 0,
    passCount: 0,
    log: [],
    winner: null,
  };
}

function publicState(room, forPlayerId) {
  return {
    roomId: room.roomId,
    phase: room.phase,
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length,
      connected: p.connected,
      // Only send own hand
      hand: p.id === forPlayerId ? p.hand : undefined,
    })),
    pileCount: room.pile.length,
    currentRank: room.currentRank,
    turnPlayerId: room.players[room.turnIdx]?.id ?? null,
    lastPlayerId: room.lastPlayerId,
    lastPlayedCount: room.lastPlayed.length,
    passCount: room.passCount,
    log: room.log.slice(-20),
    winner: room.winner,
  };
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 100) room.log.shift();
}

function broadcastState(room) {
  for (const p of room.players) {
    io.to(p.id).emit('state', publicState(room, p.id));
  }
}

function checkWin(room) {
  const empty = room.players.filter(p => p.hand.length === 0);
  if (empty.length > 0) {
    room.winner = empty[0].name;
    room.phase = 'gameover';
    addLog(room, `🏆 ${empty[0].name} wins!`);
    return true;
  }
  return false;
}

function advanceTurn(room) {
  room.turnIdx = (room.turnIdx + 1) % room.players.length;
}

// ── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Create or join a room
  socket.on('join', ({ roomId, name }) => {
    roomId = roomId.toUpperCase().trim();
    if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];

    // Rejoin check
    const existing = room.players.find(p => p.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.connected = true;
      socket.join(roomId);
      socket.emit('joined', { roomId, playerId: socket.id });
      broadcastState(room);
      return;
    }

    if (room.phase !== 'lobby') {
      socket.emit('error', 'Game already started');
      return;
    }
    if (room.players.length >= 8) {
      socket.emit('error', 'Room full');
      return;
    }

    room.players.push({ id: socket.id, name, hand: [], connected: true });
    if (!room.hostId) room.hostId = socket.id; // first player is host
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('joined', { roomId, playerId: socket.id });
    addLog(room, `${name} joined`);
    broadcastState(room);
  });

  // Kick a player (host only, lobby only)
  socket.on('kick', ({ targetId }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'lobby') return;
    const idx = room.players.findIndex(p => p.id === targetId);
    if (idx === -1) return;
    const kicked = room.players.splice(idx, 1)[0];
    addLog(room, `${kicked.name} was kicked by the host`);
    io.to(targetId).emit('kicked');
    broadcastState(room);
  });

  // Start game (any player can trigger if ≥2 players)
  socket.on('start', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'lobby') return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    const deck = buildDeck();
    deck.forEach((c, i) => room.players[i % room.players.length].hand.push(c));
    room.phase = 'playing';
    room.turnIdx = 0;
    addLog(room, 'Game started! ' + room.players[room.turnIdx].name + ' goes first.');
    broadcastState(room);
  });

  // Play cards
  socket.on('play', ({ cardIndices, claimedRank }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[room.turnIdx];
    if (player.id !== socket.id) return;
    if (!cardIndices || cardIndices.length === 0) return;

    let rank = room.currentRank || claimedRank;
    if (!rank || !RANKS.includes(rank)) { socket.emit('error', 'Invalid rank'); return; }

    // Remove cards from hand (highest idx first)
    const sorted = [...cardIndices].sort((a, b) => b - a);
    const played = sorted.map(i => player.hand.splice(i, 1)[0]).filter(Boolean);
    if (played.length === 0) return;

    room.pile.push(...played.map(c => ({ ...c, playerId: socket.id })));
    room.lastPlayed = played;
    room.lastPlayerId = socket.id;
    room.currentRank = rank;
    room.passCount = 0;

    addLog(room, `${player.name} played ${played.length} card(s) claiming ${rank}s`);

    if (checkWin(room)) { broadcastState(room); return; }

    advanceTurn(room);
    broadcastState(room);
  });

  // Call bluff — only current turn player can do this
  socket.on('callBluff', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;
    const caller = room.players[room.turnIdx];
    if (caller.id !== socket.id) return;
    if (!room.lastPlayed.length) return;

    const blufferId = room.lastPlayerId;
    const bluffer = room.players.find(p => p.id === blufferId);
    const wasBluffing = room.lastPlayed.some(c => c.r !== room.currentRank);

    // Broadcast reveal to everyone
    io.to(roomId).emit('reveal', {
      callerName: caller.name,
      blufferName: bluffer.name,
      cards: room.lastPlayed,
      claimedRank: room.currentRank,
      wasBluffing,
      pileCount: room.pile.length,
      loserName: wasBluffing ? bluffer.name : caller.name,
    });

    if (wasBluffing) {
      bluffer.hand.push(...room.pile);
      addLog(room, `BLUFF! ${bluffer.name} takes ${room.pile.length} cards. ${caller.name} starts next round.`);
      room.turnIdx = room.players.indexOf(caller);
    } else {
      caller.hand.push(...room.pile);
      addLog(room, `Honest! ${caller.name} takes ${room.pile.length} cards. ${bluffer.name} starts next round.`);
      room.turnIdx = room.players.indexOf(bluffer);
    }

    room.pile = [];
    room.lastPlayed = [];
    room.lastPlayerId = null;
    room.currentRank = null;
    room.passCount = 0;
    room.phase = 'reveal'; // pause for reveal animation

    setTimeout(() => {
      if (!rooms[roomId]) return;
      if (checkWin(room)) { broadcastState(room); return; }
      room.phase = 'playing';
      broadcastState(room);
    }, 3500);
  });

  // Pass turn
  socket.on('pass', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[room.turnIdx];
    if (player.id !== socket.id) return;

    room.passCount++;
    addLog(room, `${player.name} passes`);

    // If everyone else has passed and we're back to the last player who played
    if (room.lastPlayerId && room.passCount >= room.players.length - 1) {
      // Last player must also pass to clear
      if (player.id === room.lastPlayerId) {
        addLog(room, `All passed. ${room.pile.length} cards removed from game.`);
        room.pile = [];
        room.lastPlayed = [];
        room.lastPlayerId = null;
        room.currentRank = null;
        room.passCount = 0;
        broadcastState(room);
        return;
      }
    }

    if (!room.lastPlayerId) {
      // Nobody has played yet, just rotate
    }

    advanceTurn(room);
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.connected = false;
    addLog(room, `${player.name} disconnected`);

    const connectedPlayers = room.players.filter(p => p.connected);

    // Case 1: host is alone in waiting room and goes offline → close room immediately
    if (room.phase === 'lobby' && connectedPlayers.length === 0) {
      delete rooms[roomId];
      return;
    }

    // Case 2: everyone is offline → close room after 60s grace period
    if (connectedPlayers.length === 0) {
      addLog(room, 'All players offline. Room will close in 60 seconds.');
      broadcastState(room);
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].players.every(p => !p.connected)) {
          delete rooms[roomId];
        }
      }, 60000);
      return;
    }

    // Transfer host to next connected player if host left
    if (room.hostId === socket.id) {
      const next = connectedPlayers[0];
      room.hostId = next.id;
      addLog(room, `${next.name} is now the host`);
    }

    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cheat game server running on port ${PORT}`));