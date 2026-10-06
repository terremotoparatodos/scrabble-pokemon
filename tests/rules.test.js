/*
 * Pruebas de reglas y de la regla de oro. Correr con:
 *   node games/scrabble-pokemon/tests/rules.test.js
 */
/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- prueba de Node (CommonJS) */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

for (const f of ['pokedex.js', 'rules.js', 'moves.js', 'game.js']) require(path.join(__dirname, '..', f));
const R = globalThis.ScrabbleRules;
const M = globalThis.ScrabbleMoves;
const G = globalThis.ScrabbleGame;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

/** Generador pseudoaleatorio con semilla (partidas reproducibles). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function put(board, word, r, c, dir) {
  [...word].forEach((l, k) => {
    board[R.idx(r + (dir === 'V' ? k : 0), c + (dir === 'H' ? k : 0))] = { l, s: 0, m: 1 };
  });
}

test('diccionario con los 1025 Pokémon y nombres normalizados', () => {
  assert.equal(R.DEX.length, 1025);
  assert.ok(R.isPokemon('PIKACHU'));
  assert.ok(R.isPokemon('MRMIME'));
  assert.ok(R.isPokemon('FLABEBE'));
  assert.ok(R.isPokemon('HOOH'));
  assert.ok(R.wordHasType('CHARIZARD', 'flying'));
  assert.ok(!R.wordHasType('CHARIZARD', 'water'));
  assert.ok(R.wordHasType('NIDORAN', 'poison'));
});

test('primera jugada: tiene que pasar por el centro', () => {
  const board = R.emptyBoard();
  const word = (r, c) => [...'PIKACHU'].map((l, k) => ({ r, c: c + k, l }));
  assert.equal(R.validatePlay({ board, placements: word(0, 0), type: 'electric', used: [] }).ok, false);
  const ok = R.validatePlay({ board, placements: word(7, 4), type: 'electric', used: [] });
  assert.equal(ok.ok, true);
  assert.equal(ok.word, 'PIKACHU');
  assert.ok(ok.score > 0);
});

test('tipo recomendado: cualquier Pokémon vale, coincidencia x2 y comodín x2', () => {
  const board = R.emptyBoard();
  const placements = [...'PIKACHU'].map((l, k) => ({ r: 7, c: 4 + k, l }));
  const res = R.validatePlay({ board, placements, type: 'fire', used: [] });
  assert.equal(res.ok, true);
  assert.equal(res.typeMultiplier, 1);
  assert.equal(res.score, res.baseScore);
  const matching = R.validatePlay({ board, placements, type: 'electric', used: [] });
  assert.equal(matching.typeMultiplier, 2);
  assert.equal(matching.score, res.score * 2);
  assert.equal(matching.baseScore, res.score);
  assert.equal(matching.bonus, 20);
  const wildcard = R.validatePlay({ board, placements, type: R.ANY_TYPE, used: [] });
  assert.equal(wildcard.score, matching.score);
  const charizard = [...'CHARIZARD'].map((l, k) => ({ r: 7, c: 3 + k, l }));
  const fire = R.validatePlay({ board, placements: charizard, type: 'fire', used: [] });
  const flying = R.validatePlay({ board, placements: charizard, type: 'flying', used: [] });
  assert.equal(fire.score, fire.baseScore * 2);
  assert.equal(flying.score, fire.score);
});

test('búsqueda, pista y regla de oro permiten Pokémon fuera del tipo recomendado', () => {
  const board = R.emptyBoard();
  const rack = 'MEWXXXXXXX'.split('');
  const bag = R.newBag();
  const before = rack.slice();
  const moves = M.findMoves(board, rack, 'fire', []);
  assert.ok(moves.some((m) => m.word === 'MEW'));
  const result = M.ensurePlayable({ board, rack, bag, type: 'fire', used: [], rng: seeded(1) });
  assert.equal(result.changed, false);
  assert.equal(result.type, 'fire');
  assert.deepEqual(rack, before);
  const best = M.bestMove(board, rack, 'fire', []);
  assert.equal(best.word, 'MEW');
  const state = G.createGame({ players: [0, 1].map((seat) => ({seat, name: `J${seat}`, color:'#000', avatar:25})), rounds:10 }, seeded(4));
  state.players[0].rack = rack;
  state.players[0].type = 'fire';
  assert.equal(G.act(state, 0, {type:'hint'}, seeded(5)).hint.word, 'MEW');
  const tiles = best.place.map(({r,c,l}) => ({r,c,i:rack.indexOf(l)}));
  const play = G.act(state, 0, {type:'play',tiles}, seeded(6));
  assert.equal(play.ok, true);
  assert.equal(play.move.typeMultiplier, 1);
  assert.equal(state.players[0].score, play.move.baseScore - G.HINT_COST);
});

test('cruce con el tablero, sin repetir Pokémon', () => {
  const board = R.emptyBoard();
  put(board, 'PIKACHU', 7, 4, 'H');
  // RAICHU en vertical usando la A de PIKACHU (7,7).
  const placements = [...'RAICHU'].map((l, k) => ({ r: 6 + k, c: 7, l })).filter((p) => p.r !== 7);
  const res = R.validatePlay({ board, placements, type: 'electric', used: ['PIKACHU'] });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.word, 'RAICHU');
  const again = R.validatePlay({ board, placements, type: 'electric', used: ['PIKACHU', 'RAICHU'] });
  assert.equal(again.ok, false);
});

test('rechaza palabras sueltas, con huecos o que no son Pokémon', () => {
  const board = R.emptyBoard();
  put(board, 'PIKACHU', 7, 4, 'H');
  const loose = [...'MEW'].map((l, k) => ({ r: 0, c: k, l }));
  assert.equal(R.validatePlay({ board, placements: loose, type: 'psychic', used: [] }).ok, false);
  const gap = [{ r: 5, c: 7, l: 'M' }, { r: 8, c: 7, l: 'X' }];
  assert.equal(R.validatePlay({ board, placements: gap, type: R.ANY_TYPE, used: [] }).ok, false);
  const fake = [{ r: 6, c: 7, l: 'B' }, { r: 8, c: 7, l: 'C' }];
  assert.equal(R.validatePlay({ board, placements: fake, type: R.ANY_TYPE, used: [] }).ok, false);
});

test('regla de oro: un atril imposible se ajusta hasta tener jugada', () => {
  const rng = seeded(7);
  const board = R.emptyBoard();
  put(board, 'PIKACHU', 7, 4, 'H');
  const rack = 'QQQQQQQQQQ'.split('');
  const bag = R.newBag();
  const res = M.ensurePlayable({ board, rack, bag, type: 'fire', used: ['PIKACHU'], rng });
  assert.equal(res.changed, true);
  assert.equal(rack.length, R.RACK_SIZE);
  assert.ok(M.findMoves(board, rack, res.type, ['PIKACHU']).length > 0);
});

test('partidas completas con bots: siempre hay un Pokémon posible y todo cierra', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    const n = 2 + (seed % 3);
    const players = Array.from({ length: n }, (_, i) => ({ seat: i, name: `Bot ${i}`, color: '#000', avatar: 25, bot: true }));
    const state = G.createGame({ players, rounds: 0 }, rng);
    let guard = 0;
    while (state.phase === 'play' && guard++ < 400) {
      const p = state.players[state.turn];
      const moves = M.findMoves(state.board, p.rack, p.type, state.used);
      assert.ok(moves.length > 0, `semilla ${seed}: sin jugada posible para ${p.name}`);
      const best = M.bestMove(state.board, p.rack, p.type, state.used);
      const free = p.rack.map((l, i) => ({ l, i }));
      const tiles = best.place.map(({ r, c, l }) => {
        const at = free.findIndex((x) => x.l === l);
        return { r, c, i: free.splice(at, 1)[0].i };
      });
      const res = G.act(state, state.turn, { type: 'play', tiles }, rng);
      assert.equal(res.ok, true, `semilla ${seed}: ${res.error}`);
    }
    assert.equal(state.phase, 'over', `semilla ${seed}: la partida no terminó`);
    assert.equal(new Set(state.used).size, state.used.length, 'Pokémon repetido');
    const view = G.publicView(state, 0);
    assert.ok(view.players.every((p, i) => (i === view.me ? Array.isArray(p.rack) : p.rack === null)), 'se filtra un atril ajeno');
  }
});

test('turno ajeno, cambio y pase', () => {
  const rng = seeded(3);
  const players = [0, 1].map((seat) => ({ seat, name: `J${seat}`, color: '#000', avatar: 1 }));
  const state = G.createGame({ players, rounds: 3 }, rng);
  assert.equal(G.act(state, 1, { type: 'pass' }, rng).ok, false);
  const before = state.players[0].rack.slice();
  assert.equal(G.act(state, 0, { type: 'exchange', indices: [0, 1, 2], swapType: true }, rng).ok, true);
  assert.equal(state.players[0].rack.length, R.RACK_SIZE);
  assert.notDeepEqual(state.players[0].rack, before);
  assert.equal(G.act(state, 1, { type: 'pass' }, rng).ok, true);
  assert.equal(state.turn, 0);
  assert.equal(state.round, 2);
});

test('capturas: puntajes por Pokémon, persistencia y partidas anteriores', () => {
  const rng = seeded(8);
  const players = [0, 1].map((seat) => ({ seat, name: `J${seat}`, color: '#000', avatar: seat ? 25 : 197 }));
  const state = G.createGame({ players, rounds: 10 }, rng);
  function playBest() {
    const player = state.turn;
    const p = state.players[player];
    const best = M.bestMove(state.board, p.rack, p.type, state.used);
    const free = p.rack.map((l, i) => ({ l, i }));
    const tiles = best.place.map(({ r, c, l }) => ({ r, c, i: free.splice(free.findIndex((x) => x.l === l), 1)[0].i }));
    const res = G.act(state, player, { type: 'play', tiles }, rng);
    assert.equal(res.ok, true);
    return { id: res.move.id, score: res.move.score, n: state.moveNo };
  }
  assert.equal(G.act(state, 0, { type: 'hint' }, rng).ok, true);
  const first = playBest();
  assert.deepEqual(G.publicView(state, null).players[0].captures, [first]);
  assert.equal(state.players[0].score, first.score - G.HINT_COST);
  const saved = JSON.parse(JSON.stringify(state));
  saved.log = []; // El historial de tarjetas no depende del registro limitado.
  assert.deepEqual(G.publicView(saved, null).players[0].captures, [first]);
  delete state.players[0].captures; // Migración de una partida previa a las tarjetas.
  assert.deepEqual(G.publicView(state, null).players[0].captures, [first]);
  playBest();
  if (state.phase === 'play') {
    const second = playBest();
    assert.deepEqual(G.publicView(state, null).players[0].captures, [first, second]);
  }
});

test('la duración elegida termina al completar la ronda', () => {
  const rng = seeded(3);
  const players = [0, 1].map((seat) => ({ seat, name: `J${seat}`, color: '#000', avatar: 197 }));
  const state = G.createGame({ players, rounds: 1 }, rng);
  G.act(state, 0, { type: 'pass' }, rng);
  assert.equal(state.phase, 'play');
  G.act(state, 1, { type: 'pass' }, rng);
  assert.equal(state.phase, 'over');
  assert.equal(state.endReason, 'rounds');
});

console.log(`✓ ${passed} pruebas`);
