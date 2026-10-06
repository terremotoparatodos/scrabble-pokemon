/*
 * Tablero 3D: une la escena (stage.js), la cámara (camera.js), los atriles
 * y la bolsa (racks.js), el mouse (mouse.js), los compañeros y los efectos.
 *
 * En 1v1 todas las cámaras y letras miran de frente desde el mismo lado.
 * El dueño del atril sigue siendo view.me, independientemente de la cámara.
 * Con tres o cuatro jugadores se conserva la orientación por asiento.
 *
 * render(view, extra) solo dibuja lo que recibe; las intenciones (poner,
 * mover, quitar fichas…) van a `input` (play-panel.js), que las valida.
 */
import * as THREE from 'three';
import { tween, ease, tickTweens } from './tween.js';
import { frameTexture } from './textures.js';
import { Companion } from './companions.js';
import { createStage, cellPos, BOARD_TOP } from './stage.js';
import { createCameraDirector } from './camera.js';
import { createdSequence } from './fx.js';
import { createTileFactory, TILE_H } from './tiles.js';
import { createRacks } from './racks.js';
import { createMouse } from './mouse.js';
import { SEAT_ANGLE, COMPANION_LOCAL, toWorld } from './seats.js';
import { dust, shockwave, sparks, firework, confetti, ambientMotes } from './particles.js';

const R = window.ScrabbleRules;
const BV = window.BoardView;

const PENDING_LIFT = 0.22;
const PREMIUM_COLOR = { DL: '#74c0fc', TL: '#339af0', DW: '#ff8fab', TW: '#ff6b6b' };

/** Cono de luz translúcido sobre el compañero del jugador en turno. */
function makeSpotlight() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 1.8, 9, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = 4.5;
  const pool = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.95, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  const group = new THREE.Group();
  group.add(beam, pool);
  group.visible = false;
  return { group, beam, pool };
}

