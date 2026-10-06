/*
 * Búsqueda de jugadas y la regla de oro: con las fichas de cada jugador
 * hay al menos tres Pokémon distintos que pueden crearse en el tablero.
 * El tipo recomendado sólo modifica el puntaje; nunca limita las opciones.
 *
 * - placements(): lugares del tablero donde entra cada Pokémon, sin mirar el
 *   atril (qué letras faltarían poner).
 * - findMoves(): de esos lugares, los que se pueden armar con el atril.
 * - ensurePlayable(): ajusta las fichas necesarias para tener tres alternativas
 *   y recomienda un tipo que coincide con alguna. Las fichas que salen vuelven
 *   a la bolsa. Si el tablero ya no permite tres alternativas, la partida termina.
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
        if (word.length <= RACK_SIZE && c >= 0 && c + word.length <= SIZE) {
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
    let blanks = have[R.BLANK] || 0;
    const missing = [];
    for (const { l } of place) {
      if (have[l]) have[l]--;
      else if (blanks) blanks--;
      else missing.push(l);
    }
    return missing;
  }

  function findMoves(board, rack, type, used) {
    return placements(board, wordsOfType(R.ANY_TYPE, used))
      .filter((p) => missingLetters(rack, p.place).length === 0)
      .map((p) => {
        const tiles = R.assignRack(rack, p.place);
        return { ...p, place: p.place.map((x, k) => ({ ...x, blank: rack[tiles[k].i] === R.BLANK })) };
      });
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

  function recommendType(moves, type, rng) {
    if (moves.some((m) => R.wordHasType(m.word, type))) return type;
    const types = [...new Set(moves.flatMap((m) => R.entriesFor(m.word).flatMap((e) => e.types)))];
    return pick(types, rng);
  }

  /** Tres nombres distintos, cada uno jugable por separado con el mismo atril. */
  function ensurePlayable({ board, rack, bag, type, used, rng }) {
    const random = rng || Math.random;
    const options = placements(board, wordsOfType(R.ANY_TYPE, used));
    const ready = options.filter((p) => missingLetters(rack, p.place).length === 0);
    if (new Set(ready.map((m) => m.word)).size >= R.MIN_OPTIONS) {
      const recommended = recommendType(ready, type, random);
      return { type: recommended, changed: false, typeChanged: recommended !== type, move: ready[0] };
    }

    // Mismo nombre + mismas letras necesarias es una sola alternativa de búsqueda.
    const seen = new Set();
    const candidates = [];
    for (const move of options) {
      const letters = move.place.map((x) => x.l).sort();
      const key = `${move.word}:${letters.join('')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ move, needed: R.countLetters(letters), missing: missingLetters(rack, move.place).length });
    }
    candidates.sort((a, b) => a.missing - b.missing || a.move.place.length - b.move.place.length);
    const have = R.countLetters(rack);
    let best = null;
    let ties = 0;
    function search(start, chosen, required) {
      for (let j = start; j < candidates.length; j++) {
        const candidate = candidates[j];
        if (best && candidate.missing > best.missing.length) break;
        if (chosen.some((m) => m.word === candidate.move.word)) continue;
        // Son alternativas: las letras compartidas sirven para todas.
        const needed = { ...required };
        for (const [l, n] of Object.entries(candidate.needed)) needed[l] = Math.max(needed[l] || 0, n);
        if (Object.values(needed).reduce((sum, n) => sum + n, 0) > RACK_SIZE) continue;
        let blanks = have[R.BLANK] || 0;
        const missing = [];
        for (const [l, n] of Object.entries(needed)) {
          let deficit = Math.max(0, n - (have[l] || 0));
          const covered = Math.min(blanks, deficit);
          blanks -= covered;
          deficit -= covered;
          for (let k = 0; k < deficit; k++) missing.push(l);
        }
        if (best && missing.length > best.missing.length) continue;
        const moves = [...chosen, candidate.move];
        if (moves.length < R.MIN_OPTIONS) {
          search(j + 1, moves, needed);
          continue;
        }
        const keepsType = moves.some((m) => R.wordHasType(m.word, type));
        if (!best || missing.length < best.missing.length ||
            (missing.length === best.missing.length && keepsType && !best.keepsType)) {
          best = { moves, needed, missing, keepsType };
          ties = 1;
        } else if (missing.length === best.missing.length && keepsType === best.keepsType && random() < 1 / ++ties) {
          best = { moves, needed, missing, keepsType };
        }
      }
    }
    search(0, [], {});
    if (!best) return { type, changed: false, typeChanged: false, move: null, reason: options.length ? 'options' : 'board' };

    // Conserva las letras de las tres alternativas; devuelve sólo las sobrantes.
    const { missing } = best;
    const needed = { ...best.needed };
    const blankNeeded = Object.entries(needed).reduce((sum, [l, n]) => sum + Math.max(0, n - (have[l] || 0)), 0);
    needed[R.BLANK] = Math.min(have[R.BLANK] || 0, blankNeeded);
    const spare = [];
    rack.forEach((l, i) => {
      if (needed[l]) needed[l]--;
      else spare.push(i);
    });
    const out = [];
    const removeCount = Math.max(0, rack.length + missing.length - RACK_SIZE);
    while (out.length < removeCount && spare.length) {
      out.push(spare.splice(Math.floor(random() * spare.length), 1)[0]);
    }
    out.sort((a, b) => b - a);
    for (const i of out) bag.push(rack.splice(i, 1)[0]);
    for (const l of missing) rack.push(takeFromBag(bag, l));
    const playable = options.filter((p) => missingLetters(rack, p.place).length === 0);
    const recommended = recommendType(playable, type, random);
    return { type: recommended, changed: missing.length > 0, typeChanged: recommended !== type, move: best.moves[0] };
  }

  root.ScrabbleMoves = { placements, findMoves, bestMove, ensurePlayable, missingLetters, wordsOfType };
})(typeof window !== 'undefined' ? window : globalThis);
