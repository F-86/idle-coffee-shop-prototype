import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
// Registers the scene ray-picking extension used by physical shop controls.
import '@babylonjs/core/Culling/ray.js';
import type { Counter, CounterId, Customer, SliceState } from '../core/types';

export type CoffeeSceneAction =
  | { type: 'invite' }
  | { type: 'counter'; id: CounterId }
  | { type: 'menu'; id: CounterId };

/** The optional engine is a QA seam; normal callers only supply canvas and action callback. */
export interface CoffeeSceneOptions { engine?: AbstractEngine; shadows?: boolean }

type Shape = 'box' | 'cylinder' | 'sphere' | 'ring';
type Label = { mesh: Mesh; texture: DynamicTexture | null; key: string };
type Person = {
  root: TransformNode;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftLeg: TransformNode;
  rightLeg: TransformNode;
  cup: TransformNode;
  shadow: Mesh;
  previousX: number;
  previousZ: number;
};
type Station = {
  root: TransformNode;
  barista: Person;
  progressRoot: Mesh;
  progressFill: Mesh;
  plaque: Label;
  menu: Label;
  cashLabel: Label;
  cash: TransformNode[];
  machineExtras: TransformNode[];
  readyCup: TransformNode;
  selection: Mesh;
  level: number;
  recipe: string;
};

const COLORS = {
  cream: '#efe9d9', tile: '#e7ddc8', tileLight: '#eee6d6', tileWarm: '#e8decc',
  dark: '#253c3a', wood: '#b47b50', woodLight: '#cd9362', woodDark: '#815337',
  metal: '#eeeae0', steel: '#809b96', gold: '#d5a54c', teal: '#4c9b96',
  tealDark: '#286c67', rose: '#d98b98', roseDark: '#985664', leaf: '#609678',
  money: '#7eb674', moneyDark: '#477d53', ink: '#314744',
};
const SKINS = ['#e6b88d', '#bb855e', '#f1ccb0', '#916247', '#d9a780'];
const SHIRTS = ['#c86e5d', '#5c9ca6', '#d3ac50', '#8b84ae', '#779f74', '#c28798'];
const HAIR = ['#3d3531', '#6c4531', '#d5b677', '#493b49', '#aba99d'];
const TAU = Math.PI * 2;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const cashText = (cents: number) => `¤ ${(cents / 100).toFixed(2)}`;

/**
 * Original, asset-free coffee-shop diorama. It only presents snapshots: all movement,
 * cash, recipes, cooldowns and upgrades remain owned by the renderer-independent core.
 */
