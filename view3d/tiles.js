/*
 * Fichas 3D: cuerpo de madera con bordes redondeados y la cara con la letra
 * (textura de textures.js). Las usan el tablero, los atriles y las fichas
 * que vuelan.
 */
import * as THREE from 'three';
import { tileTexture } from './textures.js';

export const TILE_H = 0.22;

function tileGeometry() {
  const s = 0.84;
  const r = 0.12;
  const shape = new THREE.Shape();
  shape.moveTo(-s / 2 + r, -s / 2);
  shape.lineTo(s / 2 - r, -s / 2);
  shape.quadraticCurveTo(s / 2, -s / 2, s / 2, -s / 2 + r);
  shape.lineTo(s / 2, s / 2 - r);
  shape.quadraticCurveTo(s / 2, s / 2, s / 2 - r, s / 2);
  shape.lineTo(-s / 2 + r, s / 2);
  shape.quadraticCurveTo(-s / 2, s / 2, -s / 2, s / 2 - r);
  shape.lineTo(-s / 2, -s / 2 + r);
  shape.quadraticCurveTo(-s / 2, -s / 2, -s / 2 + r, -s / 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: TILE_H - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.03, 0);
  return geo;
}

export function createTileFactory(scene) {
  const geo = tileGeometry();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#f1d892', roughness: 0.45 });
  const topGeo = new THREE.PlaneGeometry(0.84, 0.84);

  /** Ficha nueva en escena. letter null = boca abajo. */
  function make(letter) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(geo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = TILE_H + 0.004;
    group.add(body, top);
    const tile = { group, top, key: '', letter };
    group.userData.tile = tile;
    scene.add(group);
    skin(tile, letter, '', 'placed', 0);
    return tile;
  }

  /** Cambia la cara. angle: giro de la letra para que la lea quien mira (su asiento). */
  function skin(tile, letter, owner, state, angle, blank = false) {
    tile.top.rotation.z = angle || 0;
    const key = `${letter}|${owner}|${state}|${blank}`;
    if (tile.key === key) return;
    tile.key = key;
    tile.letter = letter;
    tile.blank = blank;
    tile.top.material.map = tileTexture(letter, owner, state, blank);
    tile.top.material.emissive = new THREE.Color(state === 'fresh' ? '#5c4300' : '#000000');
    tile.top.material.needsUpdate = true;
  }

  function dispose(tile) {
    scene.remove(tile.group);
    tile.top.material.dispose();
  }

  return { make, skin, dispose };
}
