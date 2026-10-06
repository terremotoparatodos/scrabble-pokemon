/*
 * Secuencia «¡Creaste a …!» en 3D: el compañero lanza una Poké Ball sobre
 * la palabra, la Poké Ball rebota, se abre con un destello y sale el Pokémon
 * (su sprite) con su nombre y los puntos.
 */
import * as THREE from 'three';
import { tween, ease, wait } from './tween.js';
import { bannerTexture, spriteTexture } from './textures.js';
import { sparks, confetti } from './particles.js';

/** Poké Ball 3D: mitad de abajo fija y tapa con bisagra atrás. */
function makePokeBall() {
  const r = 0.42;
  const ball = new THREE.Group();
  // Al abrirse se ve el interior de ambas mitades: dibujar las dos caras.
  const white = new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.35, side: THREE.DoubleSide });
  const red = new THREE.MeshStandardMaterial({ color: '#e3350d', roughness: 0.3, side: THREE.DoubleSide });
  const black = new THREE.MeshStandardMaterial({ color: '#1f2933', roughness: 0.5 });
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
  const lid = new THREE.Group(); // pivote en la bisagra (atrás)
  lid.position.set(0, 0, -r);
  const top = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), red);
  top.position.set(0, 0, r);
  lid.add(top);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 8, 32), black);
  band.rotation.x = Math.PI / 2;
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), white);
  button.rotation.x = Math.PI / 2;
  button.position.z = r;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 20), black);
  ring.position.z = r + 0.02;
  ball.add(bottom, lid, band, button, ring);
  ball.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });
  return { ball, lid };
}

/**
 * Corre la secuencia. from: desde dónde se lanza (el compañero) · to: centro
 * de la palabra · pushEffect: agrega partículas al bucle de la escena.
 */
export async function createdSequence(scene, { from, to, id, name, score, color, pushEffect }) {
  const { ball, lid } = makePokeBall();
  window.GameAudio?.play('throw');
  ball.position.copy(from);
  scene.add(ball);
  const land = to.clone().setY(to.y + 0.42);

  // Lanzamiento en arco, girando
  await tween(780, (t) => {
    ball.position.lerpVectors(from, land, t);
    ball.position.y += Math.sin(t * Math.PI) * 5;
    ball.rotation.x = -t * Math.PI * 4;
  }, ease.linear);
  ball.rotation.set(0, Math.atan2(-to.x, 20 - to.z), 0); // la tapa hacia la cámara
  // Dos rebotes cortos y un temblor
  await tween(260, (t) => (ball.position.y = land.y + Math.sin(t * Math.PI) * 0.7), ease.linear);
  await tween(180, (t) => (ball.position.y = land.y + Math.sin(t * Math.PI) * 0.25), ease.linear);
  await tween(360, (t) => (ball.rotation.z = Math.sin(t * Math.PI * 4) * 0.35 * (1 - t)), ease.linear);

  // Se abre con un destello
  window.GameAudio?.play('open');
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.copy(land);
  scene.add(flash);
  pushEffect(sparks(scene, land, '#ffffff', 34));
  pushEffect(confetti(scene, land, color));
  const opening = tween(260, (t) => (lid.rotation.x = -1.9 * t), ease.outBack);
  await tween(380, (t) => {
    flash.scale.setScalar(0.2 + t * 3.2);
    flash.material.opacity = 1 - t;
  }, ease.out);
  await opening;
  scene.remove(flash);
  flash.geometry.dispose();
  flash.material.dispose();

  // Sale el Pokémon
  window.GameAudio?.play('capture');
  const group = new THREE.Group();
  group.position.copy(land);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture(id), transparent: true, depthTest: false }));
  sprite.renderOrder = 20;
  const banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: bannerTexture(name, `+${score} puntos`), transparent: true, depthTest: false }));
  banner.renderOrder = 21;
  group.add(sprite, banner);
  scene.add(group);
  const shrinkBall = tween(500, (t) => ball.scale.setScalar(1 - t), ease.in);
  await tween(650, (t) => {
    const s = 6.4 * t;
    sprite.scale.set(s, s, 1);
    sprite.position.y = 4.2 * t;
    banner.scale.set(8 * t, 2.03 * t, 1);
    banner.position.y = 0.5 + 0.9 * t;
  }, ease.outBack);
  await shrinkBall;
  scene.remove(ball);
  const materials = new Set();
  ball.traverse((m) => {
    if (!m.isMesh) return;
    m.geometry.dispose();
    materials.add(m.material);
  });
  materials.forEach((material) => material.dispose());
  await tween(1700, (t) => {
    sprite.position.y = 4.2 + Math.sin(t * Math.PI * 2) * 0.18;
    sprite.material.rotation = Math.sin(t * Math.PI * 4) * 0.05;
  }, ease.linear);
  await tween(450, (t) => {
    sprite.material.opacity = 1 - t;
    banner.material.opacity = 1 - t;
    sprite.position.y = 4.2 + t * 1.5;
  }, ease.in);
  scene.remove(group);
  sprite.material.map.dispose();
  sprite.material.dispose();
  banner.material.map.dispose();
  banner.material.dispose();
  await wait(0);
}
