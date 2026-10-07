/*
 * Sala en línea del lado de la pantalla principal (como en Pokémon Party).
 *
 * - Crea la sala (un Peer con id fijo derivado del código).
 * - Asigna asientos a los celulares y reenvía sus acciones a HostGame, que
 *   vuelve a validar cada una.
 * - Manda a cada celular su vista: el tablero, los puntajes y SOLO su atril.
 *
 * Si un celular se desconecta (o deja de dar latidos), su asiento vuelve a
 * jugarse desde esta pantalla hasta que se reconecte con su token.
 */
(function () {
  'use strict';

  const { $, el, toast } = window.Dom;
  const Game = window.HostGame;
  const Setup = window.GameSetup;
  const Net = window.NetProtocol;

  const ROOM_KEY = 'scrabblePokemon.room.v1';
  const SEATS = Setup.SEATS;
  const ID_RETRIES = 6; // tras recargar, el servidor tarda en liberar el id anterior

  let peer = null;
  let code = null;
  let status = { kind: 'off', text: 'Sin sala en línea' };
  let idRetries = 0;
  let retryTimer = null;
  let broadcastQueued = false;
  const conns = new Set();
  const seatConn = Array(SEATS).fill(null);
  const seatToken = Array(SEATS).fill(null);

  function readRoom() {
    try {
      return Net.normalizeCode(localStorage.getItem(ROOM_KEY));
    } catch (err) {
      console.warn('No se pudo leer la sala guardada:', err);
      return null;
    }
  }

  function writeRoom(value) {
    try {
      if (value) localStorage.setItem(ROOM_KEY, value);
      else localStorage.removeItem(ROOM_KEY);
    } catch (err) {
      console.warn('No se pudo guardar la sala:', err);
    }
  }

  const isConnected = (seat) => !!seatConn[seat] && seatConn[seat].open;
  const seatName = (seat) => Setup.seats()[seat].name || `Jugador ${seat + 1}`;

  function setStatus(kind, text) {
    status = { kind, text };
    renderPanels();
  }

  // ── Ciclo de vida de la sala ──
  function openRoom(existing) {
    clearTimeout(retryTimer);
    if (typeof window.Peer !== 'function') return setStatus('error', 'No se pudo cargar la librería de conexión.');
    code = existing || Net.newRoomCode();
    writeRoom(code);
    setStatus('connecting', 'Conectando con el servidor…');
    peer = new window.Peer(Net.ROOM_PREFIX + code, { debug: 1 });
    peer.on('open', () => {
      idRetries = 0;
      setStatus('online', 'Sala en línea');
    });
    peer.on('connection', onConnection);
    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) {
        setStatus('connecting', 'Reconectando con el servidor…');
        peer.reconnect();
      }
    });
    peer.on('error', onPeerError);
  }

  function onPeerError(err) {
    console.warn('Error en la sala en línea:', err.type, err);
    if (err.type === 'unavailable-id') {
      destroyPeer();
      if (idRetries++ < ID_RETRIES) {
        setStatus('connecting', 'Recuperando la sala…');
        retryTimer = setTimeout(() => openRoom(code), 3000);
      } else {
        setStatus('error', 'Ese código de sala sigue en uso. Cierra la sala y crea una nueva.');
      }
      return;
    }
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      destroyPeer();
      setStatus('error', 'Sin conexión con el servidor. Reintentando…');
      retryTimer = setTimeout(() => openRoom(code), 5000);
      return;
    }
    if (err.type === 'browser-incompatible') setStatus('error', 'Este navegador no permite jugar en línea.');
  }

  function destroyPeer() {
    if (peer && !peer.destroyed) peer.destroy();
    peer = null;
  }

  function closeRoom() {
    clearTimeout(retryTimer);
    for (const conn of conns) conn.close();
    conns.clear();
    for (let i = 0; i < SEATS; i++) releaseSeat(i, { forget: true });
    destroyPeer();
    code = null;
    writeRoom(null);
    setStatus('off', 'Sin sala en línea');
    Game.setRemoteSeats(isConnected);
  }

  // ── Conexiones ──
  function onConnection(conn) {
    conn.seat = null;
    conn.lastSeen = Date.now();
    conn.on('open', () => {
      conn.lastSeen = Date.now();
      conns.add(conn);
      sendState(conn);
    });
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      handleMessage(conn, msg);
    });
    conn.on('close', () => dropConn(conn));
    conn.on('error', (err) => {
      console.warn('Error en la conexión de un celular:', err);
      dropConn(conn);
    });
  }

  function dropConn(conn) {
    if (!conns.has(conn)) return;
    conns.delete(conn);
    if (conn.open) conn.close();
    if (conn.seat != null && seatConn[conn.seat] === conn) {
      Game.clearPreview(conn.seat);
      toast(`📴 ${seatName(conn.seat)} se desconectó`);
      releaseSeat(conn.seat, { forget: false });
    }
    afterSeatsChanged();
  }

  function releaseSeat(seat, { forget }) {
    seatConn[seat] = null;
    if (forget) seatToken[seat] = null;
    Setup.setRemote(seat, null);
  }

  function afterSeatsChanged() {
    Game.setRemoteSeats(isConnected);
    renderPanels();
    scheduleBroadcast();
  }

  function reply(conn, msg) {
    if (conn.open) conn.send(msg);
  }

  function handleMessage(conn, msg) {
    if (!Net.isMessage(msg)) return;
    switch (msg.t) {
      case 'ping':
        return reply(conn, { t: 'pong' });
      case 'spectate':
        if (conn.seat != null) return reply(conn, { t: 'error', msg: 'Un jugador no puede cambiar a espectador desde su asiento.' });
        conn.spectator = true;
        return sendState(conn);
      case 'join':
        if (conn.spectator) return reply(conn, { t: 'error', msg: 'La vista OBS solo permite observar.' });
        return handleJoin(conn, msg);
      case 'leave':
        if (conn.seat != null && seatConn[conn.seat] === conn) {
          Game.clearPreview(conn.seat);
          releaseSeat(conn.seat, { forget: true });
          conn.seat = null;
          afterSeatsChanged();
        }
        return;
      case 'preview':
        if (!conn.spectator && conn.seat != null && seatConn[conn.seat] === conn) Game.receivePreview(conn.seat, msg.preview);
        return;
      case 'sound':
        if (!conn.spectator && conn.seat != null && seatConn[conn.seat] === conn) Game.emitSound(conn.seat, msg.effect);
        return;
      case 'act': {
        if (conn.spectator) return reply(conn, { t: 'error', msg: 'La vista OBS solo permite observar.' });
        if (conn.seat == null || seatConn[conn.seat] !== conn) return reply(conn, { t: 'error', msg: 'Primero elige tu asiento.' });
        const res = Game.act(conn.seat, { type: msg.a, tiles: msg.tiles, indices: msg.indices, swapType: !!msg.swapType, slot: msg.slot, detail: msg.detail });
        if (!res.ok) {
          reply(conn, { t: 'error', msg: res.error });
          sendState(conn); // re-sincroniza por si el celular iba atrasado
        }
        return;
      }
      default:
        return;
    }
  }

  function handleJoin(conn, msg) {
    const seat = msg.seat;
    const token = typeof msg.token === 'string' && /^[a-z0-9]{8,64}$/.test(msg.token) ? msg.token : null;
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS || !token) return reply(conn, { t: 'error', msg: 'Pedido inválido.' });

    const holder = seatConn[seat];
    if (holder && holder !== conn && holder.open && seatToken[seat] !== token) {
      return reply(conn, { t: 'error', msg: 'Ese asiento ya está ocupado por otro celular.' });
    }

    if (Game.inGame()) {
      if (!Game.isPlayerSeat(seat)) return reply(conn, { t: 'error', msg: 'Ese asiento no tiene una persona en esta partida.' });
    } else {
      const avatar = Setup.AVATARS.includes(msg.avatar) ? msg.avatar : null;
      const problem = Setup.validateClaim(seat, msg.name, avatar);
      if (problem) return reply(conn, { t: 'error', msg: problem });
    }

    if (conn.seat != null && conn.seat !== seat && seatConn[conn.seat] === conn) releaseSeat(conn.seat, { forget: true });
    if (holder && holder !== conn) {
      holder.seat = null;
      reply(holder, { t: 'kicked' });
      setTimeout(() => holder.close(), 300);
    }
    seatConn[seat] = conn;
    seatToken[seat] = token;
    conn.seat = seat;
    const s = Setup.seats()[seat];
    Setup.setRemote(seat, Game.inGame() ? { name: s.name, avatar: s.avatar } : { name: msg.name, avatar: msg.avatar });

    reply(conn, { t: 'joined', seat });
    toast(`📱 ${seatName(seat)} se conectó`);
    afterSeatsChanged();
  }

  // ── Envío de estado ──
  function lobbyView() {
    return Setup.seats().map((s, i) => ({ name: s.name, avatar: s.avatar, color: s.color, mode: s.mode, connected: isConnected(i) }));
  }

  function sendState(conn) {
    reply(conn, { t: 'state', room: code, you: conn.seat, spectator: !!conn.spectator, lobby: lobbyView(), game: conn.spectator ? Game.spectatorView() : Game.publicView(conn.seat), ...(conn.spectator ? { preview: Game.presentationView() } : {}) });
  }

  function scheduleBroadcast() {
    if (broadcastQueued) return;
    broadcastQueued = true;
    queueMicrotask(() => {
      broadcastQueued = false;
      for (const conn of conns) sendState(conn);
    });
  }

  // ── Panel de la sala ──
  function copyLink(url) {
    navigator.clipboard.writeText(url).then(
      () => toast('Enlace copiado'),
      (err) => {
        console.warn('No se pudo copiar el enlace:', err);
        toast('No se pudo copiar: selecciónalo y cópialo a mano');
      },
    );
  }

  const isLocalhost = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  function panelContent(compact) {
    if (!code) {
      return [
        compact ? null : el('p', { class: 'room-help', text: 'Cada jugador puede jugar desde su celular u otra pestaña, viendo el tablero y solo sus fichas. Los asientos sin celular se juegan desde esta pantalla.' }),
        el('button', { class: 'btn btn-primary', text: '🌐 Crear sala en línea', attrs: { type: 'button' }, on: { click: () => openRoom(null) } }),
      ];
    }
    const url = Net.controlUrl(code);
    const obsUrl = Net.spectatorUrl(code);
    return [
      el('div', { class: `room-status ${status.kind}` }, [el('span', { class: 'room-dot' }), status.text]),
      el('div', { class: 'room-code-row' }, [el('span', { class: 'room-code-label', text: 'Código' }), el('strong', { class: 'room-code', text: code })]),
      isLocalhost()
        ? el('p', { class: 'room-warn', text: '⚠ Abriste esta pantalla como «localhost»: ese enlace no sirve en los celulares. Ábrela con la IP de esta PC (por ejemplo http://192.168.1.9:8766).' })
        : null,
      el('div', { class: 'room-link' }, [
        el('input', { class: 'room-link-input', attrs: { type: 'text', readonly: true, value: url, 'aria-label': 'Enlace para jugadores' } }),
        el('button', { class: 'btn', text: '📋 Copiar', attrs: { type: 'button' }, on: { click: () => copyLink(url) } }),
      ]),
      el('p', { class: 'room-help', text: '🎥 OBS muestra la vista y el atril del jugador en turno, la jugada en preparación y los sonidos. Cámaras más altas, transparentes por dentro y con el fondo original alrededor. Usa este enlace como fuente Navegador, activa su audio en OBS y coloca tus cámaras debajo. Mantén abierta esta pantalla.' }),
      el('div', { class: 'room-link' }, [
        el('input', { class: 'room-link-input', attrs: { type: 'text', readonly: true, value: obsUrl, 'aria-label': 'Enlace OBS' } }),
        el('button', { class: 'btn', text: '📋 Copiar OBS', attrs: { type: 'button' }, on: { click: () => copyLink(obsUrl) } }),
      ]),
      compact ? null : el('button', { class: 'btn btn-ghost room-close', text: 'Cerrar sala', attrs: { type: 'button' }, on: { click: closeRoom } }),
    ];
  }

  function renderPanels() {
    $('onlinePanel').replaceChildren(...panelContent(false).filter(Boolean));
    $('onlinePanelGame').replaceChildren(...panelContent(true).filter(Boolean));
    const connected = seatConn.filter((c) => c && c.open).length;
    $('roomBadge').hidden = !code;
    $('roomBadge').textContent = code ? `🌐 ${code} · ${connected} 📱` : '';
    $('roomBadge').className = `room-badge ${status.kind}`;
  }

  function sweepDeadConns() {
    const now = Date.now();
    for (const conn of [...conns]) {
      if (now - conn.lastSeen > Net.DEAD_MS) {
        console.warn('Un celular dejó de responder; se libera su asiento.');
        dropConn(conn);
      }
    }
  }

  setInterval(sweepDeadConns, Net.PING_MS);
  Game.onUpdate(scheduleBroadcast);
  Game.onPreviewUpdate(() => {
    const msg = { t: 'preview', preview: Game.presentationView() };
    for (const conn of conns) if (conn.spectator) reply(conn, msg);
  });
  Game.onSound((sound) => {
    for (const conn of conns) if (conn.spectator) reply(conn, { t: 'sound', ...sound });
  });
  Setup.onChange(() => {
    renderPanels();
    scheduleBroadcast();
  });
  Game.setRemoteSeats(isConnected);
  renderPanels();
  const saved = readRoom();
  if (saved) openRoom(saved);
  window.addEventListener('beforeunload', () => destroyPeer());
})();
