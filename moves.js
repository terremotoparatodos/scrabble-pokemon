/*
 * Búsqueda de jugadas y la regla de oro: con las fichas de cada jugador
 * SIEMPRE se puede crear al menos un Pokémon nuevo en algún lugar del tablero.
 * El tipo recomendado sólo modifica el puntaje; nunca limita las opciones.
 *
 * - placements(): lugares del tablero donde entra cada Pokémon, sin mirar el
 *   atril (qué letras faltarían poner).
 * - findMoves(): de esos lugares, los que se pueden armar con el atril.
 * - ensurePlayable(): si no hay ninguno, cambia las fichas justas
 *   para que haya uno. Las fichas que salen vuelven
 *   a la bolsa.
 *
 * Por simpleza, las jugadas que se buscan acá no forman palabras cruzadas
 * (las fichas nuevas no tocan otras de costado). El validador sí acepta
 * cruces válidos que arme un jugador.
 */
(function (root) {
  'use strict';

  const R = root.ScrabbleRules;
  const { SIZE, CENTER, RACK_SIZE, idx, inBounds } = R;

  // Para cada palabra, en qué posiciones aparece cada letra.
  const LETTER_POS = new Map(
    R.WORDS.map((w) => {
      const pos = {};
      [...w].forEach((l, i) => (pos[l] = pos[l] || []).push(i));
      return [w, pos];
    }),
  );

  function wordsOfType(type, used) {
    const skip = new Set(used || []);
    return R.WORDS.filter((w) => !skip.has(w) && R.wordHasType(w, type));
  }

  /** Lugar para `word` empezando en (r, c) hacia `dir`, o null si no entra. */
  function fit(board, word, r, c, dir) {
    const dr = dir === 'V' ? 1 : 0;
    const dc = dir === 'H' ? 1 : 0;
    const er = r + dr * (word.length - 1);
    const ec = c + dc * (word.length - 1);
    if (!inBounds(r, c) || !inBounds(er, ec)) return null;
    if (inBounds(r - dr, c - dc) && board[idx(r - dr, c - dc)]) return null;
    if (inBounds(er + dr, ec + dc) && board[idx(er + dr, ec + dc)]) return null;
    const place = [];
    for (let k = 0; k < word.length; k++) {
      const rr = r + dr * k;
      const cc = c + dc * k;
      const cell = board[idx(rr, cc)];
      if (cell) {
        if (cell.l !== word[k]) return null;
        continue;
      }
      // Sin vecinos de costado: no se forman palabras cruzadas.
      for (const s of [-1, 1]) {
        const nr = rr + dc * s;
        const nc = cc + dr * s;
        if (inBounds(nr, nc) && board[idx(nr, nc)]) return null;
      }
      place.push({ r: rr, c: cc, l: word[k] });
    }
    if (place.length === 0 || place.length === word.length) return null;
    return { word, r, c, dir, place };
  }

  /** Todos los lugares del tablero donde entra alguna de `words`. */
  function placements(board, words) {
    const out = [];
    if (R.boardIsEmpty(board)) {
      for (const word of words) {
        // Primera jugada: horizontal sobre la Poké Ball del centro.
        const c = CENTER - Math.floor(word.length / 2);
        if (c >= 0 && c + word.length <= SIZE) {
          out.push({ word, r: CENTER, c, dir: 'H', place: [...word].map((l, k) => ({ r: CENTER, c: c + k, l })) });
        }
      }
      return out;
    }
    const occupied = [];
    board.forEach((cell, i) => cell && occupied.push({ r: Math.floor(i / SIZE), c: i % SIZE, l: cell.l }));
    const seen = new Set();
    for (const word of words) {
      const pos = LETTER_POS.get(word);
      for (const { r, c, l } of occupied) {
        for (const k of pos[l] || []) {
          for (const dir of ['H', 'V']) {
            const sr = dir === 'V' ? r - k : r;
            const sc = dir === 'H' ? c - k : c;
            const key = `${word}:${sr}:${sc}:${dir}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const p = fit(board, word, sr, sc, dir);
            if (p && p.place.length <= RACK_SIZE) out.push(p);
          }
        }
      }
    }
    return out;
  }

  /** Letras que faltan en el atril para cubrir `place`. */
  function missingLetters(rack, place) {
    const have = R.countLetters(rack);
    const missing = [];
    for (const { l } of place) {
      if (have[l]) have[l]--;
      else missing.push(l);
    }
    return missing;
  }

  function findMoves(board, rack, type, used) {
    return placements(board, wordsOfType(R.ANY_TYPE, used)).filter((p) => missingLetters(rack, p.place).length === 0);
  }

  function scoreOf(board, move, type, used) {
    const res = R.validatePlay({ board, placements: move.place, type, used });
    return res.ok ? res.score : -1;
  }

  /** La jugada de más puntos (la usan los bots y la pista). */
  function bestMove(board, rack, type, used) {
    let best = null;
    for (const m of findMoves(board, rack, type, used)) {
      const score = scoreOf(board, m, type, used);
      if (score >= 0 && (!best || score > best.score)) best = { ...m, score };
    }
    return best;
  }

  const pick = (list, rng) => list[Math.floor(rng() * list.length)];

  /** Saca una letra de la bolsa (si no queda, la crea: la regla de oro manda). */
  function takeFromBag(bag, letter) {
    const at = bag.indexOf(letter);
    if (at >= 0) bag.splice(at, 1);
    return letter;
  }

  /**
   * Garantiza que el atril pueda crear un Pokémon. Modifica `rack` y `bag`.
   * Devuelve { type, changed, typeChanged, move } (move: la jugada asegurada).
   */
  function ensurePlayable({ board, rack, bag, type, used, rng }) {
    const random = rng || Math.random;
    const ready = findMoves(board, rack, type, used);
    if (ready.length) return { type, changed: false, typeChanged: false, move: ready[0] };

    const options = placements(board, wordsOfType(R.ANY_TYPE, used));
    if (!options.length) return { type, changed: false, typeChanged: false, move: null };

    // Lo que menos fichas cambie; entre esos, uno al azar.
    const scored = options.map((p) => ({ p, missing: missingLetters(rack, p.place) }));
    const fewest = Math.min(...scored.map((x) => x.missing.length));
    const { p: move, missing } = pick(scored.filter((x) => x.missing.length === fewest), random);

    // Salen las fichas que esa jugada no usa, al azar, una por cada faltante.
    const needed = R.countLetters(move.place.map((x) => x.l));
    const spare = [];
    rack.forEach((l, i) => {
      if (needed[l]) needed[l]--;
      else spare.push(i);
    });
    const out = [];
    while (out.length < missing.length && spare.length) {
      out.push(spare.splice(Math.floor(random() * spare.length), 1)[0]);
    }
    out.sort((a, b) => b - a);
    for (const i of out) bag.push(rack.splice(i, 1)[0]);
    for (const l of missing) rack.push(takeFromBag(bag, l));
    return { type, changed: true, typeChanged: false, move };
  }

  root.ScrabbleMoves = { placements, findMoves, bestMove, ensurePlayable, missingLetters, wordsOfType };
})(typeof window !== 'undefined' ? window : globalThis);
