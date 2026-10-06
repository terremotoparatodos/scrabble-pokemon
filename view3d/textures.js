/*
 * Texturas dibujadas en canvas: la cara del tablero (las 225 casillas en una
 * sola imagen), la cara de cada ficha y los carteles flotantes.
 * Las de fichas se guardan en caché (letra + dueño + estado).
 */
import * as THREE from 'three';

const R = window.ScrabbleRules;

const PREMIUM_STYLE = {
  DL: { bg: '#a5d8ff', ink: '#1c5d99', label: ['x2', 'LETRA'] },
  TL: { bg: '#4dabf7', ink: '#ffffff', label: ['x3', 'LETRA'] },
  DW: { bg: '#ffc9de', ink: '#a61e4d', label: ['x2', 'PALABRA'] },
  TW: { bg: '#ff6b6b', ink: '#ffffff', label: ['x3', 'PALABRA'] },
};

function canvasTexture(canvas, { pixelated = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (pixelated) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pokeBall(ctx, cx, cy, r) {
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = '#1f2933';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e3350d';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1f2933';
  ctx.fillRect(cx - r, cy - r * 0.1, r * 2, r * 0.2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Cara del tablero: paño, casillas especiales y la Poké Ball del centro. */
export function boardTexture() {
  const px = 136; // píxeles por casilla
  const size = R.SIZE * px;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b9d8a6';
  ctx.fillRect(0, 0, size, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < R.SIZE; r++) {
    for (let col = 0; col < R.SIZE; col++) {
      const x = col * px + 4;
      const y = r * px + 4;
      const w = px - 8;
      const i = R.idx(r, col);
      const prem = PREMIUM_STYLE[R.PREMIUM[i]];
      const center = r === R.CENTER && col === R.CENTER;
      ctx.fillStyle = center ? '#ffe3a3' : prem ? prem.bg : '#d8efc9';
      roundRect(ctx, x, y, w, w, 12);
      ctx.fill();
      if (center) {
        pokeBall(ctx, x + w / 2, y + w / 2, w * 0.38);
      } else if (prem) {
        ctx.fillStyle = prem.ink;
        ctx.font = `900 ${w * 0.4}px "Trebuchet MS", sans-serif`;
        ctx.fillText(prem.label[0], x + w / 2, y + w * 0.4);
        ctx.font = `800 ${w * 0.15}px "Trebuchet MS", sans-serif`;
        ctx.fillText(prem.label[1], x + w / 2, y + w * 0.76);
      }
    }
  }
  return canvasTexture(c);
}

const tileCache = new Map();

/**
 * Cara superior de una ficha. state: 'placed' | 'pending' | 'fresh'.
 * letter null: ficha boca abajo.
 * owner: color del jugador que la puso (franja de abajo).
 */
export function tileTexture(letter, owner, state, blank = false) {
  const key = `${letter}|${owner || ''}|${state}|${blank}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, s);
  if (state === 'pending') {
    g.addColorStop(0, '#fff3bf');
    g.addColorStop(1, '#ffd43b');
  } else {
    g.addColorStop(0, '#fff8dc');
    g.addColorStop(1, '#f3dc98');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  if (owner) {
    ctx.fillStyle = owner;
    ctx.fillRect(0, s - 14, s, 14);
  }
  if (state === 'fresh') {
    ctx.strokeStyle = '#ffcb05';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, s - 10, s - 10);
  }
  if (!letter) {
    // Ficha boca abajo (atril de un rival): solo el emblema, nunca la letra.
    ctx.globalAlpha = 0.35;
    pokeBall(ctx, s / 2, s / 2, s * 0.3);
    ctx.globalAlpha = 1;
    const tex = canvasTexture(c);
    tileCache.set(key, tex);
    return tex;
  }
  ctx.fillStyle = '#1f2933';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 80px "Trebuchet MS", sans-serif';
  ctx.fillText(letter === R.BLANK ? '★' : letter, s * 0.46, s * 0.47);
  ctx.font = '800 28px "Trebuchet MS", sans-serif';
  ctx.fillText(String(blank ? 0 : R.LETTER_POINTS[letter]), s * 0.83, s * 0.78);
  const tex = canvasTexture(c);
  tileCache.set(key, tex);
  return tex;
}

/** Marco para resaltar casillas (pista, cursor, casilla bajo el mouse). */
export function frameTexture(color, arrow) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  roundRect(ctx, 8, 8, s - 16, s - 16, 16);
  ctx.stroke();
  if (arrow) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (arrow === 'H') {
      ctx.moveTo(s - 34, s / 2 - 16);
      ctx.lineTo(s - 16, s / 2);
      ctx.lineTo(s - 34, s / 2 + 16);
    } else {
      ctx.moveTo(s / 2 - 16, s - 34);
      ctx.lineTo(s / 2, s - 16);
      ctx.lineTo(s / 2 + 16, s - 34);
    }
    ctx.fill();
  }
  return canvasTexture(c);
}

/** Cartel con nombre y puntaje (sobre cada compañero). */
export function labelTexture(lines, color, active) {
  const w = 512;
  const h = 200;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = active ? color : 'rgba(255,255,255,0.95)';
  roundRect(ctx, 8, 8, w - 16, h - 16, 40);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? '#ffffff' : color;
  ctx.font = '900 64px "Trebuchet MS", sans-serif';
  ctx.fillText(lines[0], w / 2, 70, w - 50);
  ctx.fillStyle = active ? '#ffffff' : '#1f2933';
  ctx.font = '800 54px "Trebuchet MS", sans-serif';
  ctx.fillText(lines[1], w / 2, 140, w - 50);
  return canvasTexture(c);
}

/** Nombre del Pokémon creado, con el estilo del logo. */
export function bannerTexture(name, sub) {
  const w = 1024;
  const h = 260;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 130px "Trebuchet MS", sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 26;
  ctx.strokeStyle = '#1d3a8a';
  ctx.strokeText(name, w / 2, 100, w - 40);
  ctx.fillStyle = '#ffcb05';
  ctx.fillText(name, w / 2, 100, w - 40);
  ctx.font = '900 64px "Trebuchet MS", sans-serif';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#1f2933';
  ctx.strokeText(sub, w / 2, 210);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sub, w / 2, 210);
  return canvasTexture(c);
}

const spriteLoader = new THREE.TextureLoader();
/** Sprite pixel art de un Pokémon (assets/sprites/), sin suavizar. */
export function spriteTexture(id) {
  const tex = spriteLoader.load(`assets/sprites/${id}.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
