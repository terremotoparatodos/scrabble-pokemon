/*
 * Mouse sobre el tablero 3D.
 *
 * - Arrastrar con el botón izquierdo en un lugar vacío: mueve el tablero.
 * - Botón derecho (o Ctrl + izquierdo): gira la vista. Rueda: zoom.
 * - Doble clic en un lugar vacío: vuelve a centrar.
 * - Clic en una casilla: casilla para escribir con el teclado / soltar la
 *   ficha elegida. Clic en una ficha puesta este turno: vuelve al atril.
 * - Arrastrar una ficha puesta este turno: la copia queda encajada sobre la
 *   casilla de destino (sin desfase con el mouse). Soltarla sobre el atril
 *   (abajo de la pantalla) la devuelve.
 *
 * Las fichas del atril se arrastran desde el atril HTML (rack-drag.js), que
 * usa previewDrop/drop del tablero.
 */
import * as THREE from 'three';
import { tween, ease } from './tween.js';
import { BOARD_TOP, cellPos } from './stage.js';

const R = window.ScrabbleRules;
const CLICK_PX = 5;
const HOVER_Y = BOARD_TOP + 0.45;

/**
 * opts: canvas, camera, director, factory, getPendingTiles(), canEdit(),
 *   isOverRack(clientX, clientY), onHover(cell), onMove(from, to),
 *   onRemove(cell), onTapCell(cell)
 */
export function createMouse(opts) {
  const raycaster = new THREE.Raycaster();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
  const ndc = new THREE.Vector2();
  let press = null; // { x, y, lastX, lastY, button, kind: 'pending'|'space', tile, cell, mode }
  let drag = null; // ficha puesta que se arrastra: { proxy, source }
  let hover = null;

  function setRay(ev) {
    const rect = opts.canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, opts.camera);
  }

  function cellUnder() {
    const p = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
    if (!p) return null;
    const c = Math.round(p.x + R.CENTER);
    const r = Math.round(p.z + R.CENTER);
    return R.inBounds(r, c) ? { r, c } : null;
  }

  function pickPending() {
    const tiles = opts.getPendingTiles();
    const hit = raycaster.intersectObjects(tiles.map((t) => t.group), true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.tile) o = o.parent;
    return o ? o.userData.tile : null;
  }

  function setHover(cell) {
    if ((cell && hover && cell.r === hover.r && cell.c === hover.c) || (!cell && !hover)) return;
    hover = cell;
    opts.onHover(cell);
  }

  // ── Arrastrar una ficha puesta este turno ──
  function startTileDrag() {
    const src = press.tile;
    const proxy = opts.factory.make(src.letter);
    proxy.group.position.copy(src.group.position);
    opts.factory.skin(proxy, src.letter, '', 'pending', src.top.rotation.z, src.blank);
    src.group.visible = false;
    drag = { proxy, source: press };
  }

  /** La copia se encaja sobre la casilla bajo el mouse (o lo sigue fuera del tablero). */
  function placeProxy(ev) {
    const g = drag.proxy.group;
    const cell = opts.isOverRack(ev.clientX, ev.clientY) ? null : cellUnder();
    setHover(cell);
    if (cell) {
      g.position.copy(cellPos(cell.r, cell.c, HOVER_Y));
      return;
    }
    const lift = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOVER_Y);
    const p = raycaster.ray.intersectPlane(lift, new THREE.Vector3());
    if (p) g.position.copy(p);
  }

  async function endTileDrag(ev) {
    const { proxy, source } = drag;
    drag = null;
    const overRack = opts.isOverRack(ev.clientX, ev.clientY);
    const cell = overRack ? null : cellUnder();
    setHover(null);
    let ok = false;
    if (overRack || !cell) ok = opts.onRemove(source.cell);
    else if (cell.r !== source.cell.r || cell.c !== source.cell.c) ok = opts.onMove(source.cell, cell);
    if (ok) {
      opts.factory.dispose(proxy);
      return;
    }
    const from = proxy.group.position.clone();
    const back = source.tile.group.position.clone();
    await tween(200, (k) => proxy.group.position.lerpVectors(from, back, k), ease.out);
    opts.factory.dispose(proxy);
    source.tile.group.visible = true;
  }

  // ── Eventos ──
  const canvas = opts.canvas;
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    setRay(ev);
    const rotate = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
    const tile = !rotate && ev.button === 0 && opts.canEdit() ? pickPending() : null;
    press = {
      x: ev.clientX,
      y: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      kind: tile ? 'pending' : 'space',
      tile,
      cell: tile ? tile.group.userData.cell : cellUnder(),
      mode: rotate ? 'rotate' : ev.button === 1 ? 'pan' : null,
    };
    canvas.setPointerCapture(ev.pointerId);
    if (ev.button === 1) ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    setRay(ev);
    if (!press) {
      if (ev.pointerType === 'mouse') {
        const overTile = opts.canEdit() && pickPending();
        canvas.style.cursor = overTile ? 'grab' : 'default';
        setHover(cellUnder());
      }
      return;
    }
    const moved = Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > CLICK_PX;
    if (press.kind === 'pending' && !drag && moved) startTileDrag();
    if (drag) {
      canvas.style.cursor = 'grabbing';
      placeProxy(ev);
    } else if (press.kind === 'space' && (moved || press.mode)) {
      const dx = ev.clientX - press.lastX;
      const dy = ev.clientY - press.lastY;
      if (press.mode === 'rotate') opts.director.rotate(dx, dy);
      else opts.director.pan(dx, dy);
      press.mode = press.mode || 'pan';
      canvas.style.cursor = press.mode === 'rotate' ? 'move' : 'grabbing';
    }
    press.lastX = ev.clientX;
    press.lastY = ev.clientY;
  });

  canvas.addEventListener('pointerup', (ev) => {
    setRay(ev);
    const p = press;
    press = null;
    canvas.style.cursor = 'default';
    if (drag) return endTileDrag(ev);
    if (!p || p.mode) return;
    if (p.kind === 'pending') opts.onRemove(p.cell);
    else if (p.cell) opts.onTapCell(p.cell);
  });

  canvas.addEventListener('dblclick', (ev) => {
    setRay(ev);
    if (!pickPending()) opts.director.resetUser();
  });

  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      opts.director.zoom(ev.deltaY);
    },
    { passive: false },
  );

  canvas.addEventListener('pointerleave', () => {
    if (!press) setHover(null);
  });

  return {
    /** Casilla bajo un punto de la pantalla (para soltar fichas del atril HTML). */
    cellAt(clientX, clientY) {
      setRay({ clientX, clientY });
      return cellUnder();
    },
  };
}
