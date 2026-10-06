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

test('OBS ve todos los atriles sin alterar la privacidad de los jugadores', () => {
  const players = [0, 1].map((seat) => ({ seat, name: `Jugador ${seat}`, color: '#e3350d', avatar: 25 }));
  const state = G.createGame({ players, rounds: 10 }, seeded(42));
  const obs = G.spectatorView(state);
  assert.equal(obs.me, -1);
  assert.equal(obs.spectator, true);
  assert.equal(obs.hint, null);
  assert.equal(obs.turnNote, null);
  assert.equal(obs.bag, undefined);
  state.players.forEach((p, i) => assert.deepEqual(obs.players[i].rack, p.rack));
  const original = state.players[0].rack[0];
  obs.players[0].rack[0] = 'Z';
  assert.equal(state.players[0].rack[0], original);
  assert.equal(G.publicView(state, 0).players[1].rack, null);
  assert.ok(G.publicView(state, 0).players[0].rack);
  assert.ok(G.publicView(state, null).players.every((p) => p.rack === null));
});

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

test('búsqueda, pista y jugada permiten Pokémon fuera del tipo recomendado', () => {
  const board = R.emptyBoard();
  const rack = 'MEWXXXXXXX'.split('');
  const moves = M.findMoves(board, rack, 'fire', []);
  assert.ok(moves.some((m) => m.word === 'MEW'));
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

function assertOptions(board, rack, type, used) {
  const moves = M.findMoves(board, rack, type, used);
  assert.ok(new Set(moves.map((m) => m.word)).size >= R.MIN_OPTIONS, 'debe haber tres nombres distintos');
  assert.ok(moves.some((m) => R.wordHasType(m.word, type)), 'el x2 debe tener una opción disponible');
  for (const m of moves) {
    assert.equal(R.validatePlay({ board, placements: m.place, type, used }).ok, true, m.word);
  }
  return moves;
}

test('regresión: la mano SLEIECRNLE con Fantasma pasa a tres opciones y x2 posible', () => {
  const board = R.emptyBoard();
  const rack = 'SLEIECRNLE'.split('');
  assert.deepEqual(M.findMoves(board, rack, 'ghost', []).map((m) => m.word), ['SEEL']);
  const result = M.ensurePlayable({ board, rack, bag: R.newBag(), type: 'ghost', used: [], rng: seeded(1) });
  assert.equal(result.changed, true);
  assert.equal(rack.length, R.RACK_SIZE);
  assertOptions(board, rack, result.type, []);
  // Dos letras adicionales alcanzan: se conservan las diez fichas originales.
  const missing = M.missingLetters('SLEIECRNLE'.split(''), rack.map((l) => ({l})));
  assert.equal(missing.length, 2);
});

test('tres opciones existentes conservan el atril; sólo se corrige el tipo imposible', () => {
  for (const type of ['ghost', 'psychic', 'electric', R.ANY_TYPE]) {
    const board = R.emptyBoard();
    const rack = 'PIKACHUMEW'.split('');
    const before = rack.slice();
    const bag = R.newBag();
    const bagBefore = bag.slice();
    const result = M.ensurePlayable({ board, rack, bag, type, used: [], rng: seeded(2) });
    assert.equal(result.changed, false);
    assert.deepEqual(rack, before);
    assert.deepEqual(bag, bagBefore);
    assert.equal(result.typeChanged, type === 'ghost');
    if (type !== 'ghost') assert.equal(result.type, type);
    assertOptions(board, rack, result.type, []);
  }
});

test('regla de oro: un atril imposible se ajusta hasta tener tres Pokémon distintos', () => {
  const rng = seeded(7);
  const board = R.emptyBoard();
  put(board, 'PIKACHU', 7, 4, 'H');
  const rack = 'QQQQQQQQQQ'.split('');
  const bag = R.newBag();
  const res = M.ensurePlayable({ board, rack, bag, type: 'fire', used: ['PIKACHU'], rng });
  assert.equal(res.changed, true);
  assert.equal(rack.length, R.RACK_SIZE);
  assertOptions(board, rack, res.type, ['PIKACHU']);
});

test('varias posiciones de un solo Pokémon no cuentan como tres alternativas', () => {
  const board = R.emptyBoard();
  put(board, 'SEEL', 7, 5, 'H');
  const used = R.WORDS.filter((w) => w !== 'MEW');
  const rack = 'MEWXXXXXXX'.split('');
  const moves = M.findMoves(board, rack, 'psychic', used);
  assert.ok(moves.length > 1);
  assert.equal(new Set(moves.map((m) => m.word)).size, 1);
  const result = M.ensurePlayable({ board, rack, bag: R.newBag(), type: 'psychic', used, rng: seeded(1) });
  assert.equal(result.move, null);
  assert.equal(result.reason, 'options');
});

test('al agotarse la bolsa, un atril corto sigue teniendo tres alternativas', () => {
  const board = R.emptyBoard();
  put(board, 'SEEL', 7, 5, 'H');
  const rack = ['Q'];
  const result = M.ensurePlayable({board, rack, bag:[], type:'ghost', used:['SEEL'], rng:seeded(4)});
  assert.ok(result.move);
  assert.ok(rack.length <= R.RACK_SIZE);
  assertOptions(board, rack, result.type, ['SEEL']);
});

test('dos nombres distintos no alcanzan la nueva garantía de tres', () => {
  const used = R.WORDS.filter((w) => !['MEW','MUK'].includes(w));
  const result = M.ensurePlayable({board:R.emptyBoard(),rack:'MEWMUKXXXXXX'.split(''),bag:R.newBag(),type:'psychic',used,rng:seeded(1)});
  assert.equal(result.move,null);
  assert.equal(result.reason,'options');
});

test('el atril de doce permite nombres largos y conserva el límite de tres', () => {
  assert.equal(R.RACK_SIZE,12);
  assert.equal(R.MIN_OPTIONS,3);
  const long = R.WORDS.find((w) => w.length===12);
  assert.ok(long);
  const moves = M.findMoves(R.emptyBoard(),long.split(''),R.ANY_TYPE,[]);
  const move = moves.find((m) => m.word===long);
  assert.ok(move);
  assert.equal(R.validatePlay({board:R.emptyBoard(),placements:move.place,type:R.ANY_TYPE,used:[]}).ok,true);
});

test('restaurar una partida aplica la garantía y conserva la pista pagada', () => {
  const rng = seeded(3);
  const players = [0, 1].map((seat) => ({seat, name:`J${seat}`, color:'#000', avatar:25}));
  const state = G.createGame({players, rounds:10}, rng);
  state.players[0].rack = 'SLEIECRNLE'.split('');
  state.players[0].type = 'ghost';
  delete state.turnPolicyVersion;
  assert.equal(G.act(state, 0, {type:'hint'}, rng).ok, true);
  const score = state.players[0].score;
  assert.equal(G.upgradeTurn(state, rng), true);
  assert.equal(state.players[0].score, score);
  const moves = assertOptions(state.board, state.players[0].rack, state.players[0].type, state.used);
  assert.ok(moves.some((m) => m.word === state.hint.word));
  assert.equal(G.act(state, 0, {type:'hint'}, rng).ok, true);
  assert.equal(state.players[0].score, score);
  const snapshot = JSON.stringify(state);
  assert.equal(G.upgradeTurn(state, rng), false);
  assert.equal(JSON.stringify(state), snapshot);
});

test('partidas completas con bots: siempre hay tres Pokémon y un x2 disponible', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    const n = 2 + (seed % 3);
    const players = Array.from({ length: n }, (_, i) => ({ seat: i, name: `Bot ${i}`, color: '#000', avatar: 25, bot: true }));
    const state = G.createGame({ players, rounds: 0 }, rng);
    let guard = 0;
    while (state.phase === 'play' && guard++ < 400) {
      const blanks = state.bag.filter((l) => l === R.BLANK).length
        + state.players.reduce((n, p) => n + p.rack.filter((l) => l === R.BLANK).length, 0)
        + state.board.filter((cell) => cell?.blank).length;
      assert.equal(blanks, 2, 'los dos comodines se conservan entre bolsa, atriles y tablero');
      const p = state.players[state.turn];
      assertOptions(state.board, p.rack, p.type, state.used);
      const best = M.bestMove(state.board, p.rack, p.type, state.used);
      const tiles = R.assignRack(p.rack, best.place);
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
    const tiles = R.assignRack(p.rack, best.place);
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

test('comodines: dos en la bolsa, cualquier letra y prioridad a fichas reales', () => {
  assert.equal(R.newBag().filter((l) => l === R.BLANK).length, 2);
  assert.equal(R.LETTER_POINTS[R.BLANK], 0);
  const place = [...'MEW'].map((l, k) => ({r:7, c:6+k, l}));
  assert.deepEqual(R.assignRack(['*', 'M', 'W'], place), [
    {r:7,c:6,i:1}, {r:7,c:7,i:0,l:'E'}, {r:7,c:8,i:2},
  ]);
  assert.equal(R.assignRack(['*', 'X'], place), null);
  const rack = 'PIKACH*MEW'.split('');
  const moves = assertOptions(R.emptyBoard(), rack, 'electric', []);
  assert.ok(moves.some((m) => m.word === 'PIKACHU'));
  const result = M.ensurePlayable({board:R.emptyBoard(), rack, bag:R.newBag(), type:'electric', used:[], rng:seeded(2)});
  assert.equal(result.changed, false);
  assert.ok(rack.includes(R.BLANK));
});

function fixtureGame(rng) {
  return G.createGame({players:[0,1].map((seat) => ({seat,name:`J${seat}`,color:'#000',avatar:25})),rounds:10}, rng);
}

test('comodín: elección obligatoria, cero puntos y letra fija en cruces y guardado', () => {
  const rng = seeded(12);
  const state = fixtureGame(rng);
  const p = state.players[0];
  p.rack = 'M*WXXXXXXX'.split('');
  p.type = 'psychic';
  const tiles = [{r:7,c:6,i:0},{r:7,c:7,i:1,l:'E'},{r:7,c:8,i:2}];
  const snapshot = JSON.stringify(state);
  for (const l of [undefined,'','AB','*','1']) {
    const bad = tiles.map((t) => t.i === 1 ? {...t,l} : t);
    assert.equal(G.act(state,0,{type:'play',tiles:bad},rng).ok,false);
    assert.equal(JSON.stringify(state),snapshot);
  }
  const spoof = tiles.map((t) => t.i === 0 ? {...t,l:'E'} : t);
  assert.equal(G.act(state,0,{type:'play',tiles:spoof},rng).ok,false);
  const result = G.act(state,0,{type:'play',tiles},rng);
  assert.equal(result.ok,true);
  assert.equal(result.move.baseScore,12);
  assert.equal(result.move.score,24);
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(saved.board[R.idx(7,7)].l,'E');
  assert.equal(saved.board[R.idx(7,7)].blank,true);
  const cross = [{r:6,c:7,l:'S'},{r:8,c:7,l:'E'},{r:9,c:7,l:'L'}];
  const zero = R.validatePlay({board:saved.board,placements:cross,type:'water',used:['MEW']});
  assert.equal(zero.ok,true);
  assert.equal(zero.word,'SEEL');
  const normalBoard = JSON.parse(JSON.stringify(saved.board));
  delete normalBoard[R.idx(7,7)].blank;
  const normal = R.validatePlay({board:normalBoard,placements:cross,type:'water',used:['MEW']});
  assert.equal(normal.baseScore-zero.baseScore,1);
});

test('cambiar 1: exactamente una ficha, sin perder turno, una vez por jugador y ronda', () => {
  const rng = seeded(20);
  const state = fixtureGame(rng);
  state.players[0].rack = 'PIKACHUMEW'.split('');
  state.players[0].type = 'electric';
  state.bag = R.newBag();
  const before = state.players[0].rack.slice();
  const bagCount = state.bag.length;
  const total = R.countLetters([...state.bag,...before]);
  for (const indices of [[],[0,1],[-1],[10],[0.5]]) {
    assert.equal(G.act(state,0,{type:'swap-one',indices},rng).ok,false);
  }
  assert.equal(G.act(state,1,{type:'swap-one',indices:[0]},rng).ok,false);
  assert.equal(G.act(state,0,{type:'hint'},rng).ok,true);
  const score = state.players[0].score;
  assert.equal(G.act(state,0,{type:'swap-one',indices:[2]},rng).ok,true);
  assert.equal(state.turn,0);
  assert.equal(state.round,1);
  assert.equal(state.bag.length,bagCount);
  assert.equal(state.players[0].rack.filter((l,i)=>l!==before[i]).length,1);
  assert.deepEqual(R.countLetters([...state.bag,...state.players[0].rack]),total);
  assert.equal(state.players[0].score,score);
  const moves = assertOptions(state.board,state.players[0].rack,state.players[0].type,state.used);
  assert.ok(moves.some((m)=>m.word===state.hint.word));
  assert.equal(G.publicView(state,0).players[0].singleSwapAvailable,false);
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(G.act(saved,0,{type:'swap-one',indices:[0]},rng).ok,false);
  assert.equal(G.act(state,0,{type:'pass'},rng).ok,true);
  assert.equal(G.publicView(state,1).players[1].singleSwapAvailable,true);
  assert.equal(G.act(state,1,{type:'swap-one',indices:[0]},rng).ok,true);
  assert.equal(G.act(state,1,{type:'pass'},rng).ok,true);
  assert.equal(state.round,2);
  assert.equal(G.publicView(state,0).players[0].singleSwapAvailable,true);
});

test('cambiar 1 no consume el beneficio si no hay reemplazo válido o bolsa vacía', () => {
  const rng = seeded(20);
  const state = fixtureGame(rng);
  state.players[0].rack = 'PIKACHUMEW'.split('');
  state.bag = ['K'];
  const snapshot = JSON.stringify(state);
  assert.equal(G.act(state,0,{type:'swap-one',indices:[2]},rng).ok,false);
  assert.equal(JSON.stringify(state),snapshot);
  state.bag = [];
  assert.equal(G.act(state,0,{type:'swap-one',indices:[0]},rng).ok,false);
  assert.equal(state.players[0].singleSwapRound,null);
});

test('partidas antiguas reciben dos comodines una sola vez al actualizar', () => {
  const rng = seeded(9);
  const state = fixtureGame(rng);
  state.bag = state.bag.filter((l)=>l!==R.BLANK);
  state.players.forEach((p)=>{p.rack=p.rack.map((l)=>l===R.BLANK?'E':l);delete p.singleSwapRound;});
  state.turnPolicyVersion = 2;
  assert.equal(G.upgradeTurn(state,rng),true);
  const count = () => state.bag.filter((l)=>l===R.BLANK).length + state.players.reduce((n,p)=>n+p.rack.filter((l)=>l===R.BLANK).length,0);
  assert.equal(count(),2);
  assert.equal(G.upgradeTurn(state,rng),false);
  assert.equal(count(),2);
  assert.equal(G.publicView(state,0).players[0].singleSwapAvailable,true);
});

test('partidas de diez fichas se amplían sin perder puntos ni el cambio usado', () => {
  const rng = seeded(10);
  const state = fixtureGame(rng);
  state.players.forEach((p)=>{state.bag.push(...p.rack.splice(10));});
  state.players[0].score=123;
  state.players[0].singleSwapRound=state.round;
  state.turnPolicyVersion=3;
  assert.equal(G.upgradeTurn(state,rng),true);
  assert.ok(state.players.every((p)=>p.rack.length===12));
  assert.equal(state.players[0].score,123);
  assert.equal(G.publicView(state,0).players[0].singleSwapAvailable,false);
  assertOptions(state.board,state.players[0].rack,state.players[0].type,state.used);
});

console.log(`✓ ${passed} pruebas`);
