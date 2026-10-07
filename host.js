/*
 * Pantalla principal: dueña de la partida.
 *
 * - Crea la partida desde la configuración y la guarda en localStorage
 *   (al recargar, sigue donde estaba).
 * - Aplica las acciones de esta pantalla, de los celulares (net-host.js) y
 *   de los bots; ScrabbleGame valida cada una.
 * - Pantalla completa: el tablero ocupa el área de juego; afuera solo van
 *   las cámaras (cams.js) con la placa de cada jugador. Arriba, la barra del
 *   turno y el menú; abajo, el atril si el jugador en turno juega en esta
 *   pantalla (con varios jugadores aquí, una cortina lo tapa hasta que lo
 *   toca). El tablero se encuadra en el espacio libre (hud.js): nada se
 *   le superpone.
 */
(function () {
  'use strict';

  const { $, el, openOverlay, closeOverlay, toast } = window.Dom;
  const G = window.ScrabbleGame;
  const M = window.ScrabbleMoves;
  const BV = window.BoardView;
  const Setup = window.GameSetup;
  const Hud = window.GameHud;
  const Cams = window.GameCams;

  const GAME_KEY = 'scrabblePokemon.game.v1';
  const VIEW_KEY = 'scrabblePokemon.view3d';
  const BOT_DELAY_MS = 1400;
  const REVEAL_MS = 2600;
  const CELEBRATE_3D_MS = 6200;
  const END_DELAY_3D_MS = 5500;

  let state = null;
  let isRemote = () => false;
  let botTimer = null;
  let revealTimer = null;
  let shownMove = 0;
  let curtainOpenFor = null; // clave del turno cuya cortina ya se levantó
  const listeners = [];
  const previewListeners = [];
  const soundListeners = [];
  let liveKey = Math.random().toString(36).slice(2);
  let livePreview = null;
  let previewSignature = '';

  // ── Persistencia ──
  function save() {
    try {
      if (state) localStorage.setItem(GAME_KEY, JSON.stringify(state));
      else localStorage.removeItem(GAME_KEY);
    } catch (err) {
      console.warn('No se pudo guardar la partida:', err);
    }
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
      return saved && Array.isArray(saved.board) && Array.isArray(saved.players) ? saved : null;
    } catch (err) {
      console.warn('No se pudo leer la partida guardada:', err);
      return null;
    }
  }

  // ── Turnos ──
  const current = () => state.players[state.turn];
  const playerIndex = (seat) => state.players.findIndex((p) => p.seat === seat);
  const isLocalHuman = (p) => !p.bot && !isRemote(p.seat);

  /** Acción de un asiento (pantalla, celular o bot). Devuelve el resultado de ScrabbleGame. */
  function act(seat, action) {
    if (!state) return { ok: false, error: 'No hay partida en curso.' };
    const i = playerIndex(seat);
    if (i < 0) return { ok: false, error: 'Ese asiento no juega en esta partida.' };
    const res = G.act(state, i, action, Math.random);
    if (res.ok) changed(action.type === 'clue');
    return res;
  }

  function changed(keepPreview = false) {
    if (!keepPreview) {
      liveKey = Math.random().toString(36).slice(2);
      livePreview = null;
      previewSignature = '';
    }
    save();
    render();
    listeners.forEach((fn) => fn());
    scheduleBot();
  }

  function scheduleBot() {
    clearTimeout(botTimer);
    if (!state || state.phase !== 'play' || !current().bot) return;
    // Tras una jugada, el bot espera a que termine el festejo (más largo en 3D).
    const justPlayed = state.log[0] && state.log[0].kind === 'play' && state.log[0].n === state.moveNo;
    const delay = justPlayed ? (has3d() ? CELEBRATE_3D_MS : BOT_DELAY_MS + REVEAL_MS / 2) : BOT_DELAY_MS;
    botTimer = setTimeout(botTurn, delay);
  }

  function botTurn() {
    if (!state || state.phase !== 'play' || !current().bot) return;
    const p = current();
    const best = M.bestMove(state.board, p.rack, p.type, state.used);
    if (!best) return act(p.seat, { type: 'pass' });
    const tiles = window.ScrabbleRules.assignRack(p.rack, best.place);
    const res = act(p.seat, { type: 'play', tiles });
    if (!res.ok) {
      console.warn('El bot no pudo jugar:', res.error);
      act(p.seat, { type: 'pass' });
    }
  }

  function start(players) {
    state = G.createGame({ players, rounds: Setup.rounds() }, Math.random);
    window.GameAudio.observe(null);
    window.GameAudio.play('start');
    shownMove = 0;
    curtainOpenFor = null;
    closeOverlay('endDialog');
    showScreen('game');
    changed();
  }

  function quit() {
    clearTimeout(botTimer);
    state = null;
    window.GameAudio.observe(null);
    save();
    closeOverlay('endDialog');
    showScreen('setup');
    listeners.forEach((fn) => fn());
  }

  // ── Dibujo ──
  const board = BV.createBoard($('boardWrap'), (r, c) => panel.tapCell(r, c));
  const panel = window.PlayPanel.create({
    container: $('playPanel'),
    send: (action) => {
      if (!state) return;
      const res = act(current().seat, action);
      if (!res.ok) toast(`✗ ${res.error}`);
    },
    onChange: () => { renderBoard(); publishLocalView(); },
    onSound: (effect) => { if (state && isLocalHuman(current())) emitSound(current().seat, effect); },
    getDropTarget: () => activeBoard(),
  });

  function showScreen(name) {
    $('screenSetup').hidden = name !== 'setup';
    $('screenGame').hidden = name !== 'game';
    // En partida no hay barra de página: todo es pantalla de juego.
    document.body.classList.toggle('in-game', name === 'game');
    if (name === 'setup') Setup.render();
    else safeArea.schedule();
  }

  /** Vista para esta pantalla: con atril solo si el jugador en turno juega aquí. */
  function hostView() {
    const p = current();
    const local = state.phase === 'play' && isLocalHuman(p);
    return publicView(local ? p.seat : null);
  }

  function publicView(seat) {
    return state ? { ...G.publicView(state, seat), liveKey } : null;
  }

  function presentationView() {
    if (!state) return null;
    const draft = livePreview?.key === liveKey ? livePreview : { key: liveKey, seat: current().seat, pending: [], cursor: null, view3d: has3d(), camera: { alt: false, yaw: 0, pitch: 0, zoom: 1, pan: { x: 0, z: 0 } } };
    return { ...draft, rack: draft.rack || current().rack.map((l, i) => ({ i, l, used: false, selected: false })), hint: state.hint?.player === state.turn ? state.hint : null };
  }

  function receivePreview(seat, input) {
    if (!state) return false;
    const clean = window.LiveView.clean(state, seat, input, liveKey);
    if (!clean) return false;
    const signature = JSON.stringify(clean);
    if (signature === previewSignature) return true;
    livePreview = clean;
    previewSignature = signature;
    if (isRemote(seat)) renderBoard();
    previewListeners.forEach((fn) => fn());
    return true;
  }

  function publishLocalView() {
    if (!state || state.phase !== 'play' || !isLocalHuman(current())) return;
    const view = hostView();
    const extra = curtainUp(view) ? {} : panel.boardExtra();
    receivePreview(current().seat, window.LiveView.pack(view, extra, has3d(), board3d?.getCameraView()));
  }

  function clearPreview(seat) {
    if (livePreview?.seat !== seat) return;
    livePreview = null;
    previewSignature = '';
    previewListeners.forEach((fn) => fn());
  }

  // Mezclar está disponible fuera del turno: su sonido no depende del borrador.
  function emitSound(seat, effect) {
    const p = state?.players.find((p) => p.seat === seat);
    if (state?.phase !== 'play' || !p || p.bot || effect !== 'shuffle') return false;
    soundListeners.forEach((fn) => fn({ seat, effect }));
    return true;
  }

  // ── Vista 3D (view3d/, módulo que llega después; ver «board3d-ready») ──
  let board3d = null;
  let use3d = readView3d();

  function readView3d() {
    try {
      return localStorage.getItem(VIEW_KEY) !== '2d';
    } catch (err) {
      console.warn('No se pudo leer la vista guardada:', err);
      return true;
    }
  }

  const has3d = () => use3d && !!board3d;
  const activeBoard = () => (has3d() ? board3d : board);

  function apply3d() {
    if (use3d && !board3d && window.Board3D) {
      board3d = window.Board3D.create($('board3dCanvas'), panel);
      board3d.onViewChange(publishLocalView);
    }
    $('board3dWrap').hidden = !has3d();
    $('boardFrame').hidden = has3d();
    $('btnView3d').hidden = !window.Board3D;
    $('btnView3d').textContent = has3d() ? '▦ Vista 2D' : '🧊 Vista 3D';
    $('btnCam').hidden = !has3d();
    $('btnCenter').hidden = !has3d();
    if (lastSafe) applySafe(lastSafe);
    if (state) render();
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
    $('btnCam').textContent = board3d.isAltView() ? '🎥 Vista de la mesa' : '🎥 Vista cenital';
  });
  $('btnCenter').addEventListener('click', () => board3d && board3d.resetView());

  // ── Espacio libre: el tablero se encuadra donde no hay barra, atril ni placas ──
  let lastSafe = null;
  function applySafe(rect) {
    lastSafe = rect;
    if (board3d) board3d.setSafeArea(rect);
    Hud.placeBoard2d($('boardFrame'), rect);
  }
  const safeArea = Hud.watchSafeArea({
    area: $('playArea'),
    top: $('hudTop'),
    bottom: $('hudBottom'),
    sides: () => [...$('hudPlaques').children],
    onChange: applySafe,
  });
  safeArea.observe($('hudPlaques'));

  function renderBoard() {
    const view = hostView();
    const extra = view.me >= 0 ? (!curtainUp(view) ? panel.boardExtra() : null) : presentationView();
    activeBoard().render(view, extra);
    if (view.me < 0 && has3d() && extra?.camera) board3d.setCameraView(extra.camera);
  }

  const turnKey = () => `${state.round}:${state.turn}`;
  const localHumans = () => state.players.filter(isLocalHuman).length;
  const curtainUp = (view) => view.me >= 0 && localHumans() > 1 && curtainOpenFor !== turnKey();

  /** Barra de arriba: de quién es el turno, tipo recomendado, ronda y bolsa. */
  function renderHudTop(view) {
    const round = view.rounds ? `Ronda ${view.round}/${view.rounds}` : `Ronda ${view.round}`;
    const meta = el('span', { class: 'hud-meta', text: `${round}${view.lastRound ? ' · ¡última!' : ''} · 🎒 ${view.bagCount}` });
    if (view.phase !== 'play') {
      $('hudTurn').replaceChildren(el('div', { class: 'hud-pill' }, [el('strong', { text: '🏁 La partida terminó' }), meta]));
      return;
    }
    const p = view.players[view.turn];
    const why = p.bot ? '🤖 pensando…' : isRemote(p.seat) ? '🖥 en su pantalla' : '';
    $('hudTurn').replaceChildren(
      el('div', { class: 'hud-pill', style: { '--pc': p.color } }, [
        BV.sprite(p.avatar, 'hud-avatar'),
        el('div', { class: 'hud-who' }, [el('small', { text: 'Turno de' }), el('strong', { text: p.name })]),
        BV.recommendedTypeChip(p.type, true),
        why ? el('span', { class: 'hud-why', text: why }) : null,
        meta,
      ]),
    );
  }

  /** Abajo: el atril (o la cortina) solo si el jugador en turno juega en esta pantalla. */
  function renderBottom(view) {
    const status = $('turnStatus');
    status.replaceChildren();
    if (view.phase !== 'play' || view.me < 0) {
      $('playPanel').hidden = true;
      $('hudBottom').hidden = true;
      return;
    }
    $('hudBottom').hidden = false;
    const p = view.players[view.turn];
    if (curtainUp(view)) {
      $('playPanel').hidden = true;
      status.replaceChildren(
        el('button', { class: 'curtain', style: { '--pc': p.color }, attrs: { type: 'button' }, on: { click: liftCurtain } }, [
          BV.sprite(p.avatar),
          el('strong', { text: `Turno de ${p.name}` }),
          el('span', { text: 'Los demás, no miren 🙈 · Toca para ver tus fichas' }),
        ]),
      );
      return;
    }
    $('playPanel').hidden = false;
    panel.update(view);
  }

  function liftCurtain() {
    curtainOpenFor = turnKey();
    render();
  }

  function renderLog(view) {
    $('gameLog').replaceChildren(...(view.log.length ? view.log.map((e) => BV.logLine(view, e)) : [el('li', { class: 'muted', text: 'Todavía no hay jugadas.' })]));
  }

  function maybeReveal(view) {
    if (!view.lastMove || view.lastMove.score == null || shownMove >= view.moveNo) return;
    const isNew = view.log[0] && view.log[0].kind === 'play' && view.log[0].n === view.moveNo;
    shownMove = view.moveNo;
    if (!isNew) return;
    // En 3D el Pokémon aparece flotando sobre el tablero, sin ventana.
    if (has3d()) return board3d.celebrate(view);
    window.GameAudio.play('capture');
    $('revealBody').replaceChildren(BV.revealCard(view));
    openOverlay('revealDialog');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => closeOverlay('revealDialog'), REVEAL_MS);
  }

  let endTimer = null;
  let shownEndFor = null; // al recargar una partida terminada, la ventana sale directo

  function renderEnd(view) {
    if (view.phase !== 'over') return closeOverlay('endDialog');
    const ranking = view.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    const winners = view.winners.map((i) => view.players[i].name);
    $('endTitle').textContent = winners.length > 1 ? `🏆 ¡Empate entre ${winners.join(' y ')}!` : `🏆 ¡Ganó ${winners[0]}!`;
    $('endReason').textContent = BV.END_REASON[view.endReason] || '';
    $('endRanking').replaceChildren(
      ...ranking.map(({ p }, pos) =>
        el('li', { class: 'end-row', style: { '--pc': p.color } }, [
          el('span', { class: 'end-pos', text: `${pos + 1}.` }),
          BV.sprite(p.avatar),
          el('strong', { text: p.name }),
          el('span', { class: 'end-dex' }, p.created.map((id) => BV.sprite(id, 'mini'))),
          el('b', { class: 'end-score', text: `${p.score} pts` }),
        ]),
      ),
    );
    if (!$('endDialog').hidden || endTimer) return;
    // En 3D primero se ven los fuegos artificiales y los ganadores saltando.
    endTimer = setTimeout(() => {
      endTimer = null;
      if (state && state.phase === 'over') openOverlay('endDialog');
    }, has3d() && view.moveNo !== shownEndFor ? END_DELAY_3D_MS : 0);
    shownEndFor = view.moveNo;
  }

  // Cambio de turno: la barra de arriba y la placa del jugador se animan
  // (después del festejo de la jugada). Nada aparece sobre el tablero.
  let animatedTurn = null;
  function maybeAnimateTurn(view) {
    const key = view.phase === 'play' ? turnKey() : null;
    if (key === animatedTurn) return;
    const first = animatedTurn == null;
    animatedTurn = key;
    if (!key || first) return;
    const justPlayed = view.log[0] && view.log[0].kind === 'play' && view.log[0].n === view.moveNo;
    const wait = justPlayed ? (has3d() ? CELEBRATE_3D_MS - 500 : REVEAL_MS) : 60;
    setTimeout(() => {
      if (animatedTurn !== key) return;
      window.GameAudio.play('turn');
      for (const node of document.querySelectorAll('#hudTurn .hud-pill, .cam-slot.turn, .corner-plate .plate.active')) {
        node.classList.remove('turn-in');
        void node.offsetWidth; // reinicia la animación
        node.classList.add('turn-in');
      }
    }, wait);
  }

  function render() {
    if (!state) return;
    const view = hostView();
    window.GameAudio.observe(view);
    Cams.render(view, isRemote);
    Cams.renderControls($('camControls'), view.players.length);
    renderHudTop(view);
    renderBottom(view);
    renderBoard();
    maybeAnimateTurn(view);
    safeArea.schedule();
    renderLog(view);
    maybeReveal(view);
    renderEnd(view);
    publishLocalView();
  }

  // ── Eventos ──
  $('setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('setupForm').reportValidity()) return;
    const players = Setup.players();
    if (typeof players === 'string') return toast(players);
    start(players);
  });
  const menu = Hud.bindMenu($('btnMenu'), $('menuDrawer'), $('btnMenuClose'));
  Hud.bindFullscreen($('btnFull'));
  Cams.onChange(() => render());
  $('btnRulesGame').addEventListener('click', () => {
    menu.close();
    openOverlay('rulesDialog');
  });
  $('btnRestart').addEventListener('click', () => {
    menu.close();
    if (state && state.phase === 'play' && !window.confirm('¿Empezar una partida nueva con los mismos jugadores?')) return;
    const players = Setup.players();
    if (typeof players === 'string') return toast(players);
    start(players);
  });
  $('btnSetup').addEventListener('click', () => {
    menu.close();
    if (state && state.phase === 'play' && !window.confirm('¿Salir de la partida? Se pierde el progreso.')) return;
    quit();
  });
  $('btnEndAgain').addEventListener('click', () => {
    const players = Setup.players();
    if (typeof players === 'string') return toast(players);
    start(players);
  });
  $('btnEndSetup').addEventListener('click', quit);
  $('revealDialog').addEventListener('click', () => closeOverlay('revealDialog'));
  $('btnRules').addEventListener('click', () => openOverlay('rulesDialog'));
  $('btnRulesClose').addEventListener('click', () => closeOverlay('rulesDialog'));
  document.addEventListener('keydown', (e) => {
    if (!state || $('screenGame').hidden) return;
    if (panel.onKey(e)) e.preventDefault();
  });

  // ── Inicio ──
  state = load();
  if (state) {
    if (G.upgradeTurn(state)) save();
    shownMove = state.moveNo;
    if (state.phase === 'over') shownEndFor = state.moveNo;
    showScreen('game');
    render();
    scheduleBot();
  } else {
    showScreen('setup');
  }

  window.HostGame = {
    act,
    inGame: () => !!state,
    isPlayerSeat: (seat) => !!state && playerIndex(seat) >= 0 && !state.players[playerIndex(seat)].bot,
    publicView,
    spectatorView: () => (state ? { ...G.spectatorView(state), liveKey } : null),
    presentationView,
    receivePreview,
    clearPreview,
    onPreviewUpdate: (fn) => previewListeners.push(fn),
    emitSound,
    onSound: (fn) => soundListeners.push(fn),
    setRemoteSeats(fn) {
      isRemote = fn;
      if (state) render();
    },
    onUpdate: (fn) => listeners.push(fn),
  };
})();