export class CoffeeScene {
  readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly onAction: (action: CoffeeSceneAction) => void;
  private readonly engine: AbstractEngine;
  private readonly ownsEngine: boolean;
  private readonly camera: FreeCamera;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly shapes = new Map<Shape, Mesh>();
  private readonly customers = new Map<number, Person>();
  private readonly stations = new Map<CounterId, Station>();
  private readonly labels: Label[] = [];
  private readonly manager: Person;
  private readonly cartCash: TransformNode[] = [];
  private readonly invite: Label;
  private readonly vaultLamp: Mesh;
  private readonly shadowGenerator: ShadowGenerator | null;
  private disposed = false;
  private animationTime = 0;
  private lastInviteKey = '';
  private selected: CounterId | null = null;
  private down: { id: number; x: number; y: number; time: number; dragged: boolean } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onAction: (action: CoffeeSceneAction) => void,
    options: CoffeeSceneOptions = {},
  ) {
    this.canvas = canvas;
    this.onAction = onAction;
    this.ownsEngine = !options.engine;
    this.engine = options.engine ?? new Engine(canvas, true, { stencil: true, powerPreference: 'high-performance' }, false);
    if (!options.engine && typeof window !== 'undefined') {
      this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.75));
    }
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#e6ece5ff');
    this.scene.ambientColor = Color3.FromHexString('#f6ecd7');
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.scene.imageProcessingConfiguration.contrast = 1.02;
    this.camera = new FreeCamera('fixed-isometric-camera', new Vector3(14, 18, 20), this.scene);
    this.camera.setTarget(new Vector3(-0.5, 0.75, 1.75));
    this.camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 90;
    this.scene.activeCamera = this.camera;
    // Deliberately no attachControl: scrolling/touch dragging belongs to the viewport.
    const ambient = new HemisphericLight('soft-skylight', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.84;
    ambient.groundColor = Color3.FromHexString('#b3aaa1');
    const sun = new DirectionalLight('warm-window-light', new Vector3(0.5, -1, -0.55), this.scene);
    sun.position = new Vector3(-7, 16, 10);
    sun.intensity = 0.75;
    sun.diffuse = Color3.FromHexString('#fff3df');
    this.shadowGenerator = options.shadows === false || !this.ownsEngine ? null : new ShadowGenerator(1024, sun);
    if (this.shadowGenerator) {
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_LOW;
      this.shadowGenerator.bias = 0.002;
      this.shadowGenerator.normalBias = 0.03;
      this.shadowGenerator.darkness = 0.2;
    }
    this.makeEnvironment();
    this.stations.set('counter-a', this.makeStation('counter-a', 0, COLORS.teal, COLORS.tealDark, 'A'));
    this.stations.set('counter-b', this.makeStation('counter-b', 5, COLORS.rose, COLORS.roseDark, 'B'));
    this.invite = this.makeEntrance();
    this.vaultLamp = this.makeVault();
    this.manager = this.makePerson('manager', 1, '#e0ad52', false, true);
    this.manager.root.position.set(-8, 0, -1.7);
    this.manager.root.scaling.setAll(0.97);
    this.makeCart(this.manager.root);
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleCancel);
    canvas.addEventListener('lostpointercapture', this.handleCancel);
    this.resize();
  }

  /** Advances presentation only; the caller supplies the authoritative snapshot each frame. */
  update(state: Readonly<SliceState>, dt: number): void {
    if (this.disposed) return;
    const frame = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    if (!state.paused) this.animationTime += frame;
    const motion = state.paused ? 0 : frame;
    for (const counter of state.counters) {
      const station = this.stations.get(counter.id);
      if (station) this.updateStation(station, counter, state.paused);
    }
    const live = new Set<number>();
    for (const customer of state.customers) {
      live.add(customer.id);
      let person = this.customers.get(customer.id);
      if (!person) {
        person = this.makePerson(`customer-${customer.id}`, customer.skin, SHIRTS[customer.skin % SHIRTS.length] ?? SHIRTS[0], true);
        person.root.position.set(customer.x, 0, customer.z);
        person.previousX = customer.x;
        person.previousZ = customer.z;
        person.root.rotation.y = Math.PI;
        this.customers.set(customer.id, person);
      }
      this.updateCustomer(person, customer, motion);
    }
    for (const [id, person] of this.customers) {
      if (!live.has(id)) {
        // Remove shadow-list entries before disposing a complete character hierarchy.
        this.removeCasterTree(person.root);
        person.root.dispose(false, false);
        person.shadow.dispose(false, false);
        this.customers.delete(id);
      }
    }
    this.updateManager(state, motion);
    const inviteKey = state.inviteCooldown > 0 ? `wait-${Math.ceil(state.inviteCooldown)}` : 'ready';
    if (inviteKey !== this.lastInviteKey) {
      this.paintLabel(this.invite, inviteKey, (ctx, w, h) => {
        this.roundRect(ctx, 8, 8, w - 16, h - 16, 30, state.inviteCooldown > 0 ? '#a89973' : '#dca84b');
        this.text(ctx, state.inviteCooldown > 0 ? `NEXT GUEST · ${Math.ceil(state.inviteCooldown)}s` : 'INVITE A GUEST  +', w / 2, h / 2 + 2, 46, '#ffffff');
      });
      this.lastInviteKey = inviteKey;
    }
    this.vaultLamp.material = this.material(state.manager.phase === 'depositing' && state.manager.carrying > 0 ? '#f6dc79' : '#92bfa3', true);
    this.scene.render();
  }

  selectedCounter(id: CounterId | null): void {
    if (this.disposed) return;
    this.selected = id;
    for (const [stationId, station] of this.stations) station.selection.setEnabled(stationId === id);
  }

  resize(): void {
    if (this.disposed) return;
    this.engine.resize();
    const aspect = Math.max(0.5, this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight()));
    // Preserve the complete shop's horizontal field of view in a panoramic viewport.
    const halfWidth = 12.7;
    const halfHeight = Math.max(7.8, halfWidth / aspect);
    this.camera.orthoLeft = -halfHeight * aspect;
    this.camera.orthoRight = halfHeight * aspect;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.down = null;
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    this.canvas.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointercancel', this.handleCancel);
    this.canvas.removeEventListener('lostpointercapture', this.handleCancel);
    this.shadowGenerator?.dispose();
    // Shared materials and geometries are disposed once with the scene, not per character.
    this.scene.dispose();
    if (this.ownsEngine) this.engine.dispose();
    this.customers.clear();
    this.stations.clear();
    this.materials.clear();
    this.shapes.clear();
    this.labels.length = 0;
  }

  private readonly handleDown = (event: PointerEvent): void => {
    if (this.disposed || !event.isPrimary || event.button !== 0) return;
    this.down = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, dragged: false };
  };
  private readonly handleMove = (event: PointerEvent): void => {
    if (!this.down || event.pointerId !== this.down.id) return;
    if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 9) this.down.dragged = true;
  };
  private readonly handleCancel = (): void => { this.down = null; };
  private readonly handleUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (this.disposed || !down || event.pointerId !== down.id || down.dragged || event.timeStamp - down.time > 800) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Babylon's picking ray converts CSS coordinates to framebuffer pixels itself.
    // Applying DPR here again would miss targets on Retina/high-density displays.
    const scale = this.engine.getHardwareScalingLevel();
    const x = (event.clientX - rect.left) * this.engine.getRenderWidth() * scale / rect.width;
    const y = (event.clientY - rect.top) * this.engine.getRenderHeight() * scale / rect.height;
    const pick = this.scene.pick(x, y, mesh => Boolean(mesh.metadata?.coffeeAction), false, this.camera);
    const action = pick?.pickedMesh?.metadata?.coffeeAction as CoffeeSceneAction | undefined;
    if (pick?.hit && action) this.onAction(action);
  };

  private material(hex: string, glowing = false, alpha = 1): StandardMaterial {
    const key = `${hex}:${glowing}:${alpha}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const mat = new StandardMaterial(`material-${key}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(0.07, 0.07, 0.07);
    mat.emissiveColor = glowing ? Color3.FromHexString(hex).scale(0.68) : Color3.Black();
    mat.alpha = alpha;
    this.materials.set(key, mat);
    return mat;
  }

  private shape(kind: Shape, name: string, size: Vector3, position: Vector3, color: string, parent?: TransformNode, shadow = true): Mesh {
    let base = this.shapes.get(kind);
    if (!base) {
      if (kind === 'box') base = CreateBox(`shared-${kind}`, { size: 1 }, this.scene);
      else if (kind === 'cylinder') base = CreateCylinder(`shared-${kind}`, { height: 1, diameter: 1, tessellation: 12 }, this.scene);
      else if (kind === 'ring') base = CreateTorus(`shared-${kind}`, { diameter: 1, thickness: 0.035, tessellation: 24 }, this.scene);
      else base = CreateSphere(`shared-${kind}`, { diameter: 1, segments: 4 }, this.scene);
      base.isVisible = false;
      base.isPickable = false;
      this.shapes.set(kind, base);
    }
    const mesh = base.clone(name, parent ?? null, true)!;
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.scaling.copyFrom(size);
    mesh.position.copyFrom(position);
    mesh.material = this.material(color);
    if (shadow) this.shadowGenerator?.addShadowCaster(mesh, false);
    return mesh;
  }

  private box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, color: string, parent?: TransformNode, shadow = true): Mesh {
    return this.shape('box', name, new Vector3(w, h, d), new Vector3(x, y, z), color, parent, shadow);
  }
  private cylinder(name: string, diameter: number, height: number, x: number, y: number, z: number, color: string, parent?: TransformNode, shadow = true): Mesh {
    return this.shape('cylinder', name, new Vector3(diameter, height, diameter), new Vector3(x, y, z), color, parent, shadow);
  }

  private makeEnvironment(): void {
    const base = this.box('shop-plinth', 19.5, 0.42, 12.45, -0.5, -0.28, 2, '#b1bba8', undefined, false);
    base.receiveShadows = true;
    for (let ix = 0; ix < 10; ix++) {
      for (let iz = 0; iz < 6; iz++) {
        const color = [COLORS.tile, COLORS.tileLight, COLORS.tileWarm][(ix + iz * 2) % 3];
        const tile = this.box(`floor-${ix}-${iz}`, 1.88, 0.07, 1.98, -9.05 + ix * 1.9, -0.03, -2.98 + iz * 2, color, undefined, false);
        tile.receiveShadows = true;
      }
    }
    this.box('rear-wall', 19.45, 3.8, 0.22, -0.5, 1.9, -3.72, COLORS.cream);
    this.box('rear-wainscot', 19.4, 1.22, 0.1, -0.5, 0.62, -3.57, COLORS.tealDark);
    this.box('rear-wall-cap', 19.65, 0.16, 0.4, -0.5, 3.84, -3.72, COLORS.woodLight);
    this.box('wall-chair-rail', 19.5, 0.12, 0.17, -0.5, 1.24, -3.53, COLORS.woodLight);
    for (let x = -9.5; x < 9; x += 0.72) this.box(`wall-panel-${x}`, 0.024, 1.1, 0.04, x, 0.64, -3.49, '#3f7b71', undefined, false);
    this.box('left-low-wall', 0.22, 1.25, 4.9, -10.12, 0.63, -1.4, COLORS.cream);
    this.box('left-wall-cap', 0.35, 0.1, 4.99, -10.12, 1.3, -1.4, COLORS.woodLight);
    // The back-of-house route visually separates the cash manager from customer queues.
    this.box('manager-route', 16.5, 0.018, 0.86, -1.65, 0.027, -1.7, '#d4d2b8', undefined, false);
    for (let x = -8.5; x < 7; x += 1.1) this.box(`route-dash-${x}`, 0.4, 0.022, 0.055, x, 0.041, -1.75, '#f7f1dc', undefined, false);
    const brand = this.makeLabel('brand-sign', 3.9, 0.72, new Vector3(-6.45, 2.92, -3.42));
    this.paintLabel(brand, 'brand', (ctx, w, h) => {
      this.roundRect(ctx, 8, 8, w - 16, h - 16, 20, '#315d54');
      this.text(ctx, 'MELLOW BEAN', w / 2, h / 2 - 13, 46, '#fff5df');
      this.text(ctx, 'a little coffee, a lot of care', w / 2, h / 2 + 42, 23, '#b9d0b6');
    });
    this.makePlant('tall-plant-left', -9.08, -2.65, 1.12);
    this.makePlant('plant-right', 8.0, -2.55, 0.85);
    this.makePlant('entrance-plant', -9.0, 2.55, 0.7);
    this.makeBench();
    for (const [x, shade] of [[0, COLORS.teal], [5, COLORS.rose]] as const) {
      const rug = this.box(`queue-rug-${x}`, 2.33, 0.035, 5.55, x, 0.033, 3.76, '#fcf7e9', undefined, false);
      rug.receiveShadows = true;
      const center = this.box(`queue-rug-color-${x}`, 2.08, 0.039, 5.3, x, 0.055, 3.76, shade, undefined, false);
      center.receiveShadows = true;
      for (let z = 1.9; z < 6.4; z += 1.0) {
        const ring = this.shape('ring', `queue-position-${x}-${z}`, new Vector3(0.73, 0.3, 0.73), new Vector3(x, 0.089, z), '#f1e4d1', undefined, false);
        ring.material = this.material('#f1e4d1', false, 0.33);
      }
      const left = this.box(`queue-arrow-l-${x}`, 0.35, 0.02, 0.065, x - 0.12, 0.089, 6.11, '#fff7e9', undefined, false);
      const right = this.box(`queue-arrow-r-${x}`, 0.35, 0.02, 0.065, x + 0.12, 0.089, 6.11, '#fff7e9', undefined, false);
      left.rotation.y = -Math.PI / 4;
      right.rotation.y = Math.PI / 4;
    }
    // A small welcome runner leads towards the two lanes without blocking the entrance.
    this.box('welcome-runner', 4.0, 0.022, 1.1, -4.5, 0.025, 5.3, '#d5ccb4', undefined, false);
  }

  private makeStation(id: CounterId, x: number, accent: string, deep: string, letter: string): Station {
    const root = new TransformNode(`${id}-station`, this.scene);
    root.position.x = x;
    this.box(`${id}-body`, 3.4, 1.04, 1.34, 0, 0.55, 0, COLORS.wood, root);
    this.box(`${id}-toe`, 3.25, 0.15, 1.25, 0, 0.08, 0, COLORS.woodDark, root);
    for (let i = 0; i < 7; i++) this.box(`${id}-wood-slat-${i}`, 0.36, 0.86, 0.03, -1.42 + i * 0.475, 0.57, 0.68, i % 2 ? COLORS.woodLight : '#bc8458', root, false);
    this.box(`${id}-countertop`, 3.65, 0.16, 1.58, 0, 1.13, 0, COLORS.metal, root);
    this.box(`${id}-top-inset`, 3.38, 0.025, 1.33, 0, 1.222, 0, '#d5d6c9', root, false);
    this.box(`${id}-front-accent`, 3.48, 0.08, 0.08, 0, 0.94, 0.716, deep, root, false);
    const plaque = this.makeLabel(`${id}-upgrade-plaque`, 2.7, 0.53, new Vector3(0, 0.57, 0.72), root, { type: 'counter', id });
    const selection = this.box(`${id}-selected`, 3.83, 0.022, 1.77, 0, 0.038, 0, '#e9c96e', root, false);
    selection.material = this.material('#e9c96e', true, 0.83);
    selection.setEnabled(false);
    const boardFrame = this.box(`${id}-menu-frame`, 3.52, 2.1, 0.17, x, 2.42, -3.45, COLORS.woodDark);
    boardFrame.isPickable = true;
    boardFrame.metadata = { coffeeAction: { type: 'menu', id } };
    const menu = this.makeLabel(`${id}-menu`, 3.3, 1.9, new Vector3(x, 2.42, -3.33), undefined, { type: 'menu', id }, 768, 448);
    const barista = this.makePerson(`${id}-barista`, id === 'counter-a' ? 2 : 3, accent, false);
    barista.root.position.set(x - 0.5, 0, -0.89);
    barista.root.scaling.setAll(1.09);
    this.box(`${id}-barista-apron`, 0.46, 0.48, 0.035, 0, 0.83, 0.23, deep, barista.root);
    this.box(`${id}-apron-pocket`, 0.24, 0.13, 0.022, 0, 0.77, 0.259, accent, barista.root, false);
    this.cylinder(`${id}-barista-hat`, 0.61, 0.16, 0, 1.78, 0, '#f9f0da', barista.root);
    this.box(`${id}-hat-band`, 0.64, 0.07, 0.55, 0, 1.71, 0, deep, barista.root);
    const machine = new TransformNode(`${id}-machine`, this.scene);
    machine.parent = root;
    machine.position.set(0.2, 1.23, -0.15);
    this.box(`${id}-machine-base`, 1.47, 0.1, 0.67, 0, 0.04, 0, COLORS.steel, machine);
    this.box(`${id}-machine-body`, 1.25, 0.49, 0.46, 0, 0.32, -0.08, COLORS.metal, machine);
    this.box(`${id}-machine-face`, 1.2, 0.15, 0.028, 0, 0.36, 0.16, deep, machine);
    this.box(`${id}-machine-drip-tray`, 1.23, 0.035, 0.22, 0, 0.102, 0.22, '#4d615c', machine, false);
    this.cylinder(`${id}-bean-hopper`, 0.32, 0.29, -0.36, 0.705, -0.12, '#6a4b38', machine);
    this.cylinder(`${id}-hopper-lid`, 0.36, 0.055, -0.36, 0.87, -0.12, COLORS.woodDark, machine);
    for (let spout = 0; spout < 2; spout++) {
      this.box(`${id}-spout-${spout}`, 0.065, 0.14, 0.1, -0.15 + spout * 0.36, 0.235, 0.24, COLORS.steel, machine);
      this.box(`${id}-handle-${spout}`, 0.2, 0.055, 0.075, -0.2 + spout * 0.36, 0.294, 0.24, COLORS.dark, machine);
    }
    const dial = this.cylinder(`${id}-pressure-gauge`, 0.18, 0.028, 0.4, 0.44, 0.177, COLORS.dark, machine, false);
    dial.rotation.x = Math.PI / 2;
    const dialFace = this.cylinder(`${id}-gauge-face`, 0.14, 0.03, 0.4, 0.44, 0.195, '#f8f5df', machine, false);
    dialFace.rotation.x = Math.PI / 2;
    this.box(`${id}-gauge-hand`, 0.013, 0.064, 0.034, 0.42, 0.45, 0.22, COLORS.roseDark, machine, false).rotation.z = -0.65;
    const extras: TransformNode[] = [];
    const copper = new TransformNode(`${id}-upgrade-copper`, this.scene);
    copper.parent = machine;
    this.cylinder(`${id}-copper-boiler`, 0.34, 0.39, 0.36, 0.78, -0.12, '#c79556', copper);
    this.cylinder(`${id}-copper-cap`, 0.38, 0.055, 0.36, 1.00, -0.12, '#9e7848', copper);
    copper.setEnabled(false);
    extras.push(copper);
    const group = new TransformNode(`${id}-upgrade-group`, this.scene);
    group.parent = machine;
    this.box(`${id}-extra-wing`, 0.39, 0.4, 0.44, 0.77, 0.32, -0.08, COLORS.metal, group);
    this.box(`${id}-extra-accent`, 0.36, 0.13, 0.035, 0.77, 0.36, 0.16, deep, group);
    this.box(`${id}-extra-spout`, 0.06, 0.16, 0.1, 0.77, 0.24, 0.23, COLORS.steel, group);
    group.setEnabled(false);
    extras.push(group);
    const readyCup = this.makeCup(`${id}-ready-cup`, accent, root);
    readyCup.position.set(0.17, 1.235, 0.38);
    readyCup.setEnabled(false);
    for (let cup = 0; cup < 3; cup++) {
      const stacked = this.makeCup(`${id}-stacked-cup-${cup}`, accent, root);
      stacked.position.set(1.23, 1.235 + cup * 0.11, -0.27);
      stacked.scaling.setAll(0.82);
    }
    this.box(`${id}-napkins`, 0.32, 0.075, 0.29, 1.26, 1.258, 0.26, '#fbf8ec', root);
    const cash: TransformNode[] = [];
    for (let pile = 0; pile < 6; pile++) {
      const stack = this.makeCashStack(`${id}-cash-${pile}`, root);
      stack.position.set(-1.16 + (pile % 2) * 0.4, 1.25 + Math.floor(pile / 2) * 0.095, 0.02 - (pile % 2) * 0.2);
      stack.setEnabled(false);
      cash.push(stack);
    }
    const cashLabel = this.makeLabel(`${id}-cash-total`, 1.65, 0.32, new Vector3(x - 1.0, 1.9, 0.07), undefined, undefined, 512, 112, true);
    cashLabel.mesh.setEnabled(false);
    const progressRoot = CreatePlane(`${id}-progress`, { width: 2.15, height: 0.14, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    progressRoot.position.set(x, 2.61, -0.08);
    progressRoot.billboardMode = Mesh.BILLBOARDMODE_ALL;
    progressRoot.material = this.material('#faf5e5', true);
    progressRoot.isPickable = false;
    const progressFill = this.box(`${id}-progress-fill`, 1, 0.075, 0.021, -0.98, 0, -0.025, accent, progressRoot, false);
    progressFill.material = this.material(accent, true);
    progressRoot.setEnabled(false);
    // The whole counter and its physical plaque share the same intended action.
    const counterHit = this.box(`${id}-counter-hit`, 3.5, 1.16, 1.43, 0, 0.61, 0, '#ffffff', root, false);
    counterHit.material = this.material('#ffffff', false, 0);
    counterHit.isPickable = true;
    counterHit.metadata = { coffeeAction: { type: 'counter', id } };
    const station: Station = { root, barista, progressRoot, progressFill, plaque, menu, cashLabel, cash, machineExtras: extras, readyCup, selection, level: -1, recipe: '' };
    // Build the initial labels even before the first simulation frame arrives.
    this.updateStation(station, { id, x, level: 1, recipe: letter === 'A' ? 'espresso' : 'latte', pendingCash: 0, brewed: 0, brew: null }, false);
    return station;
  }

  private updateStation(station: Station, counter: Counter, paused: boolean): void {
    if (station.level !== counter.level) {
      this.paintLabel(station.plaque, `level-${counter.level}`, (ctx, w, h) => {
        this.roundRect(ctx, 8, 8, w - 16, h - 16, 24, '#f5d98b');
        this.text(ctx, `${counter.id === 'counter-a' ? 'A' : 'B'}  ·  LEVEL ${counter.level}    ↑`, w / 2, h / 2 + 1, 48, '#5a492b');
      });
      station.machineExtras[0].setEnabled(counter.level >= 2);
      station.machineExtras[1].setEnabled(counter.level >= 6);
      station.level = counter.level;
    }
    if (station.recipe !== counter.recipe) {
      const espresso = counter.recipe === 'espresso';
      this.paintLabel(station.menu, counter.recipe, (ctx, w, h) => {
        this.roundRect(ctx, 1, 1, w - 2, h - 2, 15, '#2e4843');
        this.text(ctx, `COUNTER ${counter.id === 'counter-a' ? 'A' : 'B'}  /  MENU`, w / 2, 61, 30, '#ead4a1');
        ctx.strokeStyle = '#648275'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(62, 90); ctx.lineTo(w - 62, 90); ctx.stroke();
        // A hand-drawn cup graphic is created locally, never retrieved from a reference.
        ctx.fillStyle = espresso ? '#d49c5b' : '#91bab0';
        ctx.beginPath(); ctx.moveTo(w / 2 - 58, 124); ctx.lineTo(w / 2 + 58, 124); ctx.lineTo(w / 2 + 43, 218); ctx.lineTo(w / 2 - 43, 218); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f7ebd7'; ctx.fillRect(w / 2 - 63, 115, 126, 18);
        ctx.fillStyle = '#523c2f'; ctx.fillRect(w / 2 - 50, 139, 100, 18);
        this.text(ctx, espresso ? 'ESPRESSO' : 'LATTE', w / 2, 277, 54, '#faf1db');
        this.text(ctx, espresso ? 'QUICK & BOLD' : 'SLOW & SILKY', w / 2, 331, 26, '#b9cbb7');
        this.roundRect(ctx, 95, 365, w - 190, 55, 14, '#c5a465');
        this.text(ctx, 'CHANGE RECIPE  ↔', w / 2, 393, 27, '#263d35');
      });
      station.recipe = counter.recipe;
    }
    const piles = counter.pendingCash > 0 ? Math.min(6, Math.max(1, Math.ceil(counter.pendingCash / 450))) : 0;
    station.cash.forEach((stack, i) => stack.setEnabled(i < piles));
    station.cashLabel.mesh.setEnabled(counter.pendingCash > 0);
    if (counter.pendingCash > 0) this.paintLabel(station.cashLabel, `${counter.pendingCash}`, (ctx, w, h) => {
      this.roundRect(ctx, 5, 5, w - 10, h - 10, 24, '#f4f5df');
      this.text(ctx, cashText(counter.pendingCash), w / 2, h / 2 + 2, 54, '#477448');
    });
    const brew = counter.brew;
    const progress = brew ? clamp(brew.elapsed / Math.max(0.001, brew.duration)) : 0;
    station.progressRoot.setEnabled(Boolean(brew));
    station.progressFill.scaling.x = Math.max(0.015, progress * 1.98);
    station.progressFill.position.x = -0.99 + station.progressFill.scaling.x / 2;
    station.readyCup.setEnabled(Boolean(brew) && progress > 0.32 && progress < 1);
    if (brew) station.readyCup.scaling.setAll(brew.recipe === 'espresso' ? 0.82 : 1);
    if (!paused) {
      const pulse = Math.sin(this.animationTime * 5.2);
      station.barista.rightArm.rotation.x = brew ? -0.78 + pulse * 0.2 : -0.12;
      station.barista.leftArm.rotation.x = brew ? -0.4 - pulse * 0.15 : -0.12;
      station.barista.root.position.y = brew ? Math.max(0, pulse) * 0.019 : 0;
    }
    station.barista.shadow.position.set(station.barista.root.position.x, 0.039, station.barista.root.position.z);
    station.selection.setEnabled(this.selected === counter.id);
  }

  private makePerson(name: string, skinIndex: number, shirt: string, guest: boolean, manager = false): Person {
    const skin = SKINS[Math.abs(skinIndex) % SKINS.length];
    const hair = HAIR[Math.abs(skinIndex) % HAIR.length];
    const root = new TransformNode(name, this.scene);
    if (guest) root.scaling.setAll(0.88);
    this.box(`${name}-shirt`, 0.58, 0.57, 0.4, 0, 0.95, 0, shirt, root);
    this.box(`${name}-collar`, 0.19, 0.09, 0.046, 0, 1.18, 0.219, '#f7ebdc', root, false);
    this.box(`${name}-head`, 0.57, 0.56, 0.52, 0, 1.52, 0, skin, root);
    this.box(`${name}-hair-top`, 0.61, 0.15, 0.55, 0, 1.795, 0, hair, root);
    this.box(`${name}-hair-back`, 0.59, 0.39, 0.07, 0, 1.615, -0.254, hair, root);
    this.box(`${name}-hair-side`, 0.092, 0.3, 0.52, -0.257, 1.65, 0, hair, root);
    this.box(`${name}-fringe`, 0.37, 0.16, 0.06, -0.088, 1.70, 0.271, hair, root);
    this.box(`${name}-ear-left`, 0.07, 0.14, 0.13, -0.302, 1.49, 0.0, skin, root, false);
    this.box(`${name}-ear-right`, 0.07, 0.14, 0.13, 0.302, 1.49, 0.0, skin, root, false);
    for (const eyeX of [-0.115, 0.115]) {
      this.box(`${name}-eye-${eyeX}`, 0.055, 0.065, 0.017, eyeX, 1.52, 0.27, '#342e2a', root, false);
      this.box(`${name}-brow-${eyeX}`, 0.072, 0.02, 0.02, eyeX, 1.594, 0.27, hair, root, false);
    }
    this.box(`${name}-nose`, 0.065, 0.055, 0.052, 0.005, 1.438, 0.281, skin, root, false);
    this.box(`${name}-smile`, 0.11, 0.022, 0.02, 0, 1.344, 0.27, '#704e3e', root, false);
    const leftArm = new TransformNode(`${name}-left-shoulder`, this.scene); leftArm.parent = root; leftArm.position.set(-0.365, 1.17, 0);
    const rightArm = new TransformNode(`${name}-right-shoulder`, this.scene); rightArm.parent = root; rightArm.position.set(0.365, 1.17, 0);
    for (const [side, arm] of [['left', leftArm], ['right', rightArm]] as const) {
      this.box(`${name}-${side}-sleeve`, 0.17, 0.22, 0.25, 0, -0.10, 0, shirt, arm);
      this.box(`${name}-${side}-arm`, 0.15, 0.32, 0.18, 0, -0.35, 0, skin, arm);
      this.box(`${name}-${side}-hand`, 0.18, 0.17, 0.21, 0, -0.53, 0.015, skin, arm);
    }
    const leftLeg = new TransformNode(`${name}-left-hip`, this.scene); leftLeg.parent = root; leftLeg.position.set(-0.15, 0.70, 0);
    const rightLeg = new TransformNode(`${name}-right-hip`, this.scene); rightLeg.parent = root; rightLeg.position.set(0.15, 0.70, 0);
    for (const [side, leg] of [['left', leftLeg], ['right', rightLeg]] as const) {
      this.box(`${name}-${side}-trouser`, 0.21, 0.49, 0.24, 0, -0.245, 0, manager ? '#384957' : '#485451', leg);
      this.box(`${name}-${side}-shoe`, 0.24, 0.14, 0.37, 0, -0.58, 0.063, guest ? '#f4eddd' : '#51483d', leg);
    }
    if (manager) {
      this.box(`${name}-vest`, 0.52, 0.45, 0.042, 0, 0.96, 0.225, '#425e61', root);
      this.box(`${name}-vest-pocket`, 0.15, 0.10, 0.026, 0.13, 1.02, 0.251, '#e0ad52', root, false);
      this.box(`${name}-cap`, 0.63, 0.18, 0.57, 0, 1.81, 0, '#d6a647', root);
      this.box(`${name}-cap-visor`, 0.52, 0.055, 0.21, 0, 1.745, 0.31, '#a77b31', root);
    } else if (guest && skinIndex % 3 === 0) {
      for (const eyeX of [-0.115, 0.115]) {
        this.box(`${name}-glasses-top-${eyeX}`, 0.15, 0.024, 0.023, eyeX, 1.567, 0.29, '#544839', root, false);
        this.box(`${name}-glasses-bottom-${eyeX}`, 0.15, 0.024, 0.023, eyeX, 1.46, 0.29, '#544839', root, false);
      }
      this.box(`${name}-glasses-bridge`, 0.1, 0.025, 0.024, 0, 1.526, 0.293, '#544839', root, false);
    }
    const cup = this.makeCup(`${name}-takeaway`, '#4f8d78', rightArm);
    cup.position.set(0.015, -0.5, 0.19);
    cup.scaling.setAll(0.85);
    cup.setEnabled(false);
    const shadow = this.shape('cylinder', `${name}-contact-shadow`, new Vector3(0.95, 0.008, 0.65), new Vector3(0, 0.039, 0), '#30433b', undefined, false);
    shadow.material = this.material('#30433b', false, 0.12);
    return { root, leftArm, rightArm, leftLeg, rightLeg, cup, shadow, previousX: 0, previousZ: 0 };
  }

  private updateCustomer(person: Person, customer: Customer, dt: number): void {
    const dx = customer.x - person.previousX;
    const dz = customer.z - person.previousZ;
    const walking = (customer.phase === 'entering' || customer.phase === 'leaving' || Math.hypot(dx, dz) > 0.005) && dt > 0;
    // Position smoothing stays inside one short frame and never alters the simulation.
    const blend = dt > 0 ? 1 - Math.exp(-dt * 24) : 1;
    person.root.position.x += (customer.x - person.root.position.x) * blend;
    person.root.position.z += (customer.z - person.root.position.z) * blend;
    if (Math.hypot(dx, dz) > 0.003 && walking) {
      const target = Math.atan2(dx, dz);
      const current = person.root.rotation.y;
      const delta = ((target - current + Math.PI * 3) % TAU) - Math.PI;
      person.root.rotation.y += delta * Math.min(1, dt * 14);
    } else if (customer.phase === 'queue' || customer.phase === 'serving' || customer.phase === 'receiving') {
      person.root.rotation.y = Math.PI;
    }
    const gait = walking ? Math.sin(this.animationTime * 9 + customer.id * 0.91) * 0.33 : 0;
    if (dt > 0) {
      person.leftLeg.rotation.x = gait;
      person.rightLeg.rotation.x = -gait;
      person.leftArm.rotation.x = -gait * 0.7;
      person.rightArm.rotation.x = customer.hasCup || customer.phase === 'receiving' ? -0.95 : gait * 0.7;
      person.root.position.y = walking ? Math.abs(gait) * 0.035 : Math.sin(this.animationTime * 2 + customer.id) * 0.008;
    }
    person.cup.setEnabled(customer.hasCup || customer.phase === 'receiving');
    // During receipt the outstretched hand makes the actual cup transition legible.
    if (customer.phase === 'receiving' && dt > 0) person.rightArm.rotation.x = -1.13 + Math.sin(this.animationTime * 5) * 0.08;
    person.shadow.position.set(person.root.position.x, 0.04, person.root.position.z);
    person.previousX = customer.x;
    person.previousZ = customer.z;
  }

  private updateManager(state: Readonly<SliceState>, dt: number): void {
    const person = this.manager;
    const manager = state.manager;
    const dx = manager.x - person.previousX;
    const dz = manager.z - person.previousZ;
    const moving = manager.phase === 'moving' && dt > 0;
    const blend = dt > 0 ? 1 - Math.exp(-dt * 24) : 1;
    person.root.position.x += (manager.x - person.root.position.x) * blend;
    person.root.position.z += (manager.z - person.root.position.z) * blend;
    if (moving && Math.hypot(dx, dz) > 0.003) person.root.rotation.y = Math.atan2(dx, dz);
    else if (manager.phase === 'collecting') person.root.rotation.y = 0;
    else if (manager.phase === 'depositing') person.root.rotation.y = -Math.PI / 2;
    if (dt > 0) {
      const gait = moving ? Math.sin(this.animationTime * 10.5) * 0.3 : 0;
      person.leftLeg.rotation.x = gait;
      person.rightLeg.rotation.x = -gait;
      person.leftArm.rotation.x = moving ? -0.75 : -0.25;
      person.rightArm.rotation.x = manager.phase === 'collecting' || manager.phase === 'depositing' ? -1 + Math.sin(this.animationTime * 5) * 0.12 : -0.65;
      person.root.position.y = moving ? Math.abs(gait) * 0.026 : 0;
    }
    const stacks = manager.carrying > 0 ? Math.min(6, Math.max(1, Math.ceil(manager.carrying / 600))) : 0;
    this.cartCash.forEach((cash, i) => cash.setEnabled(i < stacks));
    person.shadow.position.set(person.root.position.x, 0.04, person.root.position.z);
    person.previousX = manager.x;
    person.previousZ = manager.z;
  }

  private makeCup(name: string, sleeve: string, parent?: TransformNode): TransformNode {
    const root = new TransformNode(name, this.scene);
    if (parent) root.parent = parent;
    this.cylinder(`${name}-cup`, 0.215, 0.25, 0, 0.135, 0, '#fcf4e2', root, false);
    this.cylinder(`${name}-sleeve`, 0.223, 0.09, 0, 0.135, 0, sleeve, root, false);
    this.cylinder(`${name}-lid`, 0.245, 0.038, 0, 0.275, 0, '#fdf9ee', root, false);
    this.cylinder(`${name}-sip`, 0.06, 0.012, 0.035, 0.3, 0.035, '#63554c', root, false);
    return root;
  }

  private makeCashStack(name: string, parent: TransformNode): TransformNode {
    const root = new TransformNode(name, this.scene); root.parent = parent;
    this.box(`${name}-notes`, 0.36, 0.073, 0.22, 0, 0.036, 0, COLORS.moneyDark, root, false);
    this.box(`${name}-top`, 0.35, 0.017, 0.21, 0, 0.081, 0, COLORS.money, root, false);
    this.box(`${name}-band`, 0.078, 0.025, 0.218, 0.03, 0.092, 0, '#edf0c0', root, false);
    this.box(`${name}-note-line`, 0.29, 0.007, 0.016, 0, 0.058, 0.112, '#b9d399', root, false);
    return root;
  }

  private makeCart(parent: TransformNode): void {
    const root = new TransformNode('manager-cash-cart', this.scene); root.parent = parent; root.position.set(0.83, 0, 0.08);
    this.box('cart-base', 0.77, 0.12, 0.67, 0, 0.30, 0, '#866748', root);
    this.box('cart-left-rail', 0.065, 0.27, 0.72, -0.37, 0.44, 0, COLORS.gold, root);
    this.box('cart-right-rail', 0.065, 0.27, 0.72, 0.37, 0.44, 0, COLORS.gold, root);
    this.box('cart-front-rail', 0.75, 0.19, 0.065, 0, 0.43, 0.33, COLORS.gold, root);
    this.box('cart-back-rail', 0.75, 0.19, 0.065, 0, 0.43, -0.33, COLORS.gold, root);
    for (const x of [-0.35, 0.35]) {
      for (const z of [-0.24, 0.24]) this.cylinder(`cart-wheel-${x}-${z}`, 0.20, 0.09, x, 0.15, z, '#394844', root).rotation.z = Math.PI / 2;
    }
    this.box('cart-handle-post', 0.045, 0.5, 0.045, -0.38, 0.61, -0.32, COLORS.steel, root);
    this.box('cart-handle', 0.38, 0.06, 0.06, -0.54, 0.85, -0.32, COLORS.dark, root);
    for (let pile = 0; pile < 6; pile++) {
      const stack = this.makeCashStack(`cart-cash-${pile}`, root);
      stack.position.set(-0.19 + (pile % 2) * 0.36, 0.37 + Math.floor(pile / 2) * 0.085, 0);
      stack.setEnabled(false);
      this.cartCash.push(stack);
    }
  }

  private makeEntrance(): Label {
    const pad = this.cylinder('entrance-invite-pad', 2.1, 0.03, -8, 0.03, 5, '#d8b66b', undefined, false);
    pad.receiveShadows = true;
    const edge = this.shape('ring', 'entrance-pad-border', new Vector3(2.04, 0.8, 2.04), new Vector3(-8, 0.057, 5), '#f9e6b1', undefined, false);
    edge.material = this.material('#f9e6b1', true);
    this.box('entry-sign-post-left', 0.11, 1.16, 0.11, -8.68, 0.59, 5.62, COLORS.woodDark);
    this.box('entry-sign-post-right', 0.11, 1.16, 0.11, -7.32, 0.59, 5.62, COLORS.woodDark);
    const label = this.makeLabel('invite-guest-sign', 2.48, 0.56, new Vector3(-8, 1.48, 5.62), undefined, { type: 'invite' }, 768, 176, true);
    const hit = CreatePlane('invite-touch-target', { width: 2.9, height: 1.4, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    hit.position.copyFrom(label.mesh.position);
    hit.position.y -= 0.2;
    hit.billboardMode = Mesh.BILLBOARDMODE_ALL;
    hit.material = this.material('#ffffff', false, 0);
    hit.isPickable = true;
    hit.metadata = { coffeeAction: { type: 'invite' } };
    this.paintLabel(label, 'ready', (ctx, w, h) => {
      this.roundRect(ctx, 8, 8, w - 16, h - 16, 30, '#dca84b');
      this.text(ctx, 'INVITE A GUEST  +', w / 2, h / 2 + 2, 46, '#ffffff');
    });
    this.box('entry-arrow-stem', 0.62, 0.019, 0.14, -7.4, 0.066, 5.01, '#fff4da', undefined, false);
    const arrow = this.box('entry-arrow-top', 0.32, 0.019, 0.11, -7.15, 0.067, 4.89, '#fff4da', undefined, false); arrow.rotation.y = Math.PI / 4;
    const arrow2 = this.box('entry-arrow-bottom', 0.32, 0.019, 0.11, -7.15, 0.067, 5.13, '#fff4da', undefined, false); arrow2.rotation.y = -Math.PI / 4;
    pad.isPickable = true; pad.metadata = { coffeeAction: { type: 'invite' } };
    return label;
  }

  private makeVault(): Mesh {
    const vault = new TransformNode('cash-vault', this.scene); vault.position.set(-8.5, 0, -1.8);
    this.box('vault-foot', 1.63, 0.13, 1.09, 0, 0.1, 0, COLORS.woodDark, vault);
    this.box('vault-body', 1.48, 1.28, 0.88, 0, 0.77, 0, '#466660', vault);
    this.box('vault-door', 1.26, 1.06, 0.08, 0, 0.79, 0.48, '#739286', vault);
    this.box('vault-door-inset', 1.04, 0.86, 0.035, 0, 0.78, 0.534, '#405f58', vault);
    const wheel = this.cylinder('vault-wheel', 0.34, 0.072, 0, 0.78, 0.594, '#d8be76', vault); wheel.rotation.x = Math.PI / 2;
    this.box('vault-wheel-spoke', 0.29, 0.065, 0.045, 0, 0.78, 0.642, '#775d35', vault, false);
    this.box('vault-slot', 0.54, 0.063, 0.07, 0, 1.13, 0.55, '#213e37', vault, false);
    const label = this.makeLabel('vault-bank-label', 1.55, 0.37, new Vector3(-8.5, 1.78, -1.35), undefined, undefined, 512, 128, true);
    this.paintLabel(label, 'bank', (ctx, w, h) => {
      this.roundRect(ctx, 6, 6, w - 12, h - 12, 22, '#f1dd9f');
      this.text(ctx, 'CASH VAULT', w / 2, h / 2 + 1, 42, '#405a45');
    });
    const lamp = this.cylinder('vault-deposit-light', 0.12, 0.045, 0.48, 1.14, 0.56, '#92bfa3', vault, false); lamp.rotation.x = Math.PI / 2;
    return lamp;
  }

  private makePlant(name: string, x: number, z: number, scale: number): void {
    const root = new TransformNode(name, this.scene); root.position.set(x, 0, z); root.scaling.setAll(scale);
    this.cylinder(`${name}-pot`, 0.6, 0.47, 0, 0.24, 0, '#d6b79a', root);
    this.cylinder(`${name}-rim`, 0.65, 0.12, 0, 0.48, 0, '#eed6b4', root);
    this.cylinder(`${name}-soil`, 0.52, 0.018, 0, 0.55, 0, '#5c513f', root, false);
    this.cylinder(`${name}-stem`, 0.062, 0.92, 0, 0.98, 0, '#779269', root);
    for (let leaf = 0; leaf < 7; leaf++) {
      const angle = leaf * 2.4;
      const height = 0.86 + (leaf % 3) * 0.2;
      const shape = this.shape('sphere', `${name}-leaf-${leaf}`, new Vector3(0.22, 0.62, 0.37), new Vector3(Math.cos(angle) * 0.22, height, Math.sin(angle) * 0.22), leaf % 2 ? '#77a484' : '#53876c', root);
      shape.rotation.z = Math.sin(angle) * 0.65;
      shape.rotation.x = Math.cos(angle) * 0.65;
    }
  }

  private makeBench(): void {
    const root = new TransformNode('left-waiting-bench', this.scene); root.position.set(-7.8, 0, 1.46);
    this.box('bench-seat', 2.3, 0.15, 0.66, 0, 0.55, 0, COLORS.woodLight, root);
    this.box('bench-back', 2.3, 0.50, 0.10, 0, 0.89, -0.30, COLORS.wood, root);
    for (const x of [-0.84, 0.84]) this.box(`bench-leg-${x}`, 0.17, 0.49, 0.43, x, 0.25, 0, COLORS.woodDark, root);
    this.box('bench-cushion', 0.86, 0.1, 0.53, -0.5, 0.67, 0.01, '#7e9c7e', root);
  }

  private makeLabel(name: string, width: number, height: number, position: Vector3, parent?: TransformNode, action?: CoffeeSceneAction, pixels = 768, pixelHeight = 192, billboard = false): Label {
    const mesh = CreatePlane(name, { width, height, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    mesh.position.copyFrom(position);
    if (parent) mesh.parent = parent;
    if (billboard) mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    else mesh.rotation.y = Math.PI;
    mesh.isPickable = Boolean(action);
    if (action) mesh.metadata = { coffeeAction: action };
    let texture: DynamicTexture | null = null;
    // NullEngine QA intentionally skips canvas text; it still verifies meshes and state sync.
    if (typeof document !== 'undefined') {
      texture = new DynamicTexture(`${name}-ink`, { width: pixels, height: pixelHeight }, this.scene, false);
      texture.hasAlpha = true;
      const mat = new StandardMaterial(`${name}-label-material`, this.scene);
      mat.diffuseTexture = texture;
      mat.opacityTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.specularColor = Color3.Black();
      mat.emissiveColor = Color3.White();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mesh.material = mat;
    } else mesh.material = this.material('#f1dba1', true);
    const label = { mesh, texture, key: '' };
    this.labels.push(label);
    return label;
  }

  private paintLabel(label: Label, key: string, paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    if (label.key === key) return;
    label.key = key;
    if (!label.texture) return;
    const ctx = label.texture.getContext() as CanvasRenderingContext2D;
    const size = label.texture.getSize();
    ctx.clearRect(0, 0, size.width, size.height);
    paint(ctx, size.width, size.height);
    label.texture.update();
  }

  private text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string): void {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y);
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string): void {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  private removeCasterTree(root: TransformNode): void {
    if (!this.shadowGenerator) return;
    for (const mesh of root.getChildMeshes()) if (mesh instanceof Mesh) this.shadowGenerator.removeShadowCaster(mesh, false);
  }
}
