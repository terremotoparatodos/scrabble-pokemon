/*
 * Página del jugador (celular u otra pestaña).
 *
 * No guarda ni calcula la partida: se conecta a la pantalla principal,
 * manda intenciones (crear Pokémon, cambiar, pasar, pista) y dibuja lo que
 * recibe: el tablero completo, los puntajes y SOLO su atril.
 *
 * El asiento se recuerda con un token en sessionStorage: si el celular se
 * bloquea o se recarga la página, vuelve a su lugar solo. Un latido con la
 * sala detecta conexiones muertas y reconecta.
 */
(function () {
  'use strict';

  const { $, el, toast, openOverlay, closeOverlay } = window.Dom;
  const BV = window.BoardView;
  const Net = window.NetProtocol;

  const RETRY_MS = 2500;
  const REVEAL_MS = 2600;
  const SCREENS = ['scrCode', 'scrConnecting', 'scrJoin', 'scrWait', 'scrPlay'];

  let code = Net.normalizeCode(new URLSearchParams(window.location.search).get('sala'));
  let peer = null;
  let conn = null;
  let retryTimer = null;
  let revealTimer = null;
  let last = null; // último { room, you, lobby, game }
  let me = null; // { seat, token, name, avatar }
  let joinSeat = null;
  let lastHeard = 0;
  let shownMove = null;
  let wasMyTurn = false;

  const seatKey = () => `scrabblePokemon.ctrl.${code}`;
  const PROFILE_KEY = 'scrabblePokemon.ctrl.profile';

  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key));
    } catch (err) {
      console.warn('No se pudieron leer tus datos guardados:', err);
      return null;
    }
  }

  function loadMe() {
    const seat = readJson(sessionStorage, seatKey());
    const profile = readJson(localStorage, PROFILE_KEY) || {};
    return {
      seat: seat && Number.isInteger(seat.seat) ? seat.seat : null,
      token: seat && typeof seat.token === 'string' ? seat.token : Net.newToken(),
      name: typeof profile.name === 'string' ? profile.name : '',
      avatar: BV.AVATARS.includes(profile.avatar) ? profile.avatar : BV.AVATARS[0],
    };
  }

  function saveMe() {
    try {
      sessionStorage.setItem(seatKey(), JSON.stringify({ seat: me.seat, token: me.token }));
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: me.name, avatar: me.avatar }));
    } catch (err) {
      console.warn('No se pudieron guardar tus datos:', err);
    }
  }

  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    // La partida es pantalla completa: sin barra de página.
    document.body.classList.toggle('in-game', id === 'scrPlay');
    if (id === 'scrPlay') safeArea.schedule();
  }

  function setStatus(text, kind) {
    for (const id of ['ctrlStatus', 'ctrlStatusGame']) {
      $(id).textContent = text;
      $(id).className = `ctrl-status ${kind || ''}`;
    }
  }

  // ── Conexión ──
  function connect() {
    clearTimeout(retryTimer);
    if (typeof window.Peer !== 'function') {
      setStatus('Error', 'bad');
      $('connectingText').textContent = 'No se pudo cargar la librería de conexión. Revisa tu internet y recarga.';
      return show('scrConnecting');
    }
    show(last ? currentScreen() : 'scrConnecting');
    setStatus('Conectando…', 'wait');
    if (!peer || peer.destroyed) {
      peer = new window.Peer({ debug: 1 });
      peer.on('open', openConn);
      peer.on('disconnected', () => {
        if (peer && !peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        console.warn('Error de conexión:', err.type, err);
        if (err.type === 'peer-unavailable') {
          $('connectingText').textContent = `No se encuentra la sala ${code}. ¿Está abierta la pantalla principal?`;
          setStatus('Sala no encontrada', 'bad');
          if (!last) show('scrConnecting');
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          peer.destroy();
          peer = null;
          setStatus('Sin conexión', 'bad');
        }
        retryLater();
      });
    } else if (peer.open) {
      openConn();
    }
  }

  function openConn() {
    if (conn && conn.open) return;
    if (conn) conn.close();
    const c = peer.connect(Net.ROOM_PREFIX + code, { reliable: true });
    conn = c;
    c.on('open', () => {
      if (c !== conn) return;
      lastHeard = Date.now();
      lastPreviewSignature = '';
      setStatus(`Sala ${code}`, 'ok');
      if (me.seat != null) sendJoin(me.seat);
    });
    c.on('data', (msg) => {
      if (c !== conn) return;
      lastHeard = Date.now();
      onMessage(msg);
    });
    c.on('close', () => {
      if (c !== conn) return;
      setStatus('Reconectando…', 'wait');
      retryLater();
    });
    c.on('error', (err) => {
      if (c !== conn) return;
      console.warn('Error en la conexión con la sala:', err);
      retryLater();
    });
  }

  function reconnectNow() {
    if (conn) {
      const old = conn;
      conn = null;
      old.close();
    }
    setStatus('Reconectando…', 'wait');
    connect();
  }

  setInterval(() => {
    if (!code || !conn || !conn.open) return;
    if (Date.now() - lastHeard > Net.DEAD_MS) return reconnectNow();
    conn.send({ t: 'ping' });
  }, Net.PING_MS);

  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_MS);
  }

  function send(msg) {
    if (!conn || !conn.open) {
      toast('Sin conexión con la sala. Reintentando…');
      return false;
    }
    conn.send(msg);
    return true;
  }

  function sendJoin(seat) {
    send({ t: 'join', seat, token: me.token, name: me.name, avatar: me.avatar });
  }

  function onMessage(msg) {
    if (!Net.isMessage(msg, true) || msg.t === 'pong') return;
    if (msg.t === 'state') {
      if (!last?.game && msg.game?.phase === 'play') window.GameAudio.play('start');
      if (!msg.game) window.GameAudio.observe(null);
      last = msg;
      render();
    } else if (msg.t === 'kicked') {
      me.seat = null;
      saveMe();
      toast('Tu asiento se abrió en otro dispositivo.');
    } else if (msg.t === 'joined') {
      me.seat = msg.seat;
      saveMe();
      $('joinError').textContent = '';
    } else if (msg.t === 'error') {
      $('joinError').textContent = String(msg.msg || 'Error');
      toast(`✗ ${String(msg.msg || 'Error')}`);
      if (last && last.you == null) {
        me.seat = null;
        saveMe();
      }
    }
  }

  // ── Dibujo ──
  function currentScreen() {
    if (!last) return 'scrConnecting';
    if (last.you == null) return 'scrJoin';
    return last.game ? 'scrPlay' : 'scrWait';
  }

  function render() {
    if (!code) return show('scrCode');
    const screen = currentScreen();
    show(screen);
    if (screen === 'scrJoin') renderJoin();
    if (screen === 'scrWait') renderWait();
    if (screen === 'scrPlay') renderPlay();
  }

  /** Asientos que este celular puede ocupar. */
  function seatOptions() {
    const g = last.game;
    return last.lobby.map((s, i) => {
      if (g) {
        const p = g.players.find((x) => x.seat === i);
        const free = !!p && !p.bot && !s.connected;
        return { seat: i, name: p ? p.name : 'Libre', avatar: p ? p.avatar : s.avatar, color: s.color, free, note: !p ? 'No juega' : p.bot ? 'Bot' : s.connected ? 'Ocupado' : 'Libre' };
      }
      return { seat: i, name: s.name || `Jugador ${i + 1}`, avatar: s.avatar, color: s.color, free: !s.connected, note: s.connected ? 'Ocupado' : 'Libre' };
    });
  }

  function renderJoin() {
    const opts = seatOptions();
    if (joinSeat == null || !opts[joinSeat] || !opts[joinSeat].free) {
      const firstFree = opts.find((o) => o.free);
      joinSeat = firstFree ? firstFree.seat : null;
    }
    $('seatList').replaceChildren(
      ...opts.map((o) =>
        el(
          'button',
          {
            class: 'ctrl-seat',
            style: { '--pc': o.color },
            attrs: { type: 'button', role: 'radio', 'aria-checked': String(joinSeat === o.seat), disabled: !o.free },
            on: {
              click: () => {
                joinSeat = o.seat;
                renderJoin();
              },
            },
          },
          [BV.sprite(o.avatar), el('strong', { text: `Jugador ${o.seat + 1}` }), el('small', { text: last.game ? `${o.name} · ${o.note}` : o.note })],
        ),
      ),
    );
    // En partida, el nombre y el compañero ya están elegidos.
    $('joinProfile').hidden = !!last.game;
    if (!last.game) {
      $('nameInput').value = me.name;
      $('avatarPicker').replaceChildren(
        ...BV.AVATARS.map((id) =>
          el(
            'button',
            {
              class: 'avatar-opt',
              style: { '--pc': opts[joinSeat] ? opts[joinSeat].color : '#e3350d' },
              attrs: { type: 'button', role: 'radio', 'aria-label': window.ScrabbleRules.DEX[id - 1].name, 'aria-checked': String(me.avatar === id) },
              on: {
                click: () => {
                  me.avatar = id;
                  renderJoin();
                },
              },
            },
            [BV.sprite(id)],
          ),
        ),
      );
    }
    $('btnJoin').disabled = joinSeat == null;
  }

  function renderWait() {
    const mine = last.lobby[last.you];
    $('waitMe').replaceChildren(BV.sprite(mine.avatar), el('div', {}, [el('small', { text: `Jugador ${last.you + 1}` }), el('strong', { style: { color: mine.color }, text: mine.name })]));
    $('lobbyList').replaceChildren(
      ...last.lobby.map((s, i) =>
        el('li', { style: { '--pc': s.color } }, [
          el('span', { class: 'seat-dot' }),
          el('strong', { text: s.name || `Jugador ${i + 1}` }),
          el('small', { text: s.mode === 'off' ? 'Vacío' : s.mode === 'bot' ? '🤖 Bot' : s.connected ? '📱 Conectado' : 'En la pantalla' }),
        ]),
      ),
    );
  }

  const board = BV.createBoard($('boardWrap'), (r, c) => panel.tapCell(r, c));
  const panel = window.PlayPanel.create({
    container: $('playPanel'),
    send: (action) => send({ t: 'act', a: action.type, tiles: action.tiles, indices: action.indices, swapType: action.swapType }),
    onChange: () => { activeBoard().render(last.game, panel.boardExtra()); schedulePreview(); },
    getDropTarget: () => activeBoard(),
  });

  // ── Primera persona 3D (view3d/, llega después; ver «board3d-ready») ──
  const VIEW_KEY = 'scrabblePokemon.ctrl.view3d';
  let board3d = null;
  let use3d = (() => {
    try {
      return localStorage.getItem(VIEW_KEY) !== '2d';
    } catch (err) {
      console.warn('No se pudo leer la vista guardada:', err);
      return true;
    }
  })();
  const has3d = () => use3d && !!board3d;
  const activeBoard = () => (has3d() ? board3d : board);
  let previewTimer = null;
  let lastPreviewSignature = '';
  function schedulePreview() {
    if (previewTimer) return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      const g = last?.game;
      if (!conn?.open || !g || g.phase !== 'play' || g.me !== g.turn) return;
      const preview = window.LiveView.pack(g, panel.boardExtra(), has3d(), board3d?.getCameraView());
      const signature = JSON.stringify(preview);
      if (signature === lastPreviewSignature) return;
      lastPreviewSignature = signature;
      conn.send({ t: 'preview', preview });
    }, 50);
  }

  function apply3d() {
    if (use3d && !board3d && window.Board3D) {
      board3d = window.Board3D.create($('board3dCanvas'), panel);
      board3d.onViewChange(schedulePreview);
    }
    $('board3dWrap').hidden = !has3d();
    $('boardFrame').hidden = has3d();
    $('btnCam').hidden = !has3d();
    $('btnCenter').hidden = !has3d();
    if (lastSafe) applySafe(lastSafe);
    $('btnView3d').hidden = !window.Board3D;
    $('btnView3d').textContent = has3d() ? '▦ Vista 2D' : '🧊 Vista 3D';
    if (last && last.game) renderPlay();
  }
  window.addEventListener('board3d-ready', apply3d);
  $('btnView3d').addEventListener('click', () => {
    use3d = !use3d;
    try {
      localStorage.setItem(VIEW_KEY, use3d ? '3d' : '2d');
    } catch (err) {
      console.warn('No se pudo guardar la vista:', err);
    }
    apply3d();
  });
  $('btnCam').addEventListener('click', () => {
    if (!board3d) return;
    board3d.toggleView();
    $('btnCam').textContent = board3d.isAltView() ? '🎯 Ver el tablero' : '🪑 Ver la mesa';
  });
  $('btnCenter').addEventListener('click', () => board3d && board3d.resetView());

  // ── Pantalla completa: el tablero se encuadra donde no tapan la barra ni el atril ──
  let lastSafe = null;
  function applySafe(rect) {
    lastSafe = rect;
    if (board3d) board3d.setSafeArea(rect);
    window.GameHud.placeBoard2d($('boardFrame'), rect);
  }
  const safeArea = window.GameHud.watchSafeArea({ area: $('playArea'), top: $('hudTop'), bottom: $('hudBottom'), onChange: applySafe });
  window.GameHud.bindMenu($('btnMenu'), $('menuDrawer'), $('btnMenuClose'));
  window.GameHud.bindFullscreen($('btnFull'));

  function renderPlay() {
    const g = last.game;
    window.GameAudio.observe(g);
    window.GameHud.renderPlayerScores($('hudTurn'), g);
    panel.update(g);
    activeBoard().render(g, panel.boardExtra());
    schedulePreview();
    renderOver(g);
    maybeReveal(g);
    safeArea.schedule();
    const myTurn = g.phase === 'play' && g.turn === g.me;
    if (myTurn && !wasMyTurn) {
      window.GameAudio.play('turn');
      // Tu turno: el atril y tu puntaje se animan (nada tapa el tablero).
      for (const node of document.querySelectorAll('#playPanel .play-panel, .ctrl-score.mine')) {
        node.classList.remove('turn-in');
        void node.offsetWidth;
        node.classList.add('turn-in');
      }
      toast('¡Es tu turno!');
      // Vibrar solo funciona después de que la persona tocó la página.
      if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate([80, 60, 80]);
    }
    wasMyTurn = myTurn;
  }

  function renderOver(g) {
    $('overCard').hidden = g.phase !== 'over';
    if (g.phase !== 'over') return;
    const names = g.winners.map((i) => g.players[i].name);
    $('overCard').replaceChildren(
      el('h2', { text: names.length > 1 ? `🏆 ¡Empate entre ${names.join(' y ')}!` : `🏆 ¡Ganó ${names[0]}!` }),
      el('p', { class: 'muted', text: BV.END_REASON[g.endReason] || '' }),
    );
  }

  function maybeReveal(g) {
    if (shownMove == null) shownMove = g.moveNo; // al conectarse no se repite la última jugada
    if (!g.lastMove || shownMove >= g.moveNo) return;
    shownMove = g.moveNo;
    if (!(g.log[0] && g.log[0].kind === 'play' && g.log[0].n === g.moveNo)) return;
    // En 3D el Pokémon sale de la Poké Ball sobre el tablero, sin ventana.
    if (has3d()) return board3d.celebrate(g);
    window.GameAudio.play('capture');
    $('revealBody').replaceChildren(BV.revealCard(g));
    openOverlay('revealDialog');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => closeOverlay('revealDialog'), REVEAL_MS);
  }

  async function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('No se pudo mantener la pantalla encendida:', err);
    }
  }

  // ── Inicio ──
  function start() {
    me = loadMe();
    connect();
    render();
    keepAwake();
  }

  $('codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = Net.normalizeCode($('codeInput').value);
    if (!c) return toast('El código tiene 5 letras o números.');
    code = c;
    history.replaceState(null, '', `?sala=${c}`);
    start();
  });
  $('nameInput').addEventListener('input', (e) => {
    me.name = e.target.value;
  });
  $('btnJoin').addEventListener('click', () => {
    if (joinSeat == null) return;
    if (!last.game && !me.name.trim()) {
      $('joinError').textContent = 'Escribe tu nombre.';
      return;
    }
    saveMe();
    sendJoin(joinSeat);
  });
  $('btnLeave').addEventListener('click', () => {
    send({ t: 'leave' });
    me.seat = null;
    saveMe();
  });
  $('revealDialog').addEventListener('click', () => closeOverlay('revealDialog'));
  document.addEventListener('keydown', (e) => {
    if (last && last.game && panel.onKey(e)) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !code) return;
    keepAwake();
    if (!conn || !conn.open) connect();
    else if (Date.now() - lastHeard > Net.PING_MS * 2) reconnectNow();
  });

  if (code) start();
  else show('scrCode');
})();
