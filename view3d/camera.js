/*
 * Director de cámara del modo 3D.
 *
 * Pose base:
 * - jugador (pov = asiento): vista «Tablero», alta desde su lado (la de
 *   jugar); con «alt», sentado detrás de su lugar («Ver la mesa»);
 * - vista general (pov = null): en diagonal, se ve toda la mesa (público);
 *   con «alt», cenital.
 *
 * Encuadre: el tablero se ajusta al «espacio libre» (setSafeArea), la parte
 * del lienzo que no tapan la barra de arriba, el atril ni las placas; el
 * centro de la proyección se corre a ese espacio (setViewOffset).
 *
 * Mouse (orbit/pan/zoom): ajustes del jugador sobre la pose base; se
 * reinician al cambiar de asiento o con resetUser().
 *
 * Efectos: entrada en vuelo, balanceo leve, acercamiento a la palabra creada
 * y vuelta alrededor de la mesa al terminar.
 */
import * as THREE from 'three';
import { tween, ease } from './tween.js';
import { POV, BOARD_VIEW, toWorld } from './seats.js';

const HALF = window.ScrabbleRules.SIZE / 2;
const OVERVIEW_FOV = 32;
const PAN_LIMIT = 8;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.7;
const PHI_MIN = 0.05; // casi cenital
const PHI_MAX = 1.3; // casi a ras de la mesa
const FIT_HALF = HALF + 0.6; // tablero con su marco
const FIT_MARGIN = 10; // px de aire alrededor del tablero
const OVERVIEW_HALF = 10.6; // tablero + atriles