/** input: { tapCell(r,c), movePending(from,to), removeAt(r,c), isOverRack(x,y) } (play-panel.js) */
export function createBoard3D(container, input) {
  const { renderer, scene, camera, scenery, face } = createStage(container);
  const director = createCameraDirector(camera);
  const factory = createTileFactory(scene);
  const racks = createRacks(scene, factory, camera);
  const effects = [];
  const pushEffect = (fx) => effects.push(fx);
  pushEffect(ambientMotes(scene));

  let pov = null;
  let angle = 0;
  const viewListeners = [];
  let lastCameraSignature = '';
  let lastCameraNotice = 0;
  const placed = new Map(); // idx → tile
  const pending = new Map(); // idx → tile

  // ── Marcos (pista, cursor, mouse) ──
  const frameGeo = new THREE.PlaneGeometry(0.98, 0.98);
  const frameMat = (color, arrow) => new THREE.MeshBasicMaterial({ map: frameTexture(color, arrow), transparent: true, depthWrite: false });
  const frameMats = { hint: frameMat('#f59f00'), hover: frameMat('rgba(255,255,255,0.95)'), H: frameMat('#4c6ef5', 'H'), V: frameMat('#4c6ef5', 'V') };
  const framePool = [];
  let framesUsed = 0;
  function placeFrame(r, c, kind, y) {
    if (!framePool[framesUsed]) {
      const m = new THREE.Mesh(frameGeo, frameMats.hint);
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      framePool.push(m);
    }
    const m = framePool[framesUsed++];
    m.material = frameMats[kind];
    m.position.copy(cellPos(r, c, y));
    // Las flechas del cursor se leen desde el asiento de quien mira.
    m.rotation.z = kind === 'H' || kind === 'V' ? 0 : angle;
    m.visible = true;
  }

  // ── Compañeros y foco ──
  const companions = new Map(); // seat → { comp, key }
  const spot = makeSpotlight();
  scene.add(spot.group);
  let spotSeat = null;
  const companionPos = (seat) => toWorld(seat, COMPANION_LOCAL);

  function syncCompanions(view) {
    const seen = new Set();
    view.players.forEach((p, i) => {
      seen.add(p.seat);
      const key = `${p.avatar}|${p.color}`;
      let entry = companions.get(p.seat);
      if (!entry || entry.key !== key) {
        if (entry) scene.remove(entry.comp.root);
        const comp = new Companion(BV.AVATAR_MODELS[p.avatar] || 'pikachu', p.avatar, p.color);
        const at = companionPos(p.seat);
        comp.root.position.copy(at);
        comp.root.rotation.y = Math.atan2(-at.x, -at.z); // mira al centro del tablero
        scene.add(comp.root);
        entry = { comp, key };
        companions.set(p.seat, entry);
      }
      const active = view.phase === 'play' && view.turn === i;
      entry.comp.setActive(active);
    });
    for (const [seat, entry] of companions) {
      if (!seen.has(seat)) {
        scene.remove(entry.comp.root);
        companions.delete(seat);
      }
    }
  }

  function moveSpot(view, animate) {
    const p = view.phase === 'play' ? view.players[view.turn] : null;
    if (!p) {
      spot.group.visible = false;
      spotSeat = null;
      return;
    }
    if (spotSeat === p.seat) return;
    spotSeat = p.seat;
    spot.beam.material.color.set(p.color);
    spot.pool.material.color.set(p.color);
    const to = companionPos(p.seat).setY(0);
    const from = spot.group.visible ? spot.group.position.clone() : to.clone();
    spot.group.visible = true;
    if (!animate) return spot.group.position.copy(to);
    tween(650, (t) => spot.group.position.lerpVectors(from, to, t), ease.inOutCubic).then(() => {
      const entry = companions.get(p.seat);
      if (entry) entry.comp.greet();
    });
  }

  // ── Fichas del tablero ──
  function removeTile(map, i) {
    factory.dispose(map.get(i));
    map.delete(i);
  }

  /** Una ficha aparece en su casilla: rebote, polvo y, si es especial, onda y chispas. */
  function land(i) {
    const tile = placed.get(i);
    if (!tile) return;
    const g = tile.group;
    g.visible = true;
    pushEffect(dust(scene, g.position.clone().setY(BOARD_TOP + 0.05)));
    const prem = R.PREMIUM[i];
    if (prem) {
      pushEffect(shockwave(scene, g.position.clone().setY(BOARD_TOP + 0.03), PREMIUM_COLOR[prem]));
      pushEffect(sparks(scene, g.position.clone().setY(BOARD_TOP + 0.3), PREMIUM_COLOR[prem], 14));
    }
    tween(220, (t) => {
      const k = Math.sin(t * Math.PI);
      g.scale.set(1 + 0.12 * k, 1 - 0.25 * k, 1 + 0.12 * k);
    }, ease.linear);
  }

  // ── Dibujo ──
  let last = null; // { moveNo, counts: Map(seat → rackCount), pendingIdx: Set }
  let lastPhase = null;
  let hover = null;
  let lastView = null;
  let lastExtra = null;

  /** ¿Qué pasó desde la vista anterior? Para animar las fichas de cada jugador. */
  function detectChange(view) {
    if (!last || view.moveNo !== last.moveNo + 1) return null;
    const entry = view.log[0];
    if (!entry || entry.n !== view.moveNo) return null;
    const p = view.players[entry.player];
    const before = last.counts.get(p.seat) ?? p.rackCount;
    if (entry.kind === 'play' && view.lastMove) {
      const cells = view.lastMove.placed.map(({ r, c }) => {
        const idx = R.idx(r, c);
        return { r, c, idx, fromRack: !last.pendingIdx.has(idx) };
      });
      return { kind: 'play', seat: p.seat, cells, drawn: p.rackCount - (before - cells.length) };
    }
    if ((entry.kind === 'exchange' || entry.kind === 'swap-one') && entry.count > 0) return { kind: 'exchange', seat: p.seat, count: entry.count };
    return null;
  }

  function render(view, extra) {
    const ownerSeat = view.me >= 0 ? view.players[view.me].seat : extra?.seat ?? null;
    const nextPov = window.LiveView.cameraSeat(view, extra && extra.seat);
    if (nextPov !== pov) {
      pov = nextPov;
      director.setPov(pov);
    }
    angle = pov != null ? SEAT_ANGLE[pov] : 0;
    face.rotation.z = angle;

    const change = detectChange(view);
    const reset = last && view.moveNo < last.moveNo; // partida nueva
    if (reset) {
      for (const i of [...placed.keys()]) removeTile(placed, i);
    }

    const fresh = new Set(view.lastMove ? view.lastMove.placed.map((p) => R.idx(p.r, p.c)) : []);
    const colorOf = new Map(view.players.map((p) => [p.seat, p.color]));
    view.board.forEach((cell, i) => {
      if (!cell) {
        if (placed.has(i)) removeTile(placed, i);
        return;
      }
      let tile = placed.get(i);
      if (tile && tile.letter !== cell.l) {
        removeTile(placed, i);
        tile = null;
      }
      if (!tile) {
        tile = factory.make(cell.l);
        tile.group.position.copy(cellPos(Math.floor(i / R.SIZE), i % R.SIZE));
        placed.set(i, tile);
        // Las fichas de una jugada aparecen cuando llegan volando (racks.play).
        if (change && change.kind === 'play') tile.group.visible = false;
      }
      factory.skin(tile, cell.l, colorOf.get(cell.s), fresh.has(i) ? 'fresh' : 'placed', angle, !!cell.blank);
    });

    // Fichas que quien mira está poniendo (flotan sobre su casilla)
    const want = new Map(((extra && extra.pending) || []).map((p) => [R.idx(p.r, p.c), p]));
    for (const i of [...pending.keys()]) {
      if (!want.has(i) || pending.get(i).letter !== want.get(i).l) removeTile(pending, i);
    }
    for (const [i, p] of want) {
      let tile = pending.get(i);
      if (!tile) {
        tile = factory.make(p.l);
        tile.group.position.copy(cellPos(p.r, p.c, BOARD_TOP + PENDING_LIFT));
        pending.set(i, tile);
        tween(220, (t) => tile.group.scale.setScalar(0.4 + 0.6 * t), ease.outBack);
      }
      tile.group.userData.cell = { r: p.r, c: p.c };
      factory.skin(tile, p.l, '', 'pending', angle, !!p.blank);
    }

    if (change && change.kind === 'play') racks.play(change.seat, change.cells, change.drawn, land);
    else if (change && change.kind === 'exchange') racks.exchange(change.seat, change.count);
    racks.sync(view, extra, ownerSeat);

    framesUsed = 0;
    const hint = extra && extra.hint;
    if (hint) {
      for (let k = 0; k < hint.word.length; k++) placeFrame(hint.r + (hint.dir === 'V' ? k : 0), hint.c + (hint.dir === 'H' ? k : 0), 'hint', BOARD_TOP + 0.01);
    }
    const cursor = extra && extra.cursor;
    if (cursor) placeFrame(cursor.r, cursor.c, cursor.dir, BOARD_TOP + 0.02);
    if (hover) placeFrame(hover.r, hover.c, 'hover', BOARD_TOP + 0.015);
    for (let k = framesUsed; k < framePool.length; k++) framePool[k].visible = false;

    syncCompanions(view);
    moveSpot(view, !!last);
    if (lastPhase === 'play' && view.phase === 'over') celebrateWin(view);
    if (view.phase === 'play') director.setOrbit(false);
    lastPhase = view.phase;
    lastView = view;
    lastExtra = extra;
    last = {
      moveNo: view.moveNo,
      counts: new Map(view.players.map((p) => [p.seat, p.rackCount])),
      pendingIdx: new Set(want.keys()),
    };
  }

  /** Jugada nueva: el compañero lanza la Poké Ball y sale el Pokémon. */
  function celebrate(view) {
    const m = view.lastMove;
    if (!m) return;
    const sum = m.cells.reduce((acc, { r, c }) => acc.add(cellPos(r, c, BOARD_TOP + TILE_H)), new THREE.Vector3());
    const center = sum.divideScalar(m.cells.length);
    const entry = R.DEX[m.id - 1];
    const comp = companions.get(m.seat);
    const from = comp ? comp.comp.throwPoint() : center.clone().add(new THREE.Vector3(0, 6, 6));
    setTimeout(() => {
      if (comp) comp.comp.celebrate();
      director.focus(center, 2600);
      createdSequence(scene, { from, to: center, id: m.id, name: entry.name, score: m.score, color: view.players[m.player].color, pushEffect });
    }, 110 * m.placed.length + 700);
  }

  /** Fin de la partida: los ganadores saltan, fuegos artificiales y la cámara gira. */
  function celebrateWin(view) {
    director.setOrbit(true);
    const winners = (view.winners || []).map((i) => view.players[i]);
    let n = 0;
    const timer = setInterval(() => {
      if (n++ >= 10 || !lastView || lastView.phase !== 'over') return clearInterval(timer);
      const w = winners[n % winners.length];
      if (!w) return;
      const at = companionPos(w.seat);
      pushEffect(firework(scene, at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 1, (Math.random() - 0.5) * 8)), w.color));
      if (n % 3 === 1) pushEffect(confetti(scene, at.clone().setY(3), w.color));
      const entry = companions.get(w.seat);
      if (entry) entry.comp.celebrate();
    }, 900);
  }

  let safeRect = null;
  function applySafe() {
    const W = container.clientWidth || 1;
    const H = container.clientHeight || 1;
    const r = safeRect || { x: 0, y: 0, w: W, h: H };
    director.setSafeArea({ x: r.x, y: r.y, w: Math.max(50, r.w), h: Math.max(50, r.h), W, H });
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applySafe();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  director.intro();

  // ── Mouse ──
  const canvas = renderer.domElement;
  const mouse = createMouse({
    canvas,
    camera,
    director,
    factory,
    getPendingTiles: () => [...pending.values()],
    canEdit: () => !!(lastExtra && lastExtra.editable),
    isOverRack: (x, y) => !!(input.isOverRack && input.isOverRack(x, y)),
    onHover(cell) {
      hover = cell;
      if (lastView) render(lastView, lastExtra);
    },
    onMove: (from, to) => input.movePending(from, to),
    onRemove: (cell) => input.removeAt(cell.r, cell.c),
    onTapCell: (cell) => input.tapCell(cell.r, cell.c),
  });

  // ── Soltar fichas del atril HTML (rack-drag.js) ──
  let ghost = null;
  const isFree = (cell) => !!cell && !lastView.board[R.idx(cell.r, cell.c)] && !pending.has(R.idx(cell.r, cell.c));

  /** Muestra una ficha «fantasma» encajada en la casilla bajo el mouse; devuelve esa casilla. */
  function previewDrop(clientX, clientY, letter) {
    const cell = lastView && lastExtra && lastExtra.editable ? mouse.cellAt(clientX, clientY) : null;
    if (!isFree(cell)) {
      clearDrop();
      return null;
    }
    if (!ghost || ghost.letter !== letter) {
      clearDrop();
      ghost = factory.make(letter);
      ghost.top.material.transparent = true;
      ghost.top.material.opacity = 0.85;
    }
    factory.skin(ghost, letter, '', 'pending', angle);
    ghost.group.position.copy(cellPos(cell.r, cell.c, BOARD_TOP + 0.08));
    if (!hover || hover.r !== cell.r || hover.c !== cell.c) {
      hover = cell;
      render(lastView, lastExtra);
    }
    return cell;
  }

  function clearDrop() {
    if (ghost) factory.dispose(ghost);
    ghost = null;
    if (hover) {
      hover = null;
      if (lastView) render(lastView, lastExtra);
    }
  }


  // ── Bucle ──
  const clock = new THREE.Clock();
  let running = true;
  function frameLoop(now) {
    if (!running) return;
    requestAnimationFrame(frameLoop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    tickTweens(now);
    for (let k = effects.length - 1; k >= 0; k--) if (!effects[k](dt, t)) effects.splice(k, 1);
    for (const { comp } of companions.values()) comp.update(dt, t);
    for (const tile of pending.values()) {
      tile.group.position.y = BOARD_TOP + PENDING_LIFT + Math.sin(t * 4 + tile.group.position.x) * 0.05;
    }
    spot.beam.material.opacity = 0.65 + Math.sin(t * 3) * 0.2;
    spot.pool.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    scenery.update(dt, t);
    director.update(dt, t);
    renderer.render(scene, camera);
    if (viewListeners.length && now - lastCameraNotice >= 50) {
      const signature = JSON.stringify(director.getUserView());
      if (signature !== lastCameraSignature) {
        lastCameraSignature = signature;
        lastCameraNotice = now;
        viewListeners.forEach((fn) => fn());
      }
    }
  }
  requestAnimationFrame(frameLoop);

  return {
    element: canvas,
    render,
    celebrate,
    toggleView: () => director.toggleAlt(),
    resetView: () => director.resetUser(),
    previewDrop,
    clearDrop,
    getCameraView: () => director.getUserView(),
    getCameraSeat: () => pov,
    setCameraView: (view) => director.setUserView(view),
    onViewChange: (fn) => viewListeners.push(fn),
    /** Espacio libre del lienzo (px, relativo al lienzo) donde debe entrar el tablero. */
    setSafeArea(rect) {
      safeRect = rect;
      applySafe();
    },
    isAltView: () => director.isAlt(),
    dispose() {
      running = false;
      renderer.dispose();
    },
  };
}
