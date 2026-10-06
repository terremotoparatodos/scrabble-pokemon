/* Solo observa el anfitrión: no guarda la partida, ocupa asiento ni envía jugadas. */
(function () {
  'use strict';
  const { $, el } = window.Dom;
  const BV = window.BoardView;
  const Net = window.NetProtocol;
  let code = Net.normalizeCode(new URLSearchParams(location.search).get('sala'));
  let peer = null;
  let conn = null;
  let retryTimer = null;
  let lastHeard = 0;
  let last = null;
  let shownMove = null;
  let board3d = null;
  let safeRect = null;
  // El audio sale de la pantalla principal, para que OBS no lo duplique.
  window.GameAudio = { play() {}, observe() {} };
  const board = BV.createBoard($('boardWrap'), () => {});
  // El fondo conserva el diseño original, con recortes solo en las cámaras.
  let backdropQueued = false;
  const backdropObserver = new ResizeObserver(scheduleBackdrop);
  function scheduleBackdrop() {
    if (backdropQueued) return;
    backdropQueued = true;
    requestAnimationFrame(() => {
      backdropQueued = false;
      const w = innerWidth;
      const h = innerHeight;
      let path = `M0 0H${w}V${h}H0Z`;
      for (const frame of document.querySelectorAll('.cam-frame')) {
        const b = frame.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const style = getComputedStyle(frame.parentElement);
        const r = Math.max(0, Math.min(b.width / 2, b.height / 2, parseFloat(style.borderTopLeftRadius) - parseFloat(style.borderLeftWidth)));
        path += ` M${b.left + r} ${b.top}H${b.right - r}Q${b.right} ${b.top} ${b.right} ${b.top + r}V${b.bottom}H${b.left}V${b.top + r}Q${b.left} ${b.top} ${b.left + r} ${b.top}Z`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path fill="white" fill-rule="evenodd" d="${path}"/></svg>`;
      document.body.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    });
  }
  window.addEventListener('resize', scheduleBackdrop);
  const safeArea = window.GameHud.watchSafeArea({ area: $('playArea'), top: $('hudTop'), bottom: $('hudBottom'), onChange(rect) {
    safeRect = rect;
    window.GameHud.placeBoard2d($('boardFrame'), rect);
    if (board3d) board3d.setSafeArea(rect);
  } });

  function apply3d() {
    if (!board3d && window.Board3D) board3d = window.Board3D.create($('board3dCanvas'), { tapCell() {}, movePending() {}, removeAt() {}, isOverRack: () => false });
    $('board3dWrap').hidden = !board3d;
    $('boardFrame').hidden = !!board3d;
    if (board3d && safeRect) board3d.setSafeArea(safeRect);
    if (last?.game) render();
  }
  window.addEventListener('board3d-ready', apply3d);

  function status(text) {
    $('spectatorConnection').textContent = text;
    $('spectatorConnection').hidden = !text;
    $('spectatorStatus').textContent = text || `Sala ${code}: esperando que comience la partida…`;
  }

  function render() {
    const g = last?.game;
    $('screenGame').hidden = !g;
    $('spectatorWait').hidden = !!g;
    if (!g) { shownMove = null; scheduleBackdrop(); return; }
    window.GameCams.render(g, (seat) => !!last.lobby[seat]?.connected, { spectator: true });
    backdropObserver.disconnect();
    document.querySelectorAll('.cam-frame').forEach((frame) => backdropObserver.observe(frame));
    scheduleBackdrop();
    const round = g.rounds ? `Ronda ${g.round}/${g.rounds}` : `Ronda ${g.round}`;
    const meta = el('span', { class: 'hud-meta', text: `${round} · 🎒 ${g.bagCount}` });
    const p = g.players[g.turn];
    $('hudTurn').replaceChildren(el('div', { class: 'hud-pill', style: { '--pc': p.color } }, g.phase === 'play' ? [
      BV.sprite(p.avatar, 'hud-avatar'),
      el('div', { class: 'hud-who' }, [el('small', { text: 'Turno de' }), el('strong', { text: p.name })]),
      BV.recommendedTypeChip(p.type, true), meta,
    ] : [el('strong', { text: `🏆 ${g.winners.map((i) => g.players[i].name).join(' y ')} ${g.winners.length > 1 ? 'empatan' : 'gana'}` }), meta]));
    const activeBoard = board3d || board;
    activeBoard.render(g, { editable: false });
    if (shownMove == null || g.moveNo < shownMove) shownMove = g.moveNo;
    if (g.moveNo > shownMove && g.log[0]?.kind === 'play' && g.log[0].n === g.moveNo && board3d) board3d.celebrate(g);
    shownMove = g.moveNo;
    safeArea.schedule();
  }

  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 2500);
  }

  function connect() {
    clearTimeout(retryTimer);
    if (!code) return;
    status('Conectando con la sala…');
    if (typeof window.Peer !== 'function') { status('No se pudo conectar. Revisa internet y recarga esta fuente.'); return; }
    if (!peer || peer.destroyed) {
      peer = new window.Peer({ debug: 1 });
      peer.on('open', openConnection);
      peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
      peer.on('error', (err) => {
        status(err.type === 'peer-unavailable' ? `Sala ${code} no disponible. Mantén abierta la pantalla principal.` : 'Conexión interrumpida. Reintentando…');
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          const old = peer;
          peer = null;
          if (conn) { const c = conn; conn = null; c.close(); }
          old.destroy();
        }
        retryLater();
      });
    } else if (peer.open) openConnection();
  }

  function openConnection() {
    if (conn?.open) return;
    if (conn) { const old = conn; conn = null; old.close(); }
    const c = peer.connect(Net.ROOM_PREFIX + code, { reliable: true });
    conn = c;
    c.on('open', () => {
      if (conn !== c) return;
      lastHeard = Date.now();
      c.send({ t: 'spectate' });
    });
    c.on('data', (msg) => {
      if (conn !== c || !Net.isMessage(msg, true)) return;
      lastHeard = Date.now();
      if (msg.t === 'state' && msg.spectator) { last = msg; status(''); render(); }
    });
    c.on('close', () => { if (conn === c) { conn = null; status('Reconectando con la sala…'); retryLater(); } });
    c.on('error', () => {
      if (conn !== c) return;
      conn = null;
      c.close();
      status('Reconectando con la sala…');
      retryLater();
    });
  }

  setInterval(() => {
    if (!conn?.open) return;
    if (Date.now() - lastHeard > Net.DEAD_MS) {
      const old = conn;
      conn = null;
      old.close();
      connect();
    } else conn.send({ t: 'ping' });
  }, Net.PING_MS);
  $('spectatorCodeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = Net.normalizeCode($('spectatorCode').value);
    if (!next) { status('Escribe el código de 5 letras o números de tu sala.'); return; }
    code = next;
    history.replaceState(null, '', `?sala=${code}`);
    $('spectatorCodeForm').hidden = true;
    connect();
  });
  window.addEventListener('beforeunload', () => { clearTimeout(retryTimer); if (peer) peer.destroy(); });
  $('spectatorCodeForm').hidden = !!code;
  apply3d();
  scheduleBackdrop();
  if (code) connect();
})();