export function createCameraDirector(camera) {
  let pov = null;
  let altView = false;
  const base = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: OVERVIEW_FOV };
  const safe = { x: 0, y: 0, w: 1, h: 1, W: 1, H: 1 };
  const user = { yaw: 0, pitch: 0, zoom: 1, pan: new THREE.Vector3() };
  let focusPoint = new THREE.Vector3();
  let focusW = 0;
  let orbit = 0;
  let orbiting = false;
  let introK = 1;
  let ready = false; // ¿ya se conoce el espacio libre?

  // ── Encuadre exacto: la distancia justa para que las 4 esquinas del tablero
  // proyectadas caigan dentro del espacio libre (con un margen). ──
  const scratch = new THREE.PerspectiveCamera();
  let corners = [];
  const square = (half) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(sx * half, 0.45, sz * half)));

  function fits(fov) {
    scratch.updateMatrixWorld();
    for (const c of corners) {
      // Detrás de la cámara la proyección engaña: cada esquina tiene que estar delante.
      if (c.clone().applyMatrix4(scratch.matrixWorldInverse).z > -scratch.near) return false;
      const v = c.clone().project(scratch);
      const x = ((v.x + 1) / 2) * safe.W;
      const y = ((1 - v.y) / 2) * safe.H;
      if (v.z > 1 || x < safe.x + FIT_MARGIN || x > safe.x + safe.w - FIT_MARGIN || y < safe.y + FIT_MARGIN || y > safe.y + safe.h - FIT_MARGIN) return false;
    }
    return fov > 0;
  }

  /** Acerca o aleja la cámara sobre su misma línea de mira hasta que el tablero entra justo. */
  function fitAlong(pos, target, fov, half = FIT_HALF) {
    corners = square(half);
    const dir = pos.clone().sub(target);
    const len = dir.length();
    dir.normalize();
    scratch.fov = fov;
    scratch.aspect = safe.W / safe.H;
    scratch.near = 1;
    scratch.far = 400;
    scratch.setViewOffset(safe.W, safe.H, safe.W / 2 - (safe.x + safe.w / 2), safe.H / 2 - (safe.y + safe.h / 2), safe.W, safe.H);
    scratch.updateProjectionMatrix();
    let lo = len * 0.15;
    let hi = len * 6;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      scratch.position.copy(target).addScaledVector(dir, mid);
      scratch.lookAt(target);
      if (fits(fov)) hi = mid;
      else lo = mid;
    }
    return target.clone().addScaledVector(dir, hi);
  }

  function pose(seat = pov, alt = altView) {
    if (seat != null) {
      const v = alt ? POV : BOARD_VIEW;
      const target = toWorld(seat, new THREE.Vector3(0, 0, v.targetZ));
      const pos = toWorld(seat, new THREE.Vector3(0, v.y, v.z));
      // Sentado («Ver la mesa») es una mirada libre; la vista de tablero se encuadra justo.
      return { pos: alt ? pos : fitAlong(pos, target, v.fov), target, fov: v.fov };
    }
    if (alt) {
      const target = new THREE.Vector3();
      return { pos: fitAlong(new THREE.Vector3(0, 40, 0.01), target, OVERVIEW_FOV), target, fov: OVERVIEW_FOV };
    }
    const elev = THREE.MathUtils.degToRad(52);
    const target = new THREE.Vector3(0, 0, 0.6);
    const pos = target.clone().add(new THREE.Vector3(0, Math.sin(elev), Math.cos(elev)).multiplyScalar(40));
    // Vista general: entran también los atriles de los cuatro lados.
    return { pos: fitAlong(pos, target, OVERVIEW_FOV, OVERVIEW_HALF), target, fov: OVERVIEW_FOV };
  }

  let moveId = 0;

  /** Pose base al instante (cancela un vuelo en curso). */
  function snap() {
    moveId++;
    const p = pose();
    base.pos.copy(p.pos);
    base.target.copy(p.target);
    base.fov = p.fov;
  }

  /** Vuelo a la pose base; el destino se recalcula en cada cuadro (el espacio libre puede cambiar). */
  function moveTo(ms) {
    const id = ++moveId;
    const from = { pos: base.pos.clone(), target: base.target.clone(), fov: base.fov };
    return tween(ms, (t) => {
      if (id !== moveId) return;
      const to = pose();
      base.pos.lerpVectors(from.pos, to.pos, t);
      base.target.lerpVectors(from.target, to.target, t);
      base.fov = from.fov + (to.fov - from.fov) * t;
    }, ease.inOutCubic);
  }

  function resetUser(animate = true) {
    const from = { yaw: user.yaw, pitch: user.pitch, zoom: user.zoom, pan: user.pan.clone() };
    if (!animate) {
      Object.assign(user, { yaw: 0, pitch: 0, zoom: 1 });
      user.pan.set(0, 0, 0);
      return null;
    }
    return tween(450, (t) => {
      user.yaw = from.yaw * (1 - t);
      user.pitch = from.pitch * (1 - t);
      user.zoom = from.zoom + (1 - from.zoom) * t;
      user.pan.copy(from.pan).multiplyScalar(1 - t);
    }, ease.inOutCubic);
  }

  const yawAround = (v, center, a) => center.clone().add(v.clone().sub(center).applyAxisAngle(new THREE.Vector3(0, 1, 0), a));

  return {
    snap,
    intro() {
      snap();
      introK = 0;
      return tween(2800, (t) => (introK = t), ease.inOutCubic);
    },
    /** Cambia de asiento (o a la vista general con null), en vuelo. */
    setPov(seat) {
      if (seat === pov) return null;
      pov = seat;
      resetUser(false);
      if (!ready) return snap(); // primera vez: directo, sin vuelo
      return moveTo(1300);
    },
    getPov: () => pov,
    /** Jugador: alterna «Tablero» / «Ver la mesa». Vista general: diagonal / cenital. */
    toggleAlt() {
      altView = !altView;
      resetUser();
      return moveTo(800);
    },
    isAlt: () => altView,
    getUserView: () => ({ alt: altView, yaw: ((user.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI, pitch: user.pitch, zoom: user.zoom, pan: { x: user.pan.x, z: user.pan.z } }),
    setUserView(view) {
      if (!view) return;
      const changedAlt = altView !== view.alt;
      altView = view.alt;
      user.yaw = view.yaw;
      user.pitch = view.pitch;
      user.zoom = view.zoom;
      user.pan.set(view.pan.x, 0, view.pan.z);
      if (changedAlt) snap();
    },

    /** Espacio libre del lienzo (px): x, y, w, h dentro de W × H. */
    setSafeArea(rect) {
      Object.assign(safe, rect);
      camera.setViewOffset(safe.W, safe.H, safe.W / 2 - (safe.x + safe.w / 2), safe.H / 2 - (safe.y + safe.h / 2), safe.W, safe.H);
      snap();
      ready = true;
    },

    // ── Mouse ──
    rotate(dx, dy) {
      user.yaw -= dx * 0.006;
      user.pitch = Math.max(-1.2, Math.min(1.2, user.pitch + dy * 0.005));
    },
    /** Desplaza el tablero; dx, dy en px del lienzo. */
    pan(dx, dy) {
      const dist = camera.position.distanceTo(base.target);
      const k = (dist * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / safe.H;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      const forward = new THREE.Vector3(0, 1, 0).cross(right).normalize(); // hacia arriba de la pantalla
      user.pan.addScaledVector(right, -dx * k).addScaledVector(forward, dy * k);
      user.pan.x = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, user.pan.x));
      user.pan.z = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, user.pan.z));
    },
    zoom(delta) {
      user.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, user.zoom * Math.exp(delta * 0.0012)));
    },
    resetUser,

    async focus(point, holdMs) {
      focusPoint = point.clone();
      await tween(700, (t) => (focusW = t), ease.inOutCubic);
      await new Promise((r) => setTimeout(r, holdMs));
      await tween(900, (t) => (focusW = 1 - t), ease.inOutCubic);
    },
    setOrbit(on) {
      orbiting = on;
    },

    update(dt, t) {
      if (orbiting) orbit += dt * 0.18;
      else orbit *= Math.max(0, 1 - dt * 2);
      let target = base.target.clone();
      let pos = base.pos.clone();

      // Ajustes del jugador: giro, inclinación, zoom y desplazamiento.
      const off = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
      off.theta += user.yaw + orbit;
      off.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, off.phi + user.pitch));
      off.radius *= user.zoom;
      target.add(user.pan);
      pos = target.clone().add(new THREE.Vector3().setFromSpherical(off));

      const away = 1 - introK;
      if (away > 0) {
        pos = yawAround(pos, target, -1.4 * away);
        pos.sub(target).multiplyScalar(1 + away * 1.6).add(target);
        pos.y += away * 10;
      }
      // Balanceo muy leve solo en la vista general (jugando, la cámara queda quieta).
      if (pov == null && !altView) {
        pos = yawAround(pos, target, Math.sin(t * 0.21) * 0.03);
        pos.y += Math.sin(t * 0.33) * 0.2;
      }
      if (focusW > 0) {
        target.lerp(focusPoint, 0.45 * focusW);
        pos.lerp(target, 0.22 * focusW);
      }
      if (Math.abs(camera.fov - base.fov) > 0.01) {
        camera.fov = base.fov;
        camera.updateProjectionMatrix();
      }
      camera.position.copy(pos);
      camera.lookAt(target);
    },
  };
}
