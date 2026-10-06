/* Solo observa el anfitrión: no guarda la partida, ocupa asiento ni envía jugadas. */
(function () {
  'use strict';
  const { $, el, openOverlay, closeOverlay } = window.Dom;
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
  let cameraSignature = '';
  let safeRect = null;
  let audibleDraft = null;
  let revealTimer = null;
  const audio = window.GameAudio;
  // OBS permite reproducción automática; en otros navegadores se ofrece un gesto.
  function soundStatus() { $('spectatorSound').hidden = audio.isReady(); }
  window.addEventListener('game-audio-state', soundStatus);
  $('spectatorSound').addEventListener('click', () => { audio.setEnabled(true); audio.unlock(); soundStatus(); });
  audio.unlock();
  soundStatus();
  const board = BV.createBoard($('boardWrap'), () => {});
  const panel = window.PlayPanel.create({ container: $('playPanel'), readOnly: true, send() {} });
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
    const use3d = !!board3d && last?.preview?.view3d !== false;
    $('board3dWrap').hidden = !use3d;
    $('boardFrame').hidden = use3d;
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
    if (!g) { shownMove = null; audibleDraft = null; panel.update(null); audio.observe(null); closeOverlay('revealDialog'); scheduleBackdrop(); return; }
    audio.observe(g);
    window.GameCams.render(g, (seat) => !!last.lobby[seat]?.connected, { spectator: true });
    backdropObserver.disconnect();
    document.querySelectorAll('.cam-frame').forEach((frame) => backdropObserver.observe(frame));
    scheduleBackdrop();
    window.GameHud.renderPlayerScores($('hudTurn'), g);
    $('overCard').hidden = g.phase !== 'over';
    if (g.phase === 'over') {
      const names = g.winners.map((i) => g.players[i].name);
      $('overCard').replaceChildren(el('h2', { text: names.length > 1 ? `🏆 ¡Empate entre ${names.join(' y ')}!` : `🏆 ¡Ganó ${names[0]}!` }), el('p', { class: 'muted', text: BV.END_REASON[g.endReason] || '' }));
    }
    drawBoard();
    if (shownMove == null || g.moveNo < shownMove) shownMove = g.moveNo;
    if (g.moveNo > shownMove && g.log[0]?.kind === 'play' && g.log[0].n === g.moveNo) {
      if (board3d && !$('board3dWrap').hidden) board3d.celebrate(g);
      else {
        audio.play('capture');
        $('revealBody').replaceChildren(BV.revealCard(g));
        openOverlay('revealDialog');
        clearTimeout(revealTimer);
        revealTimer = setTimeout(() => closeOverlay('revealDialog'), 2600);
      }
    }
    shownMove = g.moveNo;
    safeArea.schedule();
  }

  function drawBoard() {
    const g = last?.game;
    if (!g) return;
    const draft = last.preview?.key === g.liveKey ? last.preview : null;
    const extra = { ...draft, editable: false };
    panel.update(g, draft);
    const use3d = !!board3d && draft?.view3d !== false;
    $('board3dWrap').hidden = !use3d;
    $('boardFrame').hidden = use3d;
    (use3d ? board3d : board).render(g, extra);
    if (use3d && draft?.camera) {
      const signature = JSON.stringify([draft.seat, draft.key, draft.camera]);
      if (signature !== cameraSignature) { cameraSignature = signature; board3d.setCameraView(draft.camera); }
    }
    if (draft && audibleDraft?.key === draft.key) {
      const previous = new Set(audibleDraft.pending.map((t) => t.i));
      draft.pending.filter((t) => !previous.has(t.i)).forEach((_, i) => setTimeout(() => audio.play('tile'), i * 45));
    }
    audibleDraft = draft;
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
      if (msg.t === 'state' && msg.spectator) {
        if (!last?.game && msg.game?.phase === 'play') audio.play('start');
        else if (last?.game?.turn !== msg.game?.turn && msg.game?.phase === 'play') audio.play('turn');
        last = msg; status(''); render();
      }
      else if (msg.t === 'preview' && last?.game && msg.preview?.key === last.game.liveKey) { last.preview = msg.preview; drawBoard(); }
      else if (msg.t === 'sound' && last?.game?.phase === 'play' && msg.effect === 'shuffle' && last.game.players.some((p) => p.seat === msg.seat)) audio.play('shuffle');
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
  window.addEventListener('beforeunload', () => { clearTimeout(retryTimer); clearTimeout(revealTimer); if (peer) peer.destroy(); });
  $('spectatorCodeForm').hidden = !!code;
  apply3d();
  scheduleBackdrop();
  if (code) connect();
})();
