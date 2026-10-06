/*
 * Compañeros 3D: el Pokémon de cada jugador, parado en su posición de la
 * mesa sobre un pedestal de su color. Nombre y puntos van en las cámaras.
 *
 * Modelos de Cobblemon (models/, los mismos de Pokémon Party). Si un modelo
 * no carga, queda el pedestal con el sprite del Pokémon como cartel.
 * El modelo mira hacia +Z del grupo; el grupo se gira hacia el tablero.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { tween, ease } from './tween.js';
import { spriteTexture } from './textures.js';

const HEIGHT = 2.8;
const FOOTPRINT = 2.3;

let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('models/models.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch((err) => {
        console.warn('Sin lista de modelos 3D.', err);
        return {};
      });
  }
  return manifestPromise;
}

const loader = new GLTFLoader();
const modelCache = new Map();
function loadGltf(file) {
  if (!modelCache.has(file)) modelCache.set(file, loader.loadAsync(`models/${file}`));
  return modelCache.get(file);
}

export class Companion {
  /** model: nombre en models.json · avatar: número de Pokédex (respaldo con sprite). */
  constructor(model, avatar, color) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.color = color;
    this.phase = Math.random() * 10;
    this.busy = 0;
    this.mixer = null;
    this.actions = {};

    this.baseMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.25, 40), this.baseMat);
    base.position.y = 0.125;
    base.castShadow = true;
    base.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 10, 40), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.25;
    this.root.add(base, rim);
    this.body.position.y = 0.25;

    this.load(model, avatar);
  }

  async load(model, avatar) {
    try {
      const manifest = await loadManifest();
      const entry = manifest[model];
      if (!entry) throw new Error(`sin modelo para ${model}`);
      const gltf = await loadGltf(entry.file);
      // Cada compañero necesita su propia copia (los esqueletos no se comparten).
      const scene = clone(gltf.scene);
      const holder = new THREE.Group();
      holder.rotation.y = THREE.MathUtils.degToRad(entry.rotationY || 0);
      holder.add(scene);
      this.body.add(holder);
      scene.traverse((m) => {
        if (m.isMesh) m.castShadow = true;
        const name = (m.name || '').toLowerCase();
        if (name.includes('emote') || name.startsWith('eyelid')) m.visible = false;
      });
      this.setupAnimations(scene, gltf.animations || [], entry.animations || {});
      this.fit(scene, holder, entry.scale || 1);
    } catch (err) {
      console.warn('No se pudo cargar el compañero 3D; se muestra su sprite.', err);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture(avatar), transparent: true }));
      sprite.scale.set(2.4, 2.4, 1);
      sprite.position.y = 1.2;
      this.body.add(sprite);
    }
  }

  setupAnimations(model, animations, clips) {
    if (!animations.length) return;
    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(clips)) {
      const clip = animations.find((a) => a.name === name);
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    if (!this.actions.idle) this.actions.idle = this.mixer.clipAction(animations.find((a) => /idle/i.test(a.name)) || animations[0]);
    this.actions.idle.play();
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.oneShot) return;
      this.oneShot = null;
      e.action.fadeOut(0.2);
      this.actions.idle.reset().fadeIn(0.2).play();
    });
  }

  fit(model, holder, extraScale) {
    if (this.mixer) this.mixer.update(0);
    this.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const k = Math.min(HEIGHT / (size.y || 1), FOOTPRINT / (Math.max(size.x, size.z) || 1)) * extraScale;
    model.scale.multiplyScalar(k);
    this.root.updateWorldMatrix(true, true);
    box.setFromObject(model, true);
    const c = holder.worldToLocal(box.getCenter(new THREE.Vector3()));
    const minY = holder.worldToLocal(new THREE.Vector3(box.min.x, box.min.y, box.min.z)).y;
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= minY;
  }

  /** Una animación una vez (happy, cry) y vuelve a reposo. */
  play(key) {
    const action = this.actions[key] || this.actions.happy || this.actions.cry;
    if (!action || !this.actions.idle) return;
    this.actions.idle.fadeOut(0.15);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.15).play();
    this.oneShot = action;
  }

  setActive(on) {
    this.active = on;
  }

  /** Salto (con giro opcional) estirándose y aplastándose. */
  async hop(height = 1.2, ms = 620, spin = 0) {
    this.busy++;
    try {
      await tween(150, (t) => this.body.scale.set(1 + 0.15 * t, 1 - 0.2 * t, 1 + 0.15 * t), ease.out);
      await tween(ms, (t) => {
        this.body.position.y = 0.25 + 4 * height * t * (1 - t);
        this.body.rotation.y = spin * t;
        const s = Math.sin(t * Math.PI);
        this.body.scale.set(1 - 0.08 * s, 1 + 0.16 * s, 1 - 0.08 * s);
      }, ease.linear);
      await tween(130, (t) => {
        const k = Math.sin(t * Math.PI);
        this.body.scale.set(1 + 0.18 * k, 1 - 0.22 * k, 1 + 0.18 * k);
      }, ease.linear);
    } finally {
      this.busy--;
      this.body.position.y = 0.25;
      this.body.rotation.y = 0;
      this.body.scale.set(1, 1, 1);
    }
  }

  /** Festejo al crear un Pokémon: salto con giro y animación. */
  celebrate() {
    this.play('happy');
    return this.hop(1.3, 640, Math.PI * 2);
  }

  /** Le toca: saluda con un salto y su grito. */
  greet() {
    this.play('cry');
    return this.hop(0.8, 480);
  }

  /** Desde dónde lanza la Poké Ball (a la altura de la cabeza). */
  throwPoint() {
    return this.root.position.clone().add(new THREE.Vector3(0, HEIGHT * 0.8, 0));
  }

  update(dt, t) {
    if (this.mixer) this.mixer.update(dt);
    this.baseMat.emissiveIntensity = this.active ? 0.4 + Math.sin(t * 5) * 0.3 : 0;
    // De vez en cuando, una animación al azar para que la mesa tenga vida.
    if (!this.busy && !this.oneShot && Math.random() < dt * 0.04) this.play(Math.random() < 0.5 ? 'happy' : 'cry');
    if (!this.busy) {
      const b = Math.sin(t * 3 + this.phase);
      this.body.scale.set(1 + b * 0.012, 1 - b * 0.016, 1 + b * 0.012);
    }
  }
}
