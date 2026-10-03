import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
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
import type { Counter, CounterId, Customer, RecipeId, SliceState } from '../core/types';
import { recipeById } from '../core/engine';

export type CoffeeSceneAction =
  | { type: 'invite' }
  | { type: 'counter'; id: CounterId }
  | { type: 'recipe'; id: CounterId }
  | { type: 'menu'; recipe: RecipeId }
  | { type: 'vault' }
  | { type: 'manager' };

export type CoffeeSceneAnchor =
  | 'invite' | 'counter-a-upgrade' | 'counter-b-upgrade'
  | 'counter-a-recipe' | 'counter-b-recipe'
  | 'menu-espresso' | 'menu-latte' | 'vault' | 'manager';
export interface AnchorProjection { x: number; y: number; visible: boolean }

/** The optional engine is a QA seam; normal callers only supply canvas and action callback. */
export interface CoffeeSceneOptions { engine?: AbstractEngine; shadows?: boolean }

type Shape = 'box' | 'cylinder' | 'sphere' | 'ring';
type PointerGesture = { id: number; x: number; y: number; lastX: number; lastY: number; time: number; dragged: boolean; action?: CoffeeSceneAction };
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
  selector: Label;
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
 * Original, asset-free immersive coffee-shop room. It only presents snapshots: all movement,
 * cash, recipes, cooldowns and upgrades remain owned by the renderer-independent core.
 */
export class CoffeeScene {
  readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly onAction: (action: CoffeeSceneAction) => void;
  private readonly engine: AbstractEngine;
  private readonly ownsEngine: boolean;
  private readonly camera: FreeCamera;
  private readonly baseTarget = new Vector3(1.1, 0.9, 1.2);
  private readonly cameraOffset = new Vector3(10, 16, 22);
  private readonly screenRight: Vector3;
  private readonly screenUp: Vector3;
  private readonly anchors = new Map<CoffeeSceneAnchor, Mesh>();
  private panX = 0;
  private panY = 0;
  private hasSized = false;
  private panBounds = { left: 0, right: 0, bottom: 0, top: 0 };
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly shapes = new Map<Shape, Mesh>();
  private readonly customers = new Map<number, Person>();
  private readonly stations = new Map<CounterId, Station>();
  private readonly labels: Label[] = [];
  private readonly manager: Person;
  private readonly managerLabel: Label;
  private readonly cartCash: TransformNode[] = [];
  private readonly invite: Label;
  private readonly vaultLamp: Mesh;
  private readonly shadowGenerator: ShadowGenerator | null;
  private disposed = false;
  private animationTime = 0;
  private lastInviteKey = '';
  private selected: CounterId | null = null;
  private down: PointerGesture | null = null;

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
    this.scene.clearColor = Color4.FromHexString('#efe9d9ff');
    this.scene.ambientColor = Color3.FromHexString('#f6ecd7');
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.scene.imageProcessingConfiguration.contrast = 1.02;
    this.camera = new FreeCamera('fixed-isometric-camera', this.baseTarget.add(this.cameraOffset), this.scene);
    const forward = this.cameraOffset.scale(-1).normalize();
    this.screenRight = Vector3.Cross(Vector3.Up(), forward).normalize();
    this.screenUp = Vector3.Cross(forward, this.screenRight).normalize();
    this.camera.setTarget(this.baseTarget);
    this.camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 90;
    this.scene.activeCamera = this.camera;
    // No Babylon gesture controls: one bounded screen-plane pan keeps the room angle stable.
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
    this.makeMenu('espresso', 0);
    this.makeMenu('latte', 5);
    this.invite = this.makeEntrance();
    this.vaultLamp = this.makeVault();
    this.manager = this.makePerson('manager', 1, '#e0ad52', false, true);
    this.manager.root.position.set(-8, 0, -1.7);
    this.manager.root.scaling.setAll(0.97);
    this.managerLabel = this.makeCart(this.manager.root);
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

