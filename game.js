/*
 * Estado de una partida de Pokémon Scrabble (puro, sin DOM).
 *
 * La pantalla principal es la autoridad: guarda este estado, aplica las
 * acciones (de su propia pantalla, de los celulares o de los bots) y manda a
 * cada dispositivo publicView(state, asiento), que solo incluye su atril.
 *
 * Turno: jugar (cualquier Pokémon, x2 si coincide con el tipo recomendado), cambiar
 * fichas o pasar. Al empezar cada turno se aplica la regla de oro
 * (ScrabbleMoves.ensurePlayable).
 */
(function (root) {
  'use strict';

  const R = root.ScrabbleRules;
  const M = root.ScrabbleMoves;

  const ANY_TYPE_CHANCE = 0.1; // «Comodín»: x2 para cualquier tipo
  const HINT_COST = 5;
  const LOG_MAX = 40;
  const TURN_POLICY_VERSION = 4;

  // Las fichas de tipo salen según cuántos Pokémon hay de cada tipo.
  const TYPE_WEIGHTS = R.TYPE_KEYS.map((t) => [t, R.DEX.filter((e) => e.types.includes(t)).length]);
  const TYPE_TOTAL = TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);

  function drawType(rng) {
    if (rng() < ANY_TYPE_CHANCE) return R.ANY_TYPE;
    let n = rng() * TYPE_TOTAL;
    for (const [t, w] of TYPE_WEIGHTS) {
      n -= w;
      if (n < 0) return t;
    }
    return 'normal';
  }

  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function refill(rack, bag) {
    while (rack.length < R.RACK_SIZE && bag.length) rack.push(bag.pop());
  }

  /**
   * players: [{ name, color, avatar, bot }] (2 a 4, en el orden de los asientos).
   * seats: número de asiento de cada jugador (para la posición en la mesa).
   */
  function createGame({ players, rounds }, rng) {
    const random = rng || Math.random;
    const bag = shuffle(R.newBag(), random);
    const state = {
      phase: 'play',
      board: R.emptyBoard(),
      bag,
      players: players.map((p) => ({
        seat: p.seat,
        name: p.name,
        color: p.color,
        avatar: p.avatar,
        bot: !!p.bot,
        score: 0,
        rack: [],
        type: drawType(random),
        created: [],
        captures: [], // historial completo con los puntos de cada Pokémon
        singleSwapRound: null,
      })),
      turn: 0,
      round: 1,
      rounds: rounds || 0, // 0 = hasta vaciar la bolsa
      lastRound: false,
      moveNo: 0,
      used: [],
      passes: 0,
      lastMove: null,
      turnNote: null,
      hint: null,
      log: [],
    };
    for (const p of state.players) refill(p.rack, bag);
    startTurn(state, random);
    return state;
  }

  function addLog(state, entry) {
    state.log.unshift({ n: state.moveNo, ...entry });
    state.log.length = Math.min(state.log.length, LOG_MAX);
  }

  /** Regla de oro sobre el jugador en turno. */
  function startTurn(state, rng) {
    const p = state.players[state.turn];
    state.hint = null;
    const res = M.ensurePlayable({ board: state.board, rack: p.rack, bag: state.bag, type: p.type, used: state.used, rng });
    state.turnPolicyVersion = TURN_POLICY_VERSION;
    // El tablero debe permitir tres nombres distintos con un mismo atril.
    if (!res.move) return finish(state, res.reason);
    p.type = res.type;
    state.turnNote = res.changed
      ? 'La bolsa ajustó tus fichas: hay al menos 3 Pokémon distintos posibles y uno coincide con el tipo recomendado.'
      : res.typeChanged ? 'El tipo recomendado se ajustó para que puedas aprovechar el x2 con tus fichas.' : null;
  }

  /** Aplica la regla nueva a partidas guardadas, conservando una pista ya pagada. */
  function upgradeTurn(state, rng) {
    if (state.phase !== 'play' || state.turnPolicyVersion === TURN_POLICY_VERSION) return false;
    // Las partidas anteriores aún no tenían los dos comodines en su bolsa.
    if (!state.turnPolicyVersion || state.turnPolicyVersion < 3) {
      const blanks = state.bag.filter((l) => l === R.BLANK).length
        + state.players.reduce((n, p) => n + p.rack.filter((l) => l === R.BLANK).length, 0)
        + state.board.filter((cell) => cell?.blank).length;
      for (let n = blanks; n < 2; n++) state.bag.push(R.BLANK);
      shuffle(state.bag, rng || Math.random);
    }
    const hadHint = !!state.hint;
    // Las partidas guardadas pasan de diez a doce fichas sin perder progreso.
    for (const p of state.players) refill(p.rack, state.bag);
    startTurn(state, rng);
    if (hadHint && state.phase === 'play') {
      const p = state.players[state.turn];
      const move = M.bestMove(state.board, p.rack, p.type, state.used);
      state.hint = { player: state.turn, id: R.entriesFor(move.word)[0].id, word: move.word, r: move.r, c: move.c, dir: move.dir };
    }
    return true;
  }

  function refreshHint(state) {
    if (!state.hint) return;
    const p = state.players[state.turn];
    const move = M.bestMove(state.board, p.rack, p.type, state.used);
    state.hint = { player: state.turn, id: R.entriesFor(move.word)[0].id, word: move.word, r: move.r, c: move.c, dir: move.dir };
  }

  function nextTurn(state, rng) {
    if (!state.bag.length) state.lastRound = true;
    state.turn = (state.turn + 1) % state.players.length;
    if (state.turn === 0) {
      const roundsDone = state.rounds && state.round >= state.rounds;
      if (roundsDone) return finish(state, 'rounds');
      if (state.lastRound) return finish(state, 'bag');
      state.round++;
    }
    if (state.passes >= state.players.length * 2) return finish(state, 'passes');
    startTurn(state, rng);
  }

  /** reason: 'rounds' | 'bag' | 'passes' | 'board' | 'options'. */
  function finish(state, reason) {
    state.phase = 'over';
    state.endReason = reason;
    state.hint = null;
    state.turnNote = null;
    const top = Math.max(...state.players.map((p) => p.score));
    state.winners = state.players.map((p, i) => (p.score === top ? i : -1)).filter((i) => i >= 0);
  }

  function checkTurn(state, player) {
    if (state.phase !== 'play') return 'La partida terminó.';
    if (player !== state.turn) return 'No es tu turno.';
    return null;
  }

  function captureHistory(state, p, player) {
    return p.captures || p.created.map((id) => {
      const entry = state.log.find((e) => e.kind === 'play' && e.player === player && e.id === id);
      return { id, score: entry ? entry.score : null, n: entry ? entry.n : null };
    });
  }

  /** tiles: [{ r, c, i }] con i = posición en el atril. */
  function play(state, player, tiles, rng) {
    const wrong = checkTurn(state, player);
    if (wrong) return { ok: false, error: wrong };
    const p = state.players[player];
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > p.rack.length) return { ok: false, error: 'Jugada inválida.' };
    const usedIdx = new Set();
    for (const t of tiles) {
      if (!t || !Number.isInteger(t.i) || t.i < 0 || t.i >= p.rack.length || usedIdx.has(t.i)) return { ok: false, error: 'Jugada inválida.' };
      usedIdx.add(t.i);
    }
    for (const t of tiles) {
      if (p.rack[t.i] === R.BLANK && (typeof t.l !== 'string' || !/^[A-Z]$/.test(t.l))) {
        return { ok: false, error: 'Elige una letra de la A a la Z para el comodín.' };
      }
      if (p.rack[t.i] !== R.BLANK && t.l != null && t.l !== p.rack[t.i]) {
        return { ok: false, error: 'Solo un comodín puede cambiar de letra.' };
      }
    }
    const placements = tiles.map((t) => ({ r: t.r, c: t.c, l: p.rack[t.i] === R.BLANK ? t.l : p.rack[t.i], blank: p.rack[t.i] === R.BLANK }));
    const res = R.validatePlay({ board: state.board, placements, type: p.type, used: state.used });
    if (!res.ok) return res;

    state.moveNo++;
    for (const x of placements) state.board[R.idx(x.r, x.c)] = { l: x.l, s: p.seat, m: state.moveNo, ...(x.blank ? { blank: true } : {}) };
    p.rack = p.rack.filter((_, i) => !usedIdx.has(i));
    p.score += res.score;
    const entry = res.entries.find((e) => p.type === R.ANY_TYPE || e.types.includes(p.type)) || res.entries[0];
    p.captures = captureHistory(state, p, player);
    p.created.push(entry.id);
    p.captures.push({ id: entry.id, score: res.score, n: state.moveNo });
    state.used.push(res.word);
    state.passes = 0;
    state.lastMove = { seat: p.seat, player, id: entry.id, word: res.word, score: res.score, bonus: res.bonus, baseScore: res.baseScore, typeMultiplier: res.typeMultiplier, cells: res.cells.map(({ r, c }) => ({ r, c })), placed: placements.map(({ r, c }) => ({ r, c })), type: p.type };
    addLog(state, { kind: 'play', player, id: entry.id, score: res.score, type: p.type, typeMultiplier: res.typeMultiplier });
    p.type = drawType(rng);
    refill(p.rack, state.bag);
    nextTurn(state, rng);
    return { ok: true, move: state.lastMove };
  }

  /** Devuelve fichas (índices del atril) y/o la ficha de tipo; pierde el turno. */
  function exchange(state, player, indices, swapType, rng) {
    const wrong = checkTurn(state, player);
    if (wrong) return { ok: false, error: wrong };
    const p = state.players[player];
    const list = [...new Set(Array.isArray(indices) ? indices : [])].filter((i) => Number.isInteger(i) && i >= 0 && i < p.rack.length);
    if (!list.length && !swapType) return { ok: false, error: 'Elige qué fichas cambiar.' };
    if (list.length > state.bag.length) return { ok: false, error: `Solo quedan ${state.bag.length} fichas en la bolsa.` };
    const out = list.sort((a, b) => b - a).map((i) => p.rack.splice(i, 1)[0]);
    refill(p.rack, state.bag);
    state.bag.push(...out);
    shuffle(state.bag, rng);
    if (swapType) p.type = drawType(rng);
    state.moveNo++;
    state.passes = 0;
    addLog(state, { kind: 'exchange', player, count: out.length, swapType: !!swapType });
    nextTurn(state, rng);
    return { ok: true };
  }

  /** Un cambio de una sola ficha por ronda, sin consumir el turno. */
  function swapOne(state, player, indices, rng) {
    const wrong = checkTurn(state, player);
    if (wrong) return { ok: false, error: wrong };
    const p = state.players[player];
    if (p.singleSwapRound === state.round) return { ok: false, error: 'Ya cambiaste una ficha en esta ronda.' };
    if (!Array.isArray(indices) || indices.length !== 1 || !Number.isInteger(indices[0]) || indices[0] < 0 || indices[0] >= p.rack.length) {
      return { ok: false, error: 'Elige exactamente una ficha para cambiar.' };
    }
    if (!state.bag.length) return { ok: false, error: 'No quedan fichas en la bolsa.' };
    const i = indices[0];
    const before = p.rack[i];
    // El cambio conserva las tres alternativas sin tocar las demás fichas.
    const eligible = new Set();
    for (const l of new Set(state.bag)) {
      if (l === before) continue;
      const rack = p.rack.slice();
      rack[i] = l;
      if (new Set(M.findMoves(state.board, rack, p.type, state.used).map((m) => m.word)).size >= R.MIN_OPTIONS) eligible.add(l);
    }
    const choices = state.bag.map((l, at) => ({l, at})).filter((x) => eligible.has(x.l));
    if (!choices.length) return { ok: false, error: 'No hay otra ficha en la bolsa que conserve tus tres opciones.' };
    const choice = choices[Math.floor(rng() * choices.length)];
    p.rack[i] = state.bag.splice(choice.at, 1)[0];
    state.bag.push(before);
    p.singleSwapRound = state.round;
    const res = M.ensurePlayable({board:state.board, rack:p.rack, bag:state.bag, type:p.type, used:state.used, rng});
    p.type = res.type;
    state.turnNote = 'Cambiaste 1 ficha sin perder el turno. El próximo cambio gratis se habilita en la siguiente ronda.';
    refreshHint(state);
    state.moveNo++;
    addLog(state, {kind:'swap-one', player, count:1});
    return {ok:true};
  }

  function pass(state, player, rng) {
    const wrong = checkTurn(state, player);
    if (wrong) return { ok: false, error: wrong };
    state.moveNo++;
    state.passes++;
    addLog(state, { kind: 'pass', player });
    nextTurn(state, rng);
    return { ok: true };
  }

  /** Revela el Pokémon que asegura la regla de oro (cuesta puntos, una vez por turno). */
  function hint(state, player) {
    const wrong = checkTurn(state, player);
    if (wrong) return { ok: false, error: wrong };
    if (state.hint) return { ok: true, hint: state.hint };
    const p = state.players[player];
    const move = M.bestMove(state.board, p.rack, p.type, state.used);
    if (!move) return { ok: false, error: 'No se encontró una pista.' };
    p.score -= HINT_COST;
    state.hint = { player, id: R.entriesFor(move.word)[0].id, word: move.word, r: move.r, c: move.c, dir: move.dir };
    addLog(state, { kind: 'hint', player });
    return { ok: true, hint: state.hint };
  }

  function act(state, player, action, rng) {
    switch (action && action.type) {
      case 'play':
        return play(state, player, action.tiles, rng);
      case 'exchange':
        return exchange(state, player, action.indices, action.swapType, rng);
      case 'swap-one':
        return swapOne(state, player, action.indices, rng || Math.random);
      case 'pass':
        return pass(state, player, rng);
      case 'hint':
        return hint(state, player);
      default:
        return { ok: false, error: 'Acción desconocida.' };
    }
  }

  /** Lo que puede ver el asiento `seat` (null: solo lo público). */
  function publicView(state, seat) {
    const me = state.players.findIndex((p) => p.seat === seat);
    return {
      phase: state.phase,
      board: state.board,
      bagCount: state.bag.length,
      turn: state.turn,
      round: state.round,
      rounds: state.rounds,
      lastRound: state.lastRound,
      moveNo: state.moveNo,
      used: state.used,
      lastMove: state.lastMove,
      log: state.log,
      winners: state.winners || null,
      endReason: state.endReason || null,
      me,
      players: state.players.map((p, i) => ({
        seat: p.seat,
        name: p.name,
        color: p.color,
        avatar: p.avatar,
        bot: p.bot,
        score: p.score,
        type: p.type,
        created: p.created,
        // Las partidas anteriores a este historial se recuperan del registro.
        captures: captureHistory(state, p, i),
        rackCount: p.rack.length,
        rack: i === me ? p.rack : null,
        singleSwapAvailable: p.singleSwapRound !== state.round && state.bag.length > 0,
      })),
      turnNote: me === state.turn ? state.turnNote : null,
      hint: state.hint && state.hint.player === me ? state.hint : null,
    };
  }

  /** Vista de emisión: no ocupa un asiento y muestra todos los atriles. */
  function spectatorView(state) {
    const view = publicView(state, null);
    view.spectator = true;
    view.players.forEach((p, i) => { p.rack = state.players[i].rack.slice(); });
    return view;
  }

  root.ScrabbleGame = { createGame, act, publicView, spectatorView, upgradeTurn, HINT_COST };
})(typeof window !== 'undefined' ? window : globalThis);
