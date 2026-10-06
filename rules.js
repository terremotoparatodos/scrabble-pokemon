/*
 * Reglas puras de Pokémon Scrabble: diccionario (los 1025 Pokémon), fichas,
 * casillas especiales, validación de una jugada y puntaje.
 *
 * Sin DOM: lo usan la pantalla principal (que decide), el celular (para
 * mostrar la vista previa) y las pruebas en Node.
 *
 * Tablero: arreglo plano de SIZE × SIZE; cada casilla es null o
 * { l: letra, s: asiento que la puso, m: número de jugada }.
 */
(function (root) {
  'use strict';

  const SIZE = 15;
  const CENTER = 7;
  const RACK_SIZE = 10;
  const BIG_PLAY_TILES = 7;
  const BIG_PLAY_BONUS = 20;
  const ANY_TYPE = 'any';

  const TYPES = {
    normal: { es: 'Normal', color: '#9fa19f' },
    fire: { es: 'Fuego', color: '#e62829' },
    water: { es: 'Agua', color: '#2980ef' },
    grass: { es: 'Planta', color: '#3fa129' },
    electric: { es: 'Eléctrico', color: '#e0b000' },
    ice: { es: 'Hielo', color: '#3dcef3' },
    fighting: { es: 'Lucha', color: '#ff8000' },
    poison: { es: 'Veneno', color: '#9141cb' },
    ground: { es: 'Tierra', color: '#915121' },
    flying: { es: 'Volador', color: '#81b9ef' },
    psychic: { es: 'Psíquico', color: '#ef4179' },
    bug: { es: 'Bicho', color: '#91a119' },
    rock: { es: 'Roca', color: '#afa981' },
    ghost: { es: 'Fantasma', color: '#704170' },
    dragon: { es: 'Dragón', color: '#5060e1' },
    dark: { es: 'Siniestro', color: '#624d4e' },
    steel: { es: 'Acero', color: '#60a1b8' },
    fairy: { es: 'Hada', color: '#ef70ef' },
  };
  const TYPE_KEYS = Object.keys(TYPES);

  // Puntos según qué tan frecuente es la letra en los nombres de Pokémon.
  const LETTER_POINTS = {
    A: 1, E: 1, O: 1, R: 1, I: 1, L: 1, N: 1, T: 1, S: 1,
    U: 2, C: 2, M: 2, D: 2, G: 2, P: 2,
    H: 3, B: 3, K: 3,
    Y: 4, F: 4, W: 4,
    V: 5, Z: 5,
    X: 8,
    Q: 10, J: 10,
  };

  // Bolsa inicial (122 fichas), proporcional a la frecuencia de cada letra.
  const BAG_COUNTS = {
    A: 12, E: 10, O: 10, R: 9, I: 9, L: 8, N: 7, T: 6, S: 6,
    U: 5, C: 4, M: 4, D: 4, G: 4, P: 4,
    H: 3, B: 3, K: 3,
    Y: 2, F: 2, W: 2,
    V: 1, Z: 1, X: 1, Q: 1, J: 1,
  };

  /** «Flabébé» → «FLABEBE», «Mr. Mime» → «MRMIME», «Ho-Oh» → «HOOH». */
  function normalize(name) {
    return String(name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
  }

  // ── Diccionario ──
  const DEX = (root.POKEDEX || []).map((p, i) => ({ id: i + 1, name: p[0], word: normalize(p[0]), types: p.slice(1) }));
  const BY_WORD = new Map();
  for (const entry of DEX) {
    if (!BY_WORD.has(entry.word)) BY_WORD.set(entry.word, []);
    BY_WORD.get(entry.word).push(entry);
  }
  const WORDS = [...BY_WORD.keys()];

  const isPokemon = (word) => BY_WORD.has(word);
  const entriesFor = (word) => BY_WORD.get(word) || [];

  function wordHasType(word, type) {
    if (type === ANY_TYPE) return isPokemon(word);
    return entriesFor(word).some((e) => e.types.includes(type));
  }

  function typeName(type) {
    return type === ANY_TYPE ? 'Comodín' : TYPES[type] ? TYPES[type].es : type;
  }

  // ── Casillas especiales (disposición clásica, simétrica) ──
  const PREMIUM_QUADRANT = {
    TW: [[0, 0], [0, 7], [7, 0]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
    TL: [[1, 5], [5, 1], [5, 5]],
    DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]],
  };
  const PREMIUM = Array(SIZE * SIZE).fill(null);
  for (const [kind, list] of Object.entries(PREMIUM_QUADRANT)) {
    for (const [r, c] of list) {
      for (const [rr, cc] of [[r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, c], [SIZE - 1 - r, SIZE - 1 - c]]) {
        PREMIUM[rr * SIZE + cc] = kind;
      }
    }
  }

  const idx = (r, c) => r * SIZE + c;
  const inBounds = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  const emptyBoard = () => Array(SIZE * SIZE).fill(null);
  const boardIsEmpty = (board) => board.every((cell) => !cell);

  function newBag() {
    const bag = [];
    for (const [l, n] of Object.entries(BAG_COUNTS)) for (let i = 0; i < n; i++) bag.push(l);
    return bag;
  }

  function countLetters(letters) {
    const counts = {};
    for (const l of letters) counts[l] = (counts[l] || 0) + 1;
    return counts;
  }

  const rackPoints = (letters) => letters.reduce((sum, l) => sum + (LETTER_POINTS[l] || 0), 0);

  // ── Validación de una jugada ──
  const DIRS = { H: [0, 1], V: [1, 0] };
  const fail = (error) => ({ ok: false, error });

  /** Lee la palabra que pasa por (r, c) en la dirección dada, con las fichas nuevas. */
  function readWord(at, r, c, dir) {
    const [dr, dc] = DIRS[dir];
    let sr = r;
    let sc = c;
    while (inBounds(sr - dr, sc - dc) && at(sr - dr, sc - dc)) {
      sr -= dr;
      sc -= dc;
    }
    const cells = [];
    let rr = sr;
    let cc = sc;
    while (inBounds(rr, cc) && at(rr, cc)) {
      cells.push({ r: rr, c: cc, l: at(rr, cc) });
      rr += dr;
      cc += dc;
    }
    return { word: cells.map((x) => x.l).join(''), cells };
  }

  function scoreCells(cells, isNew) {
    let sum = 0;
    let mult = 1;
    for (const { r, c, l } of cells) {
      let pts = LETTER_POINTS[l] || 0;
      if (isNew(r, c)) {
        const p = PREMIUM[idx(r, c)];
        if (p === 'DL') pts *= 2;
        else if (p === 'TL') pts *= 3;
        else if (p === 'DW') mult *= 2;
        else if (p === 'TW') mult *= 3;
      }
      sum += pts;
    }
    return sum * mult;
  }

  /**
   * Valida fichas puestas este turno.
   * placements: [{ r, c, l }] · type: tipo recomendado (x2 si coincide, 'any' duplica todos).
   * Devuelve el puntaje base, el multiplicador de tipo y el puntaje final.
   */
  function validatePlay({ board, placements, type, used }) {
    if (!Array.isArray(placements) || placements.length === 0) return fail('Pon al menos una ficha en el tablero.');
    const fresh = new Map();
    for (const p of placements) {
      if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || !inBounds(p.r, p.c)) return fail('Ficha fuera del tablero.');
      if (!LETTER_POINTS[p.l]) return fail('Ficha inválida.');
      if (board[idx(p.r, p.c)]) return fail('Esa casilla ya está ocupada.');
      if (fresh.has(idx(p.r, p.c))) return fail('Dos fichas en la misma casilla.');
      fresh.set(idx(p.r, p.c), p.l);
    }
    const at = (r, c) => fresh.get(idx(r, c)) || (board[idx(r, c)] && board[idx(r, c)].l) || null;
    const isNew = (r, c) => fresh.has(idx(r, c));
    const first = boardIsEmpty(board);

    const sameRow = placements.every((p) => p.r === placements[0].r);
    const sameCol = placements.every((p) => p.c === placements[0].c);
    if (!sameRow && !sameCol) return fail('Las fichas tienen que ir en una sola fila o columna.');

    let dir;
    if (placements.length > 1) dir = sameRow ? 'H' : 'V';
    else {
      const { r, c } = placements[0];
      const horiz = (inBounds(r, c - 1) && at(r, c - 1)) || (inBounds(r, c + 1) && at(r, c + 1));
      dir = horiz ? 'H' : 'V';
    }

    const main = readWord(at, placements[0].r, placements[0].c, dir);
    if (placements.some((p) => !main.cells.some((x) => x.r === p.r && x.c === p.c))) {
      return fail('Las fichas tienen que formar una palabra seguida, sin huecos.');
    }
    if (main.word.length < 3) return fail('La palabra tiene que tener al menos 3 letras.');

    if (first) {
      if (!fresh.has(idx(CENTER, CENTER))) return fail('La primera palabra tiene que pasar por la Poké Ball del centro.');
    }

    const perp = dir === 'H' ? 'V' : 'H';
    const cross = [];
    for (const p of placements) {
      const w = readWord(at, p.r, p.c, perp);
      if (w.word.length >= 2) cross.push(w);
    }
    const touchesBoard = main.cells.some((x) => !isNew(x.r, x.c)) || cross.length > 0;
    if (!first && !touchesBoard) return fail('La palabra tiene que cruzarse o unirse con las fichas del tablero.');

    if (!isPokemon(main.word)) return fail(`«${main.word}» no es un Pokémon.`);
    if ((used || []).includes(main.word)) return fail(`${entriesFor(main.word)[0].name} ya se creó en esta partida.`);
    for (const w of cross) {
      if (!isPokemon(w.word)) return fail(`También se forma «${w.word}», que no es un Pokémon.`);
    }

    const words = [main, ...cross].map((w) => ({ word: w.word, cells: w.cells, score: scoreCells(w.cells, isNew) }));
    const bonus = placements.length >= BIG_PLAY_TILES ? BIG_PLAY_BONUS : 0;
    const baseScore = words.reduce((s, w) => s + w.score, 0) + bonus;
    const typeMultiplier = wordHasType(main.word, type) ? 2 : 1;
    const score = baseScore * typeMultiplier;
    return { ok: true, word: main.word, entries: entriesFor(main.word), dir, cells: main.cells, words, score, bonus, baseScore, typeMultiplier };
  }

  root.ScrabbleRules = {
    SIZE,
    CENTER,
    RACK_SIZE,
    BIG_PLAY_TILES,
    BIG_PLAY_BONUS,
    ANY_TYPE,
    TYPES,
    TYPE_KEYS,
    LETTER_POINTS,
    PREMIUM,
    DEX,
    WORDS,
    normalize,
    isPokemon,
    entriesFor,
    wordHasType,
    typeName,
    idx,
    inBounds,
    emptyBoard,
    boardIsEmpty,
    newBag,
    countLetters,
    rackPoints,
    validatePlay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