  /** CSS coordinates relative to the actual canvas, including a full 44px control footprint. */
  projectAnchor(key: CoffeeSceneAnchor): AnchorProjection {
    const mesh = this.anchors.get(key);
    const rect = this.canvas.getBoundingClientRect();
    if (this.disposed || !mesh || !rect.width || !rect.height) return { x: 0, y: 0, visible: false };
    const world = this.anchorWorld(mesh);
    this.scene.updateTransformMatrix(true);
    const width = this.engine.getRenderWidth(), height = this.engine.getRenderHeight();
    const p = Vector3.Project(world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(width, height));
    // Projection is framebuffer-based; CSS conversion uses the real rect, not a second DPR multiplier.
    const x = p.x * rect.width / width, y = p.y * rect.height / height;
    const sideInset = 60, bottomInset = 26, topInset = 116;
    return { x, y, visible: mesh.isEnabled() && p.z >= 0 && p.z <= 1 && x >= sideInset && x <= rect.width - sideInset && y >= topInset && y <= rect.height - bottomInset };
  }

  /** DOM hit areas use exactly the same captured drag/hold/cancel guard as physical picks. */
  beginAnchorPointer(key: CoffeeSceneAnchor, event: PointerEvent): void {
    if (this.disposed || this.down || !this.projectAnchor(key).visible) return;
    const action = this.anchors.get(key)?.metadata?.coffeeAction as CoffeeSceneAction | undefined;
    if (!action) return;
    const down = this.handleDown(event);
    if (down) down.action = action;
  }

  /** Brings a cropped physical control back into view without shrinking the entire shop. */
  focusAnchor(key: CoffeeSceneAnchor): void {
    if (this.disposed || this.projectAnchor(key).visible) return;
    const mesh = this.anchors.get(key);
    if (!mesh) return;
    const relative = this.anchorWorld(mesh).subtract(this.baseTarget);
    this.setPan(Vector3.Dot(relative, this.screenRight), Vector3.Dot(relative, this.screenUp));
  }

  resize(): void {
    if (this.disposed) return;
    this.engine.resize();
    const rect = this.canvas.getBoundingClientRect();
    const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
    // Phones crop a room at useful object scale. Landscape sees a close counter-and-wall view;
    // portrait has vertical room for queues, while dragging reveals the other shop areas.
    const halfHeight = aspect > 1.8 ? 4.25 : 6.15;
    this.camera.orthoLeft = -halfHeight * aspect;
    this.camera.orthoRight = halfHeight * aspect;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
    this.refreshPanBounds();
    if (!this.hasSized && aspect > 1.8) this.panY = 2.4;
    this.hasSized = true;
    this.setPan(this.panX, this.panY);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releasePointer();
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
    this.anchors.clear();
  }

  private readonly handleDown = (event: PointerEvent): PointerGesture | null => {
    if (this.disposed || this.down || !event.isPrimary || event.button !== 0) return null;
    this.down = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, dragged: false };
    this.canvas.setPointerCapture(event.pointerId);
    return this.down;
  };
  private readonly handleMove = (event: PointerEvent): void => {
    const down = this.down;
    if (!down || event.pointerId !== down.id) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) down.dragged = true;
    if (down.dragged) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const dx = event.clientX - down.lastX, dy = event.clientY - down.lastY;
        this.setPan(this.panX - dx * (this.camera.orthoRight! - this.camera.orthoLeft!) / rect.width,
          this.panY + dy * (this.camera.orthoTop! - this.camera.orthoBottom!) / rect.height);
      }
    }
    down.lastX = event.clientX; down.lastY = event.clientY;
  };
  private readonly handleCancel = (event: PointerEvent): void => {
    if (this.down && event.pointerId === this.down.id) this.releasePointer();
  };
  private readonly handleUp = (event: PointerEvent): void => {
    const down = this.down;
    if (!down || event.pointerId !== down.id) return;
    this.releasePointer();
    if (this.disposed || down.dragged || event.timeStamp - down.time > 800) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cssX = event.clientX - rect.left, cssY = event.clientY - rect.top;
    if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return;
    if (down.action) { this.onAction(down.action); return; }
    // Babylon's ray helper applies hardware scaling itself. Convert CSS into its logical
    // rendering coordinates once, even when the backing buffer is 1.75× the canvas rect.
    const scale = this.engine.getHardwareScalingLevel();
    const x = cssX * this.engine.getRenderWidth() * scale / rect.width;
    const y = cssY * this.engine.getRenderHeight() * scale / rect.height;
    this.scene.updateTransformMatrix(true);
    const pick = this.scene.pick(x, y, mesh => Boolean(mesh.metadata?.coffeeAction), false, this.camera);
    const action = pick?.pickedMesh?.metadata?.coffeeAction as CoffeeSceneAction | undefined;
    if (pick?.hit && action) this.onAction(action);
  };

  private releasePointer(): void {
    const id = this.down?.id;
    this.down = null;
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  private anchorWorld(mesh: Mesh): Vector3 {
    mesh.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(Vector3.ZeroReadOnly, mesh.getWorldMatrix());
  }

  private registerAnchor(key: CoffeeSceneAnchor, mesh: Mesh): void {
    this.anchors.set(key, mesh);
    mesh.metadata = { ...mesh.metadata, coffeeAnchor: key };
  }

  private refreshPanBounds(): void {
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const mesh of this.anchors.values()) {
      const p = this.anchorWorld(mesh).subtract(this.baseTarget);
      const x = Vector3.Dot(p, this.screenRight), y = Vector3.Dot(p, this.screenUp);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const halfWidth = this.camera.orthoRight!, halfHeight = this.camera.orthoTop!;
    // A control-sized inset remains reachable at both ends. A fully visible room cannot
    // be dragged off into empty space; cropped portrait/landscape can traverse its anchors.
    const rect = this.canvas.getBoundingClientRect();
    const insetX = Math.max(.8, halfWidth * 2 * 64 / Math.max(1, rect.width));
    const insetBottom = Math.max(.8, halfHeight * 2 * 30 / Math.max(1, rect.height));
    const insetTop = Math.max(.8, halfHeight * 2 * 120 / Math.max(1, rect.height));
    this.panBounds = {
      left: Math.min(0, minX + halfWidth - insetX), right: Math.max(0, maxX - halfWidth + insetX),
      bottom: Math.min(0, minY + halfHeight - insetBottom), top: Math.max(0, maxY - halfHeight + insetTop),
    };
  }

  private setPan(x: number, y: number): void {
    this.panX = clamp(x, this.panBounds.left, this.panBounds.right);
    this.panY = clamp(y, this.panBounds.bottom, this.panBounds.top);
    const target = this.baseTarget.add(this.screenRight.scale(this.panX)).add(this.screenUp.scale(this.panY));
    this.camera.position.copyFrom(target.add(this.cameraOffset));
    this.camera.setTarget(target);
    this.scene.updateTransformMatrix(true);
  }

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
    // This is a continuous room, not an island/plinth floating inside a blank canvas.
    // Surfaces deliberately extend beyond every bounded view, including portrait crops.
    const floor = this.box('continuous-shop-floor', 140, .12, 140, 0, -.10, 24, COLORS.tile, undefined, false);
    floor.receiveShadows = true; floor.isPickable = true;
    floor.metadata = { coffeeEnvironment: true };
    for (let ix = 0; ix < 20; ix++) {
      for (let iz = 0; iz < 12; iz++) {
        const color = [COLORS.tile, COLORS.tileLight, COLORS.tileWarm][(ix + iz * 2) % 3];
        const tile = this.box(`floor-${ix}-${iz}`, 2.37, .04, 2.37, -22.8 + ix * 2.4, -.02, -2.4 + iz * 2.4, color, undefined, false);
        tile.receiveShadows = true;
      }
    }
    const wall = this.box('rear-wall', 140, 28, .22, 0, 14, -3.72, COLORS.cream, undefined, false);
    wall.isPickable = true; wall.metadata = { coffeeEnvironment: true };
    this.box('rear-wainscot', 140, 1.22, .1, 0, .62, -3.57, COLORS.tealDark, undefined, false);
    this.box('wall-chair-rail', 140, .12, .17, 0, 1.24, -3.53, COLORS.woodLight, undefined, false);
    for (let x = -28; x < 28; x += .72) this.box(`wall-panel-${x}`, .024, 1.1, .04, x, .64, -3.49, '#3f7b71', undefined, false);
    // A high picture rail and pendant lamps make the background read as an interior.
    this.box('wall-picture-rail', 140, .12, .15, 0, 4.28, -3.52, COLORS.woodLight, undefined, false);
    for (const x of [-8, -2.5, 5.5, 10.5]) {
      this.box(`pendant-cord-${x}`, .025, 1.15, .025, x, 4.5, -.8, COLORS.dark, undefined, false);
      this.cylinder(`pendant-shade-${x}`, .78, .28, x, 3.84, -.8, COLORS.gold, undefined, false);
      this.cylinder(`pendant-glow-${x}`, .58, .035, x, 3.68, -.8, '#fff3bd', undefined, false).material = this.material('#fff3bd', true);
    }
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
    this.registerAnchor(`${id}-upgrade`, plaque.mesh);
    const selection = this.box(`${id}-selected`, 3.83, 0.022, 1.77, 0, 0.038, 0, '#e9c96e', root, false);
    selection.material = this.material('#e9c96e', true, 0.83);
    selection.setEnabled(false);
    this.box(`${id}-selector-stand`, .11, .33, .10, 1.22, 1.38, .43, deep, root);
    this.box(`${id}-selector-frame`, 1.04, .58, .08, 1.22, 1.62, .45, deep, root);
    const selector = this.makeLabel(`${id}-recipe-selector`, .94, .48, new Vector3(1.22, 1.62, .505), root, { type: 'recipe', id }, 512, 224);
    this.registerAnchor(`${id}-recipe`, selector.mesh);
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
    const station: Station = { root, barista, progressRoot, progressFill, plaque, selector, cashLabel, cash, machineExtras: extras, readyCup, selection, level: -1, recipe: '' };
    // Build the initial labels even before the first simulation frame arrives.
    this.updateStation(station, { id, x, level: 1, recipe: letter === 'A' ? 'espresso' : 'latte', pendingCash: 0, brewed: 0, brew: null }, false);
    return station;
  }

  private makeMenu(recipe: RecipeId, x: number): void {
    const action: CoffeeSceneAction = { type: 'menu', recipe };
    const frame = this.box(`menu-${recipe}-frame`, 3.52, 2.1, .17, x, 2.70, -3.45, COLORS.woodDark);
    frame.isPickable = true; frame.metadata = { coffeeAction: action };
    for (const dx of [-1.15, 1.15]) this.box(`menu-${recipe}-hanger-${dx}`, .045, .36, .06, x + dx, 3.84, -3.39, COLORS.gold, undefined, false);
    const board = this.makeLabel(`menu-${recipe}`, 3.3, 1.90, new Vector3(x, 2.70, -3.33), undefined, action, 768, 448);
    this.registerAnchor(`menu-${recipe}`, board.mesh);
    const coffee = recipeById[recipe], espresso = recipe === 'espresso';
    this.paintLabel(board, recipe, (ctx, w, h) => {
      this.roundRect(ctx, 1, 1, w - 2, h - 2, 15, '#2e4843');
      this.text(ctx, 'COFFEE MENU', w / 2, 55, 30, '#ead4a1');
      ctx.strokeStyle = '#648275'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(62, 87); ctx.lineTo(w - 62, 87); ctx.stroke();
      ctx.fillStyle = espresso ? '#d49c5b' : '#91bab0';
      ctx.beginPath(); ctx.moveTo(w / 2 - 58, 116); ctx.lineTo(w / 2 + 58, 116); ctx.lineTo(w / 2 + 43, 209); ctx.lineTo(w / 2 - 43, 209); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f7ebd7'; ctx.fillRect(w / 2 - 63, 109, 126, 18);
      ctx.fillStyle = '#523c2f'; ctx.fillRect(w / 2 - 50, 133, 100, 18);
      this.text(ctx, espresso ? 'ESPRESSO' : 'LATTE', w / 2, 263, 54, '#faf1db');
      this.text(ctx, `${cashText(coffee.price)}  ·  ${coffee.brewSeconds.toFixed(1)}s`, w / 2, 318, 32, '#ead4a1');
      this.text(ctx, espresso ? 'QUICK & BOLD' : 'SLOW & SILKY', w / 2, 363, 25, '#b9cbb7');
      this.text(ctx, 'AVAILABLE  ·  DETAILS +', w / 2, 410, 23, '#ead4a1');
    });
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
      this.paintLabel(station.selector, counter.recipe, (ctx, w, h) => {
        this.roundRect(ctx, 3, 3, w - 6, h - 6, 22, '#f5efda');
        this.text(ctx, espresso ? 'ESPRESSO' : 'LATTE', w / 2, h * .40, 52, '#315d54');
        this.text(ctx, 'RECIPE  ↔', w / 2, h * .76, 32, '#a4773f');
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
    this.paintLabel(this.managerLabel, `level-${manager.level}`, (ctx, w, h) => {
      this.roundRect(ctx, 4, 4, w - 8, h - 8, 22, '#f1dd9f');
      this.text(ctx, `MANAGER  ${manager.level}  ↑`, w / 2, h / 2 + 1, 42, '#405a45');
    });
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

  private makeCart(parent: TransformNode): Label {
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
    const label = this.makeLabel('manager-cart-control', 1.22, .39, new Vector3(0, 1.16, 0), root, { type: 'manager' }, 512, 160, true);
    this.registerAnchor('manager', label.mesh);
    const hit = this.box('manager-cart-hit', .90, .95, .80, 0, .62, 0, '#ffffff', root, false);
    hit.material = this.material('#ffffff', false, 0); hit.isPickable = true;
    hit.metadata = { coffeeAction: { type: 'manager' } };
    return label;
  }

  private makeEntrance(): Label {
    const pad = this.cylinder('entrance-invite-pad', 2.1, 0.03, -8, 0.03, 5, '#d8b66b', undefined, false);
    pad.receiveShadows = true;
    const edge = this.shape('ring', 'entrance-pad-border', new Vector3(2.04, 0.8, 2.04), new Vector3(-8, 0.057, 5), '#f9e6b1', undefined, false);
    edge.material = this.material('#f9e6b1', true);
    this.box('entry-sign-post-left', 0.11, 1.16, 0.11, -8.68, 0.59, 5.62, COLORS.woodDark);
    this.box('entry-sign-post-right', 0.11, 1.16, 0.11, -7.32, 0.59, 5.62, COLORS.woodDark);
    const label = this.makeLabel('invite-guest-sign', 2.48, 0.56, new Vector3(-8, 1.48, 5.62), undefined, { type: 'invite' }, 768, 176, true);
    this.registerAnchor('invite', label.mesh);
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
    const vault = new TransformNode('cash-vault', this.scene); vault.position.set(-8, 1.18, -3.09);
    this.box('vault-wall-bracket', 1.63, .12, .75, 0, .09, -.02, COLORS.woodDark, vault);
    this.box('vault-body', 1.48, 1.28, 0.88, 0, 0.77, 0, '#466660', vault);
    const door = this.box('vault-door', 1.26, 1.06, 0.08, 0, 0.79, 0.48, '#739286', vault);
    door.isPickable = true; door.metadata = { coffeeAction: { type: 'vault' } };
    this.box('vault-door-inset', 1.04, 0.86, 0.035, 0, 0.78, 0.534, '#405f58', vault);
    const wheel = this.cylinder('vault-wheel', 0.34, 0.072, 0, 0.78, 0.594, '#d8be76', vault); wheel.rotation.x = Math.PI / 2;
    this.box('vault-wheel-spoke', 0.29, 0.065, 0.045, 0, 0.78, 0.642, '#775d35', vault, false);
    this.box('vault-slot', 0.54, 0.063, 0.07, 0, 1.13, 0.55, '#213e37', vault, false);
    const label = this.makeLabel('vault-bank-label', 1.55, .37, new Vector3(0, 1.58, .55), vault, { type: 'vault' }, 512, 128);
    this.registerAnchor('vault', label.mesh);
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
