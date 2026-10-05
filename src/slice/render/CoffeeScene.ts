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
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
// Registers the scene ray-picking extension used by physical shop controls.
import '@babylonjs/core/Culling/ray.js';
import type { Counter, CounterId, Customer, RecipeId, ShopLayout, SliceState } from '../core/types';
import { coffeeBrewSeconds, coffeePrice, WORLD } from '../core/engine';
import { furnitureCells, getLayout, interactionPoint } from '../core/layout';
import { DEFAULT_RENDER_MODE, RENDER_MODES, renderPixelRatio, type RenderMode } from './RenderBudget';

export type CoffeeSceneAction =
  | { type: 'invite' }
  | { type: 'counter'; id: CounterId }
  | { type: 'recipe'; id: CounterId }
  | { type: 'menu'; recipe: RecipeId }
  | { type: 'vault' }
  | { type: 'renovate' }
  | { type: 'layout-select'; id: string }
  | { type: 'layout-cell'; x: number; z: number };

export type CoffeeSceneAnchor =
  | 'invite' | `${CounterId}-upgrade` | `${CounterId}-recipe`
  | 'menu-espresso' | 'menu-latte' | 'vault' | 'renovate' | 'expansion';
export interface AnchorProjection { x: number; y: number; visible: boolean }

/** The optional engine is a QA seam; normal callers only supply canvas and action callback. */
export interface CoffeeSceneOptions { engine?: AbstractEngine; shadows?: boolean; renderMode?: RenderMode }

type Shape = 'box' | 'cylinder' | 'sphere' | 'ring';
type PointerGesture = { id: number; x: number; y: number; lastX: number; lastY: number; time: number; dragged: boolean; target: Mesh | null; targetPoint: Vector3 | null; invalidated: boolean; action?: CoffeeSceneAction };
type Label = { mesh: Mesh; texture: DynamicTexture | null; key: string };
type Menu = { label: Label; level: number };
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
  cashRoot: TransformNode;
  cash: TransformNode[];
  machineExtras: TransformNode[];
  readyCup: TransformNode;
  selection: Mesh;
  level: number;
  recipe: string;
  pendingCash: number;
};

const COLORS = {
  cream: '#efe9d9', tile: '#e7ddc8',
  dark: '#253c3a', wood: '#b47b50', woodLight: '#cd9362', woodDark: '#815337',
  metal: '#eeeae0', steel: '#809b96', gold: '#d5a54c', teal: '#4c9b96',
  tealDark: '#286c67', rose: '#d98b98', roseDark: '#985664', leaf: '#609678',
  money: '#7eb674', moneyDark: '#477d53', ink: '#314744',
};
const SKINS = ['#e6b88d', '#bb855e', '#f1ccb0', '#916247', '#d9a780'];
const SHIRTS = ['#c86e5d', '#5c9ca6', '#d3ac50', '#8b84ae', '#779f74', '#c28798'];
const HAIR = ['#3d3531', '#6c4531', '#d5b677', '#493b49', '#aba99d'];
const TAU = Math.PI * 2;
// Above the rug ink surfaces, so cached furniture shadows
// can coexist with visible, cheap moving contact disks.
const CONTACT_SHADOW_Y = .074;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
// Fixed-camera room coordinates, shared by its solids and their world-scaled patterns.
const ROOM = { width: 144, depth: 144, floorY: 0, rearZ: -3.6, tilePitch: 2.4, panelPitch: .72 };
const cashText = (cents: number) => `¥ ${(cents / 100).toFixed(2)}`;

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
  private readonly staticCasters = new Set<Mesh>();
  private renderedFrames = 0;
  private renderMode: RenderMode;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly shapes = new Map<Shape, Mesh>();
  private readonly customers = new Map<number, Person>();
  private readonly stations = new Map<CounterId, Station>();
  private readonly menus = new Map<RecipeId, Menu>();
  private readonly tables = new Map<string, TransformNode>();
  private readonly legacyFurniture: TransformNode[] = [];
  private readonly gridCells = new Map<string, Mesh>();
  private expansionRoot!: TransformNode;
  private expansionFloor!: Mesh;
  private expansionGate!: TransformNode;
  private renovationGhost: Mesh | null = null;
  private previewLayout: ShopLayout | null = null;
  private liveLayout: ShopLayout | null = null;
  private displayedLayout: ShopLayout | null = null;
  private layoutSignature = '';
  private gridSignature = '';
  private renovationSelected: string | null = null;
  private renovationValid = true;
  private readonly labels: Label[] = [];
  private readonly manager: Person;
  private readonly vaultLabel: Label;
  private managerCart!: TransformNode;
  private readonly cartCash: TransformNode[] = [];
  private readonly invite: Label;
  private readonly vaultLamp: Mesh;
  private readonly shadowGenerator: ShadowGenerator | null;
  private disposed = false;
  private interactionEnabled = true;
  private animationTime = 0;
  private lastManagerLevel = -1;
  private lastCartStacks = -1;
  private lastInviteKey = '';
  private selected: CounterId | null = null;
  private focused: CoffeeSceneAnchor | null = null;
  private readonly focusMaterials = new Map<Mesh, StandardMaterial>();
  private down: PointerGesture | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onAction: (action: CoffeeSceneAction) => void,
    options: CoffeeSceneOptions = {},
  ) {
    this.canvas = canvas;
    this.onAction = onAction;
    this.ownsEngine = !options.engine;
    this.renderMode = options.renderMode ?? DEFAULT_RENDER_MODE;
    this.engine = options.engine ?? new Engine(canvas, true, { stencil: false, powerPreference: 'default' }, false);
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
    // Keep pale horizontal surfaces below diffuse clipping so both tile axes retain ink.
    ambient.intensity = 0.64;
    ambient.groundColor = Color3.FromHexString('#b3aaa1');
    const sun = new DirectionalLight('warm-window-light', new Vector3(0.5, -1, -0.55), this.scene);
    sun.position = new Vector3(-7, 16, 10);
    sun.intensity = 0.48;
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
    const vault = this.makeVault();
    this.vaultLamp = vault.lamp;
    this.vaultLabel = vault.label;
    this.manager = this.makePerson('manager', 1, '#e0ad52', false, true);
    this.manager.root.position.set(WORLD.vaultX, 0, WORLD.backZ);
    this.manager.previousX = WORLD.vaultX;
    this.manager.previousZ = WORLD.backZ;
    this.manager.root.scaling.setAll(0.97);
    this.makeCart(this.manager.root);
    // Append new controls after the established keyboard sequence.
    this.registerAnchor('renovate', this.scene.getMeshByName('brand-sign') as Mesh);
    this.makeExpansion();
    this.prepareStaticGeometry();
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
    this.liveLayout = getLayout(state);
    this.reconcileLayout(this.previewLayout ?? this.liveLayout);
    for (const counter of state.counters) {
      const station = this.stations.get(counter.id);
      if (station) this.updateStation(station, counter, state.paused);
    }
    for (const [recipe, menu] of this.menus) this.updateMenu(recipe, menu, state.coffeeLevels[recipe]);
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
        this.text(ctx, state.inviteCooldown > 0 ? `稍候 ${Math.ceil(state.inviteCooldown)} 秒` : '迎接顾客  +', w / 2, h / 2 + 2, 94, '#ffffff');
      });
      this.lastInviteKey = inviteKey;
    }
    this.vaultLamp.material = this.material(state.manager.phase === 'depositing' && state.manager.carrying > 0 ? '#f6dc79' : '#92bfa3', true);
    if (this.down?.target && this.down.targetPoint) {
      const point = this.projectWorld(this.anchorWorld(this.down.target));
      if (this.down.target.isDisposed() || Math.hypot(point.x - this.down.targetPoint.x, point.y - this.down.targetPoint.y) > 9) this.down.invalidated = true;
    }
    // One application-owned RAF loop, with Babylon's normal per-frame bookkeeping.
    this.engine.beginFrame();
    try { this.scene.render(); } finally { this.engine.endFrame(); }
    this.renderedFrames++;
  }

  /** Detached editor snapshot. Passing null restores the authoritative shop immediately. */
  setRenovationPreview(layout: ShopLayout | null, selectedId: string | null = null, valid = true): void {
    if (this.disposed) return;
    const modeChanged = Boolean(this.previewLayout) !== Boolean(layout);
    if (modeChanged) this.releasePointer();
    this.previewLayout = layout ? structuredClone(layout) : null;
    this.renovationSelected = selectedId;
    this.renovationValid = valid;
    if (this.previewLayout || this.liveLayout) this.reconcileLayout(this.previewLayout ?? this.liveLayout!);
    this.updateRenovationGrid();
    this.refreshPanBounds();
    this.setPan(this.panX, this.panY);
  }

  /** Actual world centre for keyboard/canvas QA; never changes the simulation. */
  projectLayoutCell(x: number, z: number): AnchorProjection {
    const p = this.projectWorld(new Vector3(x, .12, z));
    const rect = this.canvas.getBoundingClientRect();
    return { x: p.x, y: p.y, visible: !this.disposed && p.z >= 0 && p.z <= 1 && p.x >= 0 && p.x <= rect.width && p.y >= 0 && p.y <= rect.height };
  }

  private reconcileLayout(layout: ShopLayout): void {
    // Traffic scheduling and economy ticks do not rebuild or reallocate furniture.
    const signature = JSON.stringify([layout.active, layout.expanded, layout.furniture.map(item => [item.id, item.kind, item.counterId, item.x, item.z, item.rotation, item.stored])]);
    this.displayedLayout = layout;
    if (signature === this.layoutSignature) return;
    this.layoutSignature = signature;
    for (const node of this.legacyFurniture) node.setEnabled(!layout.active);
    const items = layout.furniture.filter(item => !item.stored);
    const counters = new Set(items.filter(item => item.kind === 'counter').map(item => item.counterId!));
    for (const [id, station] of this.stations) {
      if (counters.has(id)) continue;
      this.disposeFurnitureRoot(station.root);
      station.barista.shadow.dispose(false, false);
      this.stations.delete(id);
    }
    const tableIds = new Set(items.filter(item => item.kind === 'table').map(item => item.id));
    for (const [id, root] of this.tables) if (!tableIds.has(id)) { this.disposeFurnitureRoot(root); this.tables.delete(id); }
    const palette = [[COLORS.teal, COLORS.tealDark], [COLORS.rose, COLORS.roseDark], ['#b49a5c', '#766441'], ['#8899b0', '#526680']];
    for (const item of items) {
      let root: TransformNode;
      if (item.kind === 'counter') {
        if (!item.counterId) continue;
        let station = this.stations.get(item.counterId);
        if (!station) {
          const index = Math.max(0, item.counterId.charCodeAt(item.counterId.length - 1) - 97);
          const [accent, deep] = palette[index % palette.length];
          station = this.makeStation(item.counterId, item.x, accent, deep, item.counterId.slice(-1).toUpperCase());
          this.stations.set(item.counterId, station);
        }
        this.positionCounterControls(station, item.rotation);
        root = station.root;
      } else {
        let table = this.tables.get(item.id);
        if (!table) { table = this.makeTable(item.id); this.tables.set(item.id, table); }
        root = table;
      }
      root.metadata = { ...root.metadata, coffeeFurnitureId: item.id, coffeeFurnitureKind: item.kind };
      // The core uses a counter-clockwise x/z grid turn: Babylon's Y rotation has
      // the opposite sign. Every mounted component shares this one root transform.
      const angle = -item.rotation * Math.PI / 2;
      if (root.position.x !== item.x || root.position.z !== item.z || root.rotation.y !== angle) {
        for (const mesh of root.getChildMeshes()) mesh.unfreezeWorldMatrix();
        root.position.set(item.x, 0, item.z);
        root.rotation.y = angle;
        root.computeWorldMatrix(true);
        for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
      }
    }
    this.expansionGate.setEnabled(!layout.expanded);
    this.expansionFloor.material = this.material(layout.expanded ? '#e7ddc8' : '#d1ceb8');
    this.expansionFloor.metadata = { coffeeExpansion: layout.expanded ? 'open' : 'locked', coffeeAction: { type: 'renovate' } };
    this.prepareStaticGeometry();
    this.shadowGenerator?.getShadowMap()?.resetRefreshCounter();
    this.updateRenovationGrid();
    this.refreshPanBounds();
  }

  private positionCounterControls(station: Station, rotation: number): void {
    // The machine and notes fill the top. On away-facing turns the same two
    // wooden plaques attach to the visible long face, never to a floating HUD.
    // Projection reverses local X at turns 1/2, so preserve recipe-left/upgrade-right.
    const reverse = rotation === 1 || rotation === 2;
    const side = reverse ? -1 : 1;
    // The worker stands in the centre gap on the visible back side rather than
    // masking the recipe plaque with their torso at the original left-hand slot.
    station.barista.root.position.x = reverse ? .2 : -.5;
    for (const [label, x] of [[station.selector, 1.01 * side], [station.plaque, -1.01 * side]] as const) {
      label.mesh.unfreezeWorldMatrix();
      label.mesh.position.set(x, .55, .765 * side);
      label.mesh.rotation.y = reverse ? 0 : Math.PI;
      label.mesh.metadata = { ...label.mesh.metadata, coffeeSurface: reverse ? 'counter-visible-back' : 'counter-front' };
      const mount = this.scene.getMeshByName(label.mesh.metadata.coffeeMount);
      if (mount) { mount.unfreezeWorldMatrix(); mount.position.set(x, .55, .715 * side); }
    }
  }

  private disposeFurnitureRoot(root: TransformNode): void {
    const meshes = new Set(root.getChildMeshes());
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      if (!meshes.has(label.mesh)) continue;
      // Label ink is owned by this furniture. Shared wood/metal/skin materials are not.
      label.texture?.dispose();
      label.mesh.material?.dispose(false, false);
      this.labels.splice(i, 1);
    }
    for (const [key, mesh] of this.anchors) if (meshes.has(mesh)) {
      this.anchors.delete(key);
      if (this.focused === key) this.focused = null;
    }
    for (const mesh of meshes) {
      this.staticCasters.delete(mesh as Mesh);
      this.shadowGenerator?.removeShadowCaster(mesh, false);
      this.focusMaterials.delete(mesh as Mesh);
    }
    root.dispose(false, false);
  }

  private makeTable(id: string): TransformNode {
    const root = new TransformNode(`${id}-furniture`, this.scene);
    this.cylinder(`${id}-table-top`, .9, .12, 0, .91, 0, COLORS.woodLight, root);
    this.cylinder(`${id}-table-stem`, .12, .78, 0, .46, 0, COLORS.woodDark, root);
    this.cylinder(`${id}-table-base`, .52, .06, 0, .035, 0, COLORS.woodDark, root);
    this.cylinder(`${id}-small-vase`, .14, .2, -.15, 1.07, -.12, COLORS.cream, root);
    this.shape('sphere', `${id}-table-flower`, new Vector3(.24, .21, .24), new Vector3(-.15, 1.25, -.12), COLORS.rose, root, false);
    // The chair and table are one owned/rotated/stored unit. Its seat sits on the
    // adjacent interaction tile which the core reserves for a dining customer.
    this.box(`${id}-chair-seat`, .63, .12, .62, 0, .51, 1, COLORS.teal, root);
    this.box(`${id}-chair-back`, .63, .58, .09, 0, .8, 1.31, COLORS.tealDark, root);
    for (const x of [-.24, .24]) for (const z of [.78, 1.23]) this.box(`${id}-chair-leg-${x}-${z}`, .075, .48, .075, x, .24, z, COLORS.woodDark, root);
    return root;
  }

  private makeExpansion(): void {
    this.expansionRoot = new TransformNode('adjacent-expansion', this.scene);
    this.expansionFloor = this.box('expansion-floor', 6, .022, 13, 13.5, .012, 3, '#d1ceb8', this.expansionRoot, false);
    this.expansionFloor.metadata = { coffeeExpansion: 'locked', coffeeAction: { type: 'renovate' } };
    for (const z of [-3.42, 9.42]) this.box(`expansion-edge-${z}`, 6, .025, .08, 13.5, .03, z, '#a5b197', this.expansionRoot, false);
    this.box('expansion-far-edge', .08, .025, 13, 16.45, .03, 3, '#a5b197', this.expansionRoot, false);
    this.expansionGate = new TransformNode('expansion-locked-divider', this.scene);
    this.expansionGate.parent = this.expansionRoot;
    for (const z of [-2.8, .1, 3, 5.9, 8.8]) {
      this.box(`expansion-post-${z}`, .14, .8, .14, 10.63, .4, z, COLORS.woodDark, this.expansionGate);
      this.cylinder(`expansion-post-cap-${z}`, .21, .075, 10.63, .84, z, COLORS.gold, this.expansionGate);
    }
    for (const z of [-1.35, 1.55, 4.45, 7.35]) this.box(`expansion-rope-${z}`, .055, .065, 2.8, 10.63, .66, z, '#a88c60', this.expansionGate, false);
    // A timber building marker, with an embodied plus, is also the expansion entry.
    const marker = this.box('expansion-marker', 1.15, .9, .1, 12, 1.48, -2.8, COLORS.tealDark, this.expansionRoot);
    marker.metadata = { coffeeAction: { type: 'renovate' }, coffeeExpansionSign: true };
    this.box('expansion-marker-post', .13, 1.2, .13, 12, .6, -2.86, COLORS.woodDark, this.expansionRoot);
    for (const [name, w, h] of [['horizontal', .56, .105], ['vertical', .105, .56]] as const) {
      const plus = this.box(`expansion-plus-${name}`, w, h, .025, 12, 1.48, -2.735, COLORS.gold, this.expansionRoot, false);
      plus.metadata = { coffeeAction: { type: 'renovate' } };
    }
    this.registerAnchor('expansion', marker);
  }

  private updateRenovationGrid(): void {
    const layout = this.previewLayout;
    const signature = layout ? `${layout.expanded}` : '';
    if (signature !== this.gridSignature) {
      for (const mesh of this.gridCells.values()) mesh.dispose(false, false);
      this.gridCells.clear();
      this.gridSignature = signature;
      if (layout) {
        for (let x = -7; x <= (layout.expanded ? 16 : 10); x++) for (let z = -3; z <= 9; z++) {
          const cell = this.box(`renovation-cell-${x}-${z}`, .94, .014, .94, x, .092, z, '#f6edcd', undefined, false);
          cell.material = this.material('#f6edcd', false, .25);
          cell.receiveShadows = false;
          cell.metadata = { coffeeAction: { type: 'layout-cell', x, z }, coffeeRenovationGrid: true };
          cell.freezeWorldMatrix();
          this.gridCells.set(`${x},${z}`, cell);
        }
      }
    }
    if (!layout) {
      this.renovationGhost?.dispose(false, false);
      this.renovationGhost = null;
      return;
    }
    const selected = layout.furniture.find(item => item.id === this.renovationSelected && !item.stored);
    if (!selected) { this.renovationGhost?.setEnabled(false); return; }
    const cells = furnitureCells(selected);
    const minX = Math.min(...cells.map(cell => cell.x)), maxX = Math.max(...cells.map(cell => cell.x));
    const minZ = Math.min(...cells.map(cell => cell.z)), maxZ = Math.max(...cells.map(cell => cell.z));
    if (!this.renovationGhost) {
      this.renovationGhost = this.box('renovation-footprint-ghost', 1, .055, 1, 0, .115, 0, '#71b684', undefined, false);
      this.renovationGhost.isPickable = false;
      this.renovationGhost.receiveShadows = false;
    }
    this.renovationGhost.unfreezeWorldMatrix();
    this.renovationGhost.setEnabled(true);
    this.renovationGhost.scaling.set(maxX - minX + .98, .055, maxZ - minZ + .98);
    this.renovationGhost.position.set((minX + maxX) / 2, .115, (minZ + maxZ) / 2);
    this.renovationGhost.material = this.material(this.renovationValid ? '#71b684' : '#d76262', true, .55);
    this.renovationGhost.metadata = { coffeeFootprint: selected.id, coffeePlacementValid: this.renovationValid };
  }

  /** Read the actual presented mesh after update; viewport bounds do not assert occlusion. */
  readCustomerPose(id: number | null): { x: number; z: number; screenX: number; screenY: number; inViewport: boolean } | null {
    const person = id === null ? undefined : this.customers.get(id);
    if (this.disposed || !person || person.root.isDisposed()) return null;
    const position = person.root.position;
    const projected = this.projectWorld(new Vector3(position.x, position.y + 2.25, position.z));
    const rect = this.canvas.getBoundingClientRect();
    return { x: position.x, z: position.z, screenX: rect.left + projected.x, screenY: rect.top + projected.y,
      inViewport: projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= rect.width && projected.y >= 0 && projected.y <= rect.height };
  }

  selectedCounter(id: CounterId | null): void {
    if (this.disposed) return;
    this.selected = id;
    for (const [stationId, station] of this.stations) station.selection.setEnabled(stationId === id);
  }

  /** CSS projection of the actual visible mesh, never a screen-space hit area. */
  projectAnchor(key: CoffeeSceneAnchor): AnchorProjection {
    const mesh = this.anchors.get(key);
    const rect = this.canvas.getBoundingClientRect();
    if (this.disposed || !mesh || !rect.width || !rect.height) return { x: 0, y: 0, visible: false };
    const points = this.projectMesh(mesh);
    const p = this.projectWorld(this.anchorWorld(mesh));
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    return { x: p.x, y: p.y, visible: mesh.isEnabled() && p.z >= 0 && p.z <= 1 && minX >= 12 && maxX <= rect.width - 12 && minY >= 12 && maxY <= rect.height - 12 };
  }

  /** Diagnostic footprint is computed from the physical polygon, in CSS pixels. */
  getAnchorFootprint(key: CoffeeSceneAnchor): { width: number; height: number } {
    const mesh = this.anchors.get(key);
    if (this.disposed || !mesh) return { width: 0, height: 0 };
    const points = this.projectMesh(mesh);
    return { width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) };
  }

  setInteractionEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.interactionEnabled = enabled;
    if (!enabled) this.releasePointer();
  }

  getFocus(): CoffeeSceneAnchor | null { return this.disposed ? null : this.focused; }

  /** Keyboard focus recolors a real mounting rim and centers that object at useful scale. */
  focusAnchor(key: CoffeeSceneAnchor): void {
    if (this.disposed || !this.interactionEnabled) return;
    const mesh = this.anchors.get(key);
    if (!mesh) return;
    for (const [mount, material] of this.focusMaterials) mount.material = material;
    this.focusMaterials.clear();
    const mount = this.scene.getMeshByName(mesh.metadata?.coffeeMount ?? '');
    if (mount instanceof Mesh && mount.material instanceof StandardMaterial) {
      this.focusMaterials.set(mount, mount.material);
      mount.material = this.material('#e1bb69');
    }
    this.focused = key;
    this.refreshPanBounds();
    const relative = this.anchorWorld(mesh).subtract(this.baseTarget);
    this.setPan(Vector3.Dot(relative, this.screenRight), Vector3.Dot(relative, this.screenUp));
  }

  focusNext(direction = 1): CoffeeSceneAnchor | null {
    if (this.disposed || !this.interactionEnabled) return null;
    const keys = [...this.anchors.entries()].filter(([, mesh]) => mesh.isEnabled()).map(([key]) => key);
    const current = this.focused ? keys.indexOf(this.focused) : -1;
    const next = current < 0 ? (direction < 0 ? keys.length - 1 : 0) : (current + (direction < 0 ? -1 : 1) + keys.length) % keys.length;
    this.focusAnchor(keys[next]);
    return this.focused;
  }

  activateFocused(): boolean {
    if (this.disposed || !this.interactionEnabled || !this.focused || this.down) return false;
    const mesh = this.anchors.get(this.focused);
    const action = this.actionForMesh(mesh ?? null);
    if (!mesh?.isEnabled() || !action || !this.projectAnchor(this.focused).visible || !this.visibleSurface(mesh)) return false;
    this.onAction(action);
    return true;
  }

  /** Screen-plane keyboard pan shares the exact bounds and scale used by pointer dragging. */
  panBy(cssDx: number, cssDy: number): void {
    if (this.disposed || !this.interactionEnabled || !Number.isFinite(cssDx) || !Number.isFinite(cssDy)) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.setPan(this.panX + cssDx * (this.camera.orthoRight! - this.camera.orthoLeft!) / rect.width,
      this.panY - cssDy * (this.camera.orthoTop! - this.camera.orthoBottom!) / rect.height);
  }

  setRenderMode(mode: RenderMode): void {
    if (this.disposed || this.renderMode === mode) return;
    this.renderMode = mode;
    this.resize();
  }

  resize(): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    if (this.ownsEngine && typeof window !== 'undefined') {
      const scale = 1 / renderPixelRatio(rect.width, rect.height, window.devicePixelRatio || 1, this.renderMode);
      if (Math.abs(this.engine.getHardwareScalingLevel() - scale) > .001) this.engine.setHardwareScalingLevel(scale);
    }
    this.engine.resize();
    const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
    // Phones crop a room at useful object scale. Landscape sees a close counter-and-wall view;
    // portrait has vertical room for queues, while dragging reveals the other shop areas.
    const halfHeight = aspect > 1.8 ? 3.65 : 6.15;
    this.camera.orthoLeft = -halfHeight * aspect;
    this.camera.orthoRight = halfHeight * aspect;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
    this.refreshPanBounds();
    if (!this.hasSized && aspect > 1.8) { this.panX = -3.4; this.panY = 1.8; }
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
    this.menus.clear();
    this.tables.clear();
    this.gridCells.clear();
    this.legacyFurniture.length = 0;
    this.previewLayout = this.liveLayout = this.displayedLayout = null;
    this.materials.clear();
    this.shapes.clear();
    this.labels.length = 0;
    this.anchors.clear();
    this.focusMaterials.clear();
    this.staticCasters.clear();
    this.focused = null;
  }

  private readonly handleDown = (event: PointerEvent): PointerGesture | null => {
    if (this.disposed || !this.interactionEnabled || this.down || !event.isPrimary || event.button !== 0) return null;
    const target = this.pickAt(event.clientX, event.clientY);
    const action = this.actionForMesh(target);
    const targetPoint = target ? this.projectWorld(this.anchorWorld(target)) : null;
    this.down = { target, targetPoint, invalidated: false, action, id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, dragged: false };
    this.canvas.setPointerCapture(event.pointerId);
    return this.down;
  };
  private readonly handleMove = (event: PointerEvent): void => {
    const down = this.down;
    if (!this.interactionEnabled || !down || event.pointerId !== down.id) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) down.dragged = true;
    if (down.dragged) {
      this.panBy(down.lastX - event.clientX, down.lastY - event.clientY);
    }
    down.lastX = event.clientX; down.lastY = event.clientY;
  };
  private readonly handleCancel = (event: PointerEvent): void => {
    if (this.down && event.pointerId === this.down.id) this.releasePointer();
  };
  private readonly handleUp = (event: PointerEvent): void => {
    const down = this.down;
    if (!this.interactionEnabled || !down || event.pointerId !== down.id) return;
    this.releasePointer();
    if (this.disposed || !this.interactionEnabled || down.dragged || down.invalidated || event.timeStamp - down.time > 800) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) return;
    const target = this.pickAt(event.clientX, event.clientY);
    const action = this.actionForMesh(target);
    if (target && down.targetPoint) {
      const point = this.projectWorld(this.anchorWorld(target));
      if (Math.hypot(point.x - down.targetPoint.x, point.y - down.targetPoint.y) > 9) return;
    }
    // Both ends must hit the same actual mesh. A moving cart, new foreground customer,
    // a background press or a camera jump cannot retarget a captured press on release.
    if (target && target === down.target && action && down.action && JSON.stringify(action) === JSON.stringify(down.action)) this.onAction(action);
  };

  private actionForMesh(mesh: Mesh | null): CoffeeSceneAction | undefined {
    if (this.previewLayout && mesh) {
      for (let node: TransformNode | null = mesh; node; node = node.parent as TransformNode | null) {
        if (node.metadata?.coffeeFurnitureId) return { type: 'layout-select', id: node.metadata.coffeeFurnitureId };
      }
    }
    return mesh?.metadata?.coffeeAction as CoffeeSceneAction | undefined;
  }

  private pickAt(clientX: number, clientY: number): Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    if (this.disposed || !rect.width || !rect.height) return null;
    const cssX = clientX - rect.left, cssY = clientY - rect.top;
    if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return null;
    // Babylon applies hardware scaling in its ray helper; convert to logical coordinates once.
    const scale = this.engine.getHardwareScalingLevel();
    const x = cssX * this.engine.getRenderWidth() * scale / rect.width;
    const y = cssY * this.engine.getRenderHeight() * scale / rect.height;
    this.scene.updateTransformMatrix(true);
    // Pick the front visible solid, including people, furniture and all control mounts.
    // Restricting the predicate to actions would incorrectly click through occluding objects.
    const pick = this.scene.pick(x, y, undefined, false, this.camera);
    return pick?.hit && pick.pickedMesh instanceof Mesh ? pick.pickedMesh : null;
  }

  private visibleSurface(mesh: Mesh): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const action = mesh.metadata?.coffeeAction;
    const box = mesh.getBoundingInfo().boundingBox;
    // Check actual surface points, never enlarged invisible rectangles. Partial occlusion
    // leaves the visible part keyboard-usable while a fully covered object cannot activate.
    for (const [u, v] of [[0, 0], [-.35, 0], [.35, 0], [0, -.35], [0, .35], [-.35, .35], [.35, .35], [-.35, -.35], [.35, -.35]]) {
      const local = new Vector3((box.maximum.x - box.minimum.x) * u, (box.maximum.y - box.minimum.y) * v, 0);
      const point = this.projectWorld(Vector3.TransformCoordinates(local, mesh.getWorldMatrix()));
      const picked = this.pickAt(rect.left + point.x, rect.top + point.y);
      if (picked && picked.metadata?.coffeeAction && JSON.stringify(picked.metadata.coffeeAction) === JSON.stringify(action)) return true;
    }
    return false;
  }

  private projectWorld(world: Vector3): Vector3 {
    const rect = this.canvas.getBoundingClientRect();
    this.scene.updateTransformMatrix(true);
    const width = this.engine.getRenderWidth(), height = this.engine.getRenderHeight();
    const p = Vector3.Project(world, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(width, height));
    p.x *= rect.width / width; p.y *= rect.height / height;
    return p;
  }

  private projectMesh(mesh: Mesh): Vector3[] {
    mesh.computeWorldMatrix(true);
    return mesh.getBoundingInfo().boundingBox.vectorsWorld.map(point => this.projectWorld(point));
  }

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
      if (!mesh.isEnabled()) continue;
      const p = this.anchorWorld(mesh).subtract(this.baseTarget);
      const x = Vector3.Dot(p, this.screenRight), y = Vector3.Dot(p, this.screenUp);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (this.previewLayout || this.displayedLayout?.active) {
      const endX = this.displayedLayout?.expanded ? 16 : 10;
      for (const x of [-7, endX]) for (const z of [-3, 9]) {
        const p = new Vector3(x, .5, z).subtract(this.baseTarget);
        const sx = Vector3.Dot(p, this.screenRight), sy = Vector3.Dot(p, this.screenUp);
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
    }
    // Each anchor can be centered. The continuous room extends beyond these bounded views;
    // there is no zoom-out fitting step and keyboard and pointer use identical limits.
    this.panBounds = { left: minX, right: maxX, bottom: minY, top: maxY };
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

  /** Matte seamless ink; UV repetition is sized from the same physical room dimensions. */
  private surfacePattern(name: string, fill: string, seam: string, repeatU: number, repeatV: number, square: boolean): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(fill);
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    mat.disableLighting = false;
    mat.disableDepthWrite = false;
    if (typeof document !== 'undefined') {
      const texture = new DynamicTexture(`${name}-texture`, { width: 512, height: 512 }, this.scene, true);
      const ctx = texture.getContext();
      this.paintSurfacePattern(ctx, fill, seam, square);
      texture.hasAlpha = false;
      texture.wrapU = Texture.WRAP_ADDRESSMODE; texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.uScale = repeatU; texture.vScale = repeatV;
      texture.anisotropicFilteringLevel = 4;
      texture.update();
      mat.diffuseColor = Color3.White();
      mat.diffuseTexture = texture;
    }
    mat.metadata = { coffeePattern: { repeatU, repeatV, square, fill, seam, seamWidth: (square ? 3 : 8) / 512 } };
    return mat;
  }

  private paintSurfacePattern(ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>, fill: string, seam: string, square: boolean): void {
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = seam; ctx.fillRect(0, 0, square ? 3 : 8, 512);
    if (square) ctx.fillRect(0, 0, 512, 3);
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
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    mesh.scaling.copyFrom(size);
    mesh.position.copyFrom(position);
    mesh.material = this.material(color);
    if (shadow) this.staticCasters.add(mesh);
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
    // One continuous solid carries one square, world-scaled tile pattern. Raised per-tile
    // boxes gave the two grid directions different shadows and left a step at the wall.
    const floor = this.box('continuous-shop-floor', ROOM.width, .12, ROOM.depth,
      0, ROOM.floorY - .06, ROOM.rearZ + ROOM.depth / 2, COLORS.tile, undefined, false);
    // Babylon box top UVs run U along +Z and V along −X, so use the matching spans.
    floor.material = this.surfacePattern('floor-tile-ink', COLORS.tile, '#b9ad95', ROOM.depth / ROOM.tilePitch, ROOM.width / ROOM.tilePitch, true);
    floor.receiveShadows = true; floor.isPickable = true;
    floor.metadata = { coffeeEnvironment: true, coffeeSurface: 'floor', coffeePattern: { axes: 'xz', pitch: ROOM.tilePitch, originX: -ROOM.width / 2, originZ: ROOM.rearZ } };
    const wall = this.box('rear-wall', ROOM.width, 28, .22, 0, 14, ROOM.rearZ - .11, COLORS.cream, undefined, false);
    wall.isPickable = true; wall.metadata = { coffeeEnvironment: true, coffeeSurface: 'rear-wall' };
    // The wall panelling meets the floor and its seams are ink on the actual front plane,
    // rather than separately lit rods suspended ahead of the wall.
    const panels = this.box('rear-wainscot', ROOM.width, 1.22, .1, 0, .61, ROOM.rearZ + .05, COLORS.tealDark, undefined, false);
    panels.material = this.surfacePattern('wall-panel-ink', COLORS.tealDark, '#205f5b', ROOM.width / ROOM.panelPitch, 1, false);
    panels.metadata = { coffeeSurface: 'wall-panels', coffeePattern: { axes: 'xy', pitch: ROOM.panelPitch, originX: -ROOM.width / 2 } };
    this.box('wall-baseboard', ROOM.width, .08, .06, 0, .04, ROOM.rearZ + .13, COLORS.tealDark, undefined, false);
    this.box('wall-chair-rail', ROOM.width, .12, .17, 0, 1.28, ROOM.rearZ + .085, COLORS.woodLight, undefined, false);
    // The high rail is above the vault's separate wall-mounted upgrade plaque.
    this.box('wall-picture-rail', ROOM.width, .12, .15, 0, 4.82, ROOM.rearZ + .075, COLORS.woodLight, undefined, false);
    // The back-of-house route visually separates the cash manager from customer queues.
    this.box('manager-route', 10.4, 0.018, 0.86, 4.4, 0.009, WORLD.backZ, '#d4d2b8', undefined, false);
    for (let x = -.5; x < 9.5; x += 1.1) this.box(`route-dash-${x}`, 0.4, 0.008, 0.055, x, 0.022, WORLD.backZ - .05, '#f7f1dc', undefined, false);
    const brand = this.makeLabel('brand-sign', 3.9, 0.72, new Vector3(-6.45, 2.92, -3.42), undefined, { type: 'renovate' });
    this.paintLabel(brand, 'brand', (ctx, w, h) => {
      this.roundRect(ctx, 8, 8, w - 16, h - 16, 20, '#315d54');
      this.text(ctx, 'MELLOW BEAN', w / 2, h * .28, 36, '#b9d0b6');
      this.text(ctx, '装修 / 扩建  +', w / 2, h * .68, 62, '#fff5df');
    });
    this.makePlant('tall-plant-left', -9.08, -2.65, 1.12);
    this.makePlant('plant-right', 11.3, -2.55, 0.85);
    this.makePlant('entrance-plant', -9.0, 2.55, 0.7);
    this.makeBench();
    for (const [x, shade] of [[0, COLORS.teal], [5, COLORS.rose]] as const) {
      const rug = this.box(`queue-rug-${x}`, 2.33, 0.035, 5.55, x, 0.0175, 3.76, '#fcf7e9', undefined, false);
      rug.receiveShadows = true;
      const center = this.box(`queue-rug-color-${x}`, 2.08, 0.01, 5.3, x, 0.04, 3.76, shade, undefined, false);
      center.receiveShadows = true;
    }
    // The counter-side aisles join a separate return lane to the entrance-side boundary.
    // Crossings yield in the core; no threshold suggests disappearing at the rug end.
    const departureWidth = .65, returnDepth = .54;
    const returnNearZ = WORLD.exitZ - returnDepth / 2;
    for (const x of [0, 5]) {
      const exitX = x + WORLD.departureOffsetX;
      // Meet the cross-strip at its near edge, avoiding overlapping coplanar tops.
      const aisle = this.box(`departure-aisle-${x}`, departureWidth, .012, returnNearZ - WORLD.serviceZ,
        exitX, .006, (returnNearZ + WORLD.serviceZ) / 2, '#ded6c0', undefined, false);
      aisle.metadata = { coffeeFlow: 'outgoing' };
    }
    // Cover the entire outer aisle width; stopping on its centerline left the
    // screen-left bend missing its outside quarter under the oblique camera.
    const returnStartX = 5 + WORLD.departureOffsetX + departureWidth / 2;
    const returnLane = this.box('departure-return-lane', returnStartX - WORLD.exitX, .012, returnDepth,
      (returnStartX + WORLD.exitX) / 2, .006, WORLD.exitZ, '#ded6c0', undefined, false);
    returnLane.metadata = { coffeeFlow: 'outgoing' };
    const threshold = this.box('customer-exit-boundary', .18, .02, .72, WORLD.exitX, .01, WORLD.exitZ, '#8fafa1', undefined, false);
    threshold.metadata = { coffeeFlow: 'outgoing', coffeeRouteEndpoint: true };
    // The previous welcome strip at z=5 incorrectly advertised the shared return route.
    this.box('welcome-runner', 11.6, .012, .68, -.5, .006, WORLD.inboundZ, '#d5ccb4', undefined, false);
    for (const node of [...this.scene.meshes, ...this.scene.transformNodes]) {
      if (/^(manager-route$|route-dash-|queue-rug-|departure-aisle-|departure-return-lane$|customer-exit-boundary$|welcome-runner$|left-waiting-bench$|plant-right$)/.test(node.name)) this.legacyFurniture.push(node);
    }
  }

  private makeStation(id: CounterId, x: number, accent: string, deep: string, letter: string): Station {
    const root = new TransformNode(`${id}-station`, this.scene);
    root.position.x = x;
    root.metadata = { coffeeFurnitureId: id };
    // Blank wood remains a pickable occluding solid, without an upgrade action.
    this.box(`${id}-body`, 3.4, 1.04, 1.34, 0, 0.55, 0, COLORS.wood, root);
    this.box(`${id}-toe`, 3.25, 0.15, 1.25, 0, 0.08, 0, COLORS.woodDark, root);
    for (let i = 0; i < 7; i++) this.box(`${id}-wood-slat-${i}`, 0.36, 0.86, 0.03, -1.42 + i * 0.475, 0.57, 0.68, i % 2 ? COLORS.woodLight : '#bc8458', root, false);
    this.box(`${id}-countertop`, 3.65, 0.16, 1.58, 0, 1.13, 0, COLORS.metal, root);
    this.box(`${id}-top-inset`, 3.38, 0.025, 1.33, 0, 1.222, 0, '#d5d6c9', root, false);
    this.box(`${id}-front-accent`, 3.48, 0.08, 0.08, 0, 0.94, 0.716, deep, root, false);
    // The fixed camera projects positive world X to screen-left: coffee stays left,
    // upgrade stays right. Each mounted plaque owns only its own physical action.
    const plaque = this.makeLabel(`${id}-upgrade-plaque`, 1.32, 1.04, new Vector3(-1.01, 0.55, 0.765), root, { type: 'counter', id }, 512, 448, 0);
    plaque.mesh.metadata = { ...plaque.mesh.metadata, coffeeSurface: 'counter-front' };
    this.registerAnchor(`${id}-upgrade`, plaque.mesh);
    const selection = this.box(`${id}-selected`, 3.83, 0.022, 1.77, 0, 0.038, 0, '#e9c96e', root, false);
    selection.material = this.material('#e9c96e', true, 0.83);
    selection.isPickable = false;
    selection.setEnabled(false);
    // Both independent controls are pasted onto the counter's front, within its body height.
    const selector = this.makeLabel(`${id}-recipe-selector`, 1.32, 1.04, new Vector3(1.01, .55, .765), root, { type: 'recipe', id }, 512, 448, 0);
    selector.mesh.metadata = { ...selector.mesh.metadata, coffeeSurface: 'counter-front' };
    this.registerAnchor(`${id}-recipe`, selector.mesh);
    const barista = this.makePerson(`${id}-barista`, id === 'counter-a' ? 2 : 3, accent, false);
    barista.root.parent = root;
    barista.root.position.set(-0.5, 0, -0.89);
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
    // Notes and their amount tag share one counter-mounted cash location. The tag lies flat
    // immediately beside the real notes, rather than becoming an above-counter register.
    const cashRoot = new TransformNode(`${id}-cash-cluster`, this.scene);
    cashRoot.parent = root;
    cashRoot.position.set(-1.08, 1.25, .04);
    const cash: TransformNode[] = [];
    for (let pile = 0; pile < 6; pile++) {
      const stack = this.makeCashStack(`${id}-cash-${pile}`, cashRoot);
      stack.position.set(-.20 + (pile % 2) * .40, Math.floor(pile / 2) * .095, -.08 + (pile % 2) * .16);
      stack.setEnabled(false);
      cash.push(stack);
    }
    const cashTag = new TransformNode(`${id}-cash-tag`, this.scene);
    cashTag.parent = cashRoot;
    cashTag.position.set(0, .012, .40);
    cashTag.rotation.x = -Math.PI / 2;
    const cashLabel = this.makeLabel(`${id}-cash-total`, 1.4, .64, new Vector3(0, 0, .012), cashTag, undefined, 512, 192, .025);
    cashLabel.mesh.metadata = {
      ...cashLabel.mesh.metadata, coffeeDisplay: 'pending-cash', coffeeCashRoot: cashRoot.name,
      coffeeGlyphHeight: .64 * 124 / 192, coffeeGlyphCenter: .60,
    };
    cashRoot.setEnabled(false);
    // The meter is a physical inset on the espresso machine front, not a floating bar.
    const progressRoot = CreateBox(`${id}-progress`, { width: .98, height: .13, depth: .018 }, this.scene);
    progressRoot.parent = machine;
    progressRoot.position.set(-.05, .36, .191);
    progressRoot.material = this.material('#faf5e5');
    progressRoot.receiveShadows = true;
    const progressFill = this.box(`${id}-progress-fill`, 1, .072, .018, -.45, 0, .018, accent, progressRoot, false);
    progressRoot.metadata = { coffeeDisplay: 'brew-progress' };
    progressRoot.setEnabled(false);
    const station: Station = { root, barista, progressRoot, progressFill, plaque, selector, cashLabel, cashRoot, cash, machineExtras: extras, readyCup, selection, level: -1, recipe: '', pendingCash: -1 };
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
    const menu: Menu = { label: board, level: -1 };
    this.menus.set(recipe, menu);
    this.updateMenu(recipe, menu, 1);
  }

  private updateMenu(recipe: RecipeId, menu: Menu, level: number): void {
    if (menu.level === level) return;
    const espresso = recipe === 'espresso';
    const price = coffeePrice(recipe, level), brewSeconds = coffeeBrewSeconds(recipe, level);
    // This is shared coffee progression, before any counter-specific modifier.
    menu.label.mesh.metadata = { ...menu.label.mesh.metadata, coffeeMenu: { recipe, level, price, brewSeconds } };
    this.paintLabel(menu.label, `${recipe}-${level}`, (ctx, w, h) => {
      this.roundRect(ctx, 1, 1, w - 2, h - 2, 15, '#2e4843');
      this.text(ctx, '咖啡菜单', w / 2, 55, 44, '#ead4a1');
      ctx.strokeStyle = '#648275'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(62, 87); ctx.lineTo(w - 62, 87); ctx.stroke();
      ctx.fillStyle = espresso ? '#d49c5b' : '#91bab0';
      ctx.beginPath(); ctx.moveTo(w / 2 - 58, 116); ctx.lineTo(w / 2 + 58, 116); ctx.lineTo(w / 2 + 43, 209); ctx.lineTo(w / 2 - 43, 209); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f7ebd7'; ctx.fillRect(w / 2 - 63, 109, 126, 18);
      ctx.fillStyle = '#523c2f'; ctx.fillRect(w / 2 - 50, 133, 100, 18);
      this.text(ctx, espresso ? '浓缩咖啡' : '拿铁咖啡', w / 2, 263, 78, '#faf1db');
      this.text(ctx, `${cashText(price)}  ·  ${brewSeconds.toFixed(2)}s`, w / 2, 328, 52, '#ead4a1');
      this.text(ctx, `Lv. ${level} · 查看 +`, w / 2, 400, 50, '#ead4a1');
    });
    menu.level = level;
  }

  private updateStation(station: Station, counter: Counter, paused: boolean): void {
    if (station.level !== counter.level) {
      this.paintLabel(station.plaque, `level-${counter.level}`, (ctx, w, h) => {
        this.roundRect(ctx, 8, 8, w - 16, h - 16, 24, '#f5d98b');
        this.text(ctx, `${counter.id.slice(-1).toUpperCase()} ${counter.level}  ↑`, w / 2, h / 2 + 1, 112, '#5a492b');
      });
      station.machineExtras[0].setEnabled(counter.level >= 2);
      station.machineExtras[1].setEnabled(counter.level >= 6);
      station.level = counter.level;
      this.shadowGenerator?.getShadowMap()?.resetRefreshCounter();
    }
    if (station.recipe !== counter.recipe) {
      const espresso = counter.recipe === 'espresso';
      this.paintLabel(station.selector, counter.recipe, (ctx, w, h) => {
        this.roundRect(ctx, 3, 3, w - 6, h - 6, 22, '#f5efda');
        this.text(ctx, espresso ? '浓缩' : '拿铁', w / 2, h * .35, 120, '#315d54');
        this.text(ctx, '配方 ↔', w / 2, h * .76, 82, '#a4773f');
      });
      station.recipe = counter.recipe;
    }
    if (station.pendingCash !== counter.pendingCash) {
      const piles = counter.pendingCash > 0 ? Math.min(6, Math.max(1, Math.ceil(counter.pendingCash / 450))) : 0;
      station.cash.forEach((stack, i) => stack.setEnabled(i < piles));
      station.cashRoot.setEnabled(counter.pendingCash > 0);
      station.cashLabel.mesh.metadata = { ...station.cashLabel.mesh.metadata, coffeeAmount: counter.pendingCash };
      if (counter.pendingCash > 0) this.paintLabel(station.cashLabel, `${counter.pendingCash}`, (ctx, w, h) => {
        this.roundRect(ctx, 5, 5, w - 10, h - 10, 24, '#f4f5df');
        // Front receipt region is clear of the notes. Longer precise amounts scale to fit.
        const font = this.text(ctx, cashText(counter.pendingCash), w / 2, h * .60, 124, '#477448', w - 28);
        station.cashLabel.mesh.metadata = { ...station.cashLabel.mesh.metadata, coffeePaintedFontSize: font };
      });
      station.pendingCash = counter.pendingCash;
    }
    const brew = counter.brew;
    const progress = brew ? clamp(brew.elapsed / Math.max(0.001, brew.duration)) : 0;
    station.progressRoot.setEnabled(Boolean(brew));
    station.progressFill.scaling.x = Math.max(0.015, progress * .90);
    station.progressFill.position.x = -.45 + station.progressFill.scaling.x / 2;
    station.readyCup.setEnabled(Boolean(brew) && progress > 0.32 && progress < 1);
    if (brew) station.readyCup.scaling.setAll(brew.recipe === 'espresso' ? 0.82 : 1);
    if (!paused) {
      const pulse = Math.sin(this.animationTime * 5.2);
      station.barista.rightArm.rotation.x = brew ? -0.78 + pulse * 0.2 : -0.12;
      station.barista.leftArm.rotation.x = brew ? -0.4 - pulse * 0.15 : -0.12;
      station.barista.root.position.y = brew ? Math.max(0, pulse) * 0.019 : 0;
    }
    station.barista.root.computeWorldMatrix(true);
    const baristaPosition = station.barista.root.getAbsolutePosition();
    station.barista.shadow.position.set(baristaPosition.x, CONTACT_SHADOW_Y, baristaPosition.z);
    station.barista.shadow.setEnabled(station.root.isEnabled());
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
    const shadow = this.shape('cylinder', `${name}-contact-shadow`, new Vector3(0.95, 0.008, 0.65), new Vector3(0, CONTACT_SHADOW_Y, 0), '#30433b', undefined, false);
    shadow.material = this.material('#30433b', false, 0.12);
    shadow.isPickable = false;
    // Moving silhouettes use one cheap contact shadow, never the static shadow map.
    for (const mesh of root.getChildMeshes()) this.staticCasters.delete(mesh as Mesh);
    return { root, leftArm, rightArm, leftLeg, rightLeg, cup, shadow, previousX: 0, previousZ: 0 };
  }

  private updateCustomer(person: Person, customer: Customer, dt: number): void {
    const dx = customer.x - person.previousX;
    const dz = customer.z - person.previousZ;
    const walking = (customer.phase === 'entering' || customer.phase === 'leaving' || Math.hypot(dx, dz) > 0.005) && dt > 0;
    // The app supplies adjacent-step interpolated coordinates. A second lag filter
    // would reintroduce speed pulses and make the pose depend on display refresh.
    person.root.position.x = customer.x;
    person.root.position.z = customer.z;
    if (Math.hypot(dx, dz) > 0.003 && walking) {
      const target = Math.atan2(dx, dz);
      const current = person.root.rotation.y;
      const delta = ((target - current + Math.PI * 3) % TAU) - Math.PI;
      person.root.rotation.y += delta * (1 - Math.exp(-dt * 14));
    } else if (customer.phase === 'queue' || customer.phase === 'serving' || customer.phase === 'receiving') {
      const station = this.stations.get(customer.counterId);
      person.root.rotation.y = Math.PI + (station?.root.rotation.y ?? 0);
    }
    const gait = walking ? Math.sin(this.animationTime * 9 + customer.id * 0.91) * 0.33 : 0;
    if (dt > 0) {
      person.leftLeg.rotation.x = gait;
      person.rightLeg.rotation.x = -gait;
      person.leftArm.rotation.x = -gait * 0.7;
      person.rightArm.rotation.x = customer.hasCup || customer.phase === 'receiving' ? -0.95 : gait * 0.7;
      person.root.position.y = walking ? Math.abs(gait) * 0.035 : Math.sin(this.animationTime * 2 + customer.id) * 0.008;
    }
    if (customer.phase === 'dining') {
      const table = this.displayedLayout?.furniture.find(item => item.id === customer.seatId && item.kind === 'table' && !item.stored);
      if (table) {
        const seat = interactionPoint(table, 'seat');
        person.root.position.set(seat.x, -.045, seat.z);
        person.root.rotation.y = Math.PI - table.rotation * Math.PI / 2;
        person.leftLeg.rotation.x = -1.4; person.rightLeg.rotation.x = -1.4;
        person.leftArm.rotation.x = -.7; person.rightArm.rotation.x = -1.02;
      }
    } else if (dt === 0) {
      // A paused or newly loaded snapshot still has the correct non-seated pose.
      person.root.position.y = 0; person.leftLeg.rotation.x = 0; person.rightLeg.rotation.x = 0;
    }
    person.cup.setEnabled(customer.hasCup || customer.phase === 'receiving');
    // During receipt the outstretched hand makes the actual cup transition legible.
    if (customer.phase === 'receiving' && dt > 0) person.rightArm.rotation.x = -1.13 + Math.sin(this.animationTime * 5) * 0.08;
    person.shadow.position.set(person.root.position.x, CONTACT_SHADOW_Y, person.root.position.z);
    person.previousX = customer.x;
    person.previousZ = customer.z;
  }

  private updateManager(state: Readonly<SliceState>, dt: number): void {
    const person = this.manager;
    const manager = state.manager;
    if (this.lastManagerLevel !== manager.level) {
      this.paintLabel(this.vaultLabel, `manager-${manager.level}`, (ctx, w, h) => {
        this.roundRect(ctx, 6, 6, w - 12, h - 12, 22, '#f1dd9f');
        this.text(ctx, '金库', w / 2, h * .23, 100, '#405a45');
        this.text(ctx, `经理 Lv.${manager.level} ↑`, w / 2, h * .58, 70, '#405a45');
        this.text(ctx, '存款 / 升级', w / 2, h * .84, 48, '#405a45');
      });
      this.vaultLabel.mesh.metadata = { ...this.vaultLabel.mesh.metadata, coffeeManagerLevel: manager.level };
      this.lastManagerLevel = manager.level;
    }
    const x = manager.x;
    const dx = x - person.previousX;
    const dz = manager.z - person.previousZ;
    const activeLayout = Boolean(this.displayedLayout?.active);
    // A moving phase can be waiting for the shared aisle. No path means no
    // actual step in an active layout; retain the previous legacy animation.
    const moving = manager.phase === 'moving' && dt > 0 && (!activeLayout || Boolean(manager.nav?.length));
    person.root.scaling.setAll(activeLayout ? .8 : .97);
    // Shared interpolated snapshots keep the cart, manager and handoff state together;
    // raw core positions otherwise jump at 20Hz even when the GPU draws at 60Hz.
    person.root.position.x = x;
    person.root.position.z = manager.z;
    if (moving && Math.hypot(dx, dz) > 0.003) person.root.rotation.y = Math.atan2(dx, dz);
    else if (manager.phase === 'collecting') {
      const station = this.displayedLayout?.active ? this.stations.get(state.counters[manager.target]?.id) : undefined;
      person.root.rotation.y = station ? Math.atan2(station.root.position.x - x, station.root.position.z - manager.z) : 0;
    }
    else if (manager.phase === 'depositing') person.root.rotation.y = -Math.PI / 2;
    if (dt > 0) {
      const gait = moving ? Math.sin(this.animationTime * 10.5) * 0.3 : 0;
      person.leftLeg.rotation.x = gait;
      person.rightLeg.rotation.x = -gait;
      person.leftArm.rotation.x = activeLayout ? (moving ? -.3 : -.12) : moving ? -.75 : -.25;
      person.rightArm.rotation.x = activeLayout
        ? manager.phase === 'collecting' || manager.phase === 'depositing' ? -.4 + Math.sin(this.animationTime * 5) * .04 : moving ? -.3 : -.12
        : manager.phase === 'collecting' || manager.phase === 'depositing' ? -1 + Math.sin(this.animationTime * 5) * .12 : -.65;
      person.root.position.y = moving ? Math.abs(gait) * 0.026 : 0;
    }
    if (activeLayout) {
      // Also bound a frozen pose carried across the first legacy-to-layout frame.
      person.leftArm.rotation.x = clamp(person.leftArm.rotation.x, -.3, .3);
      person.rightArm.rotation.x = clamp(person.rightArm.rotation.x, -.44, .3);
    }
    // The trolley follows the bounded service lane in world orientation. The manager
    // turns to reach stations; that turn must not orbit a wide trolley through the wall.
    if (activeLayout) {
      // The core reserves actor centres one metre apart. Keep the whole live
      // manager + small close-in trolley inside a <.5 m radial footprint, rather
      // than trailing a full trolley into another actor's tile at a corner.
      this.managerCart.scaling.setAll(.43);
      this.managerCart.rotation.y = person.root.rotation.y;
      this.managerCart.position.set(person.root.position.x + Math.cos(person.root.rotation.y) * .22, 0, person.root.position.z - Math.sin(person.root.rotation.y) * .22);
    } else {
      this.managerCart.scaling.setAll(1); this.managerCart.rotation.y = 0;
      this.managerCart.position.set(person.root.position.x + .70, 0, person.root.position.z - .55);
    }
    const stacks = manager.carrying > 0 ? Math.min(6, Math.max(1, Math.ceil(manager.carrying / 600))) : 0;
    if (stacks !== this.lastCartStacks) {
      this.cartCash.forEach((cash, i) => cash.setEnabled(i < stacks));
      this.lastCartStacks = stacks;
    }
    person.shadow.position.set(person.root.position.x, CONTACT_SHADOW_Y, person.root.position.z);
    person.previousX = x;
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
    const root = new TransformNode('manager-cash-cart', this.scene);
    this.managerCart = root;
    root.position.set(parent.position.x + .70, 0, parent.position.z - .55);
    // A small, fixed-world-orientation money trolley. It has no action metadata or clipboard.
    this.box('cart-base', .92, .10, .64, 0, .29, 0, '#866748', root);
    for (const x of [-.42, .42]) {
      this.box(`cart-rail-${x}`, .045, .12, .62, x, .38, 0, COLORS.gold, root);
      for (const z of [-.25, .25]) this.cylinder(`cart-wheel-${x}-${z}`, .18, .065, x, .14, z, '#394844', root).rotation.z = Math.PI / 2;
    }
    this.box('cart-handle-post', .04, .47, .04, -.44, .58, .25, COLORS.steel, root);
    this.box('cart-handle', .30, .055, .055, -.48, .78, .25, COLORS.dark, root);
    this.box('cart-cash-table', .88, .08, .44, 0, .74, 0, COLORS.woodLight, root);
    for (const x of [-.32, .32]) this.box(`cart-cash-support-${x}`, .055, .43, .055, x, .51, 0, COLORS.woodDark, root);
    for (let pile = 0; pile < 6; pile++) {
      const stack = this.makeCashStack(`cart-cash-${pile}`, root);
      stack.position.set(-.20 + (pile % 2) * .40, .785 + Math.floor(pile / 2) * .085, 0);
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
    const label = this.makeLabel('invite-guest-sign', 2.48, 1.05, new Vector3(-8, 1.48, 5.62), undefined, { type: 'invite' }, 768, 288);
    this.registerAnchor('invite', label.mesh);
    this.paintLabel(label, 'ready', (ctx, w, h) => {
      this.roundRect(ctx, 8, 8, w - 16, h - 16, 30, '#dca84b');
      this.text(ctx, '迎接顾客  +', w / 2, h / 2 + 2, 94, '#ffffff');
    });
    this.box('entry-arrow-stem', 0.62, 0.019, 0.14, -7.4, 0.066, 5.01, '#fff4da', undefined, false);
    const arrow = this.box('entry-arrow-top', 0.32, 0.019, 0.11, -7.15, 0.067, 4.89, '#fff4da', undefined, false); arrow.rotation.y = Math.PI / 4;
    const arrow2 = this.box('entry-arrow-bottom', 0.32, 0.019, 0.11, -7.15, 0.067, 5.13, '#fff4da', undefined, false); arrow2.rotation.y = -Math.PI / 4;
    pad.isPickable = true; pad.metadata = { coffeeAction: { type: 'invite' } };
    return label;
  }

  private makeVault(): { lamp: Mesh; label: Label } {
    const vault = new TransformNode('cash-vault', this.scene); vault.position.set(WORLD.vaultX, 1.18, -3.09);
    this.box('vault-wall-bracket', 1.63, .12, .75, 0, .09, -.02, COLORS.woodDark, vault);
    this.box('vault-body', 1.48, 1.28, 0.88, 0, 0.77, 0, '#466660', vault);
    const door = this.box('vault-door', 1.26, 1.06, 0.08, 0, 0.79, 0.48, '#739286', vault);
    door.isPickable = true; door.metadata = { coffeeAction: { type: 'vault' } };
    this.box('vault-door-inset', 1.04, 0.86, 0.035, 0, 0.78, 0.534, '#405f58', vault);
    const wheel = this.cylinder('vault-wheel', 0.34, 0.072, 0, 0.78, 0.594, '#d8be76', vault); wheel.rotation.x = Math.PI / 2;
    this.box('vault-wheel-spoke', 0.29, 0.065, 0.045, 0, 0.78, 0.642, '#775d35', vault, false);
    this.box('vault-slot', 0.54, 0.063, 0.07, 0, 1.13, 0.55, '#213e37', vault, false);
    // Mount this plaque on the wall ABOVE the whole vault silhouette. A front-door
    // label would overlap its icon under the fixed oblique view even with a small Y gap.
    // Keep a compact visible gap above the complete icon rather than a distant wall sign.
    const label = this.makeLabel('vault-bank-label', 1.55, 1.04, new Vector3(0, 2.59, -.46), vault, { type: 'vault' }, 512, 384);
    label.mesh.metadata = { ...label.mesh.metadata, coffeeSurface: 'vault-upgrade-plaque' };
    this.registerAnchor('vault', label.mesh);
    const lamp = this.cylinder('vault-deposit-light', 0.12, 0.045, 0.48, 1.14, 0.56, '#92bfa3', vault, false); lamp.rotation.x = Math.PI / 2;
    return { lamp, label };
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

  private makeLabel(name: string, width: number, height: number, position: Vector3, parent?: TransformNode, action?: CoffeeSceneAction, pixels = 768, pixelHeight = 192, rim = .10): Label {
    // Every label is ink on a real opaque slab. Its material follows the room's light,
    // ordinary depth testing and shadow reception; no billboard or rendering-group HUD.
    const mount = this.box(`${name}-mount`, width + rim, height + rim, .075, position.x, position.y, position.z - .05, '#806345', parent);
    if (action) mount.metadata = { coffeeAction: action };
    const mesh = CreatePlane(name, { width, height, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    mesh.position.copyFrom(position);
    if (parent) mesh.parent = parent;
    mesh.rotation.y = Math.PI;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    mesh.metadata = { coffeeLabel: true, coffeeMount: mount.name, ...(action ? { coffeeAction: action } : {}) };
    const mat = new StandardMaterial(`${name}-label-material`, this.scene);
    mat.diffuseColor = Color3.White();
    mat.emissiveColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = false;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = false;
    let texture: DynamicTexture | null = null;
    // NullEngine QA intentionally skips canvas ink while retaining the same physical material.
    if (typeof document !== 'undefined') {
      texture = new DynamicTexture(`${name}-ink`, { width: pixels, height: pixelHeight }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      texture.hasAlpha = false;
      // Preserve fine ink on the oblique physical signs, without repainting it each frame.
      texture.anisotropicFilteringLevel = 8;
      mat.diffuseTexture = texture;
    } else mat.diffuseColor = Color3.FromHexString('#f1dba1');
    mesh.material = mat;
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
    ctx.fillStyle = '#eee4ca';
    ctx.fillRect(0, 0, size.width, size.height);
    paint(ctx, size.width, size.height);
    label.texture.update();
  }

  private text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, maxWidth?: number): number {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    if (maxWidth !== undefined) {
      const measured = ctx.measureText(value).width;
      if (measured > maxWidth) { size *= maxWidth / measured; ctx.font = `700 ${size}px system-ui, sans-serif`; }
    }
    ctx.fillText(value, x, y);
    return size;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, color: string): void {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  /** Read-only QA counters; NullEngine values are structural, not GPU timing. */
  readRenderStats() {
    return {
      renderMode: this.renderMode, targetFps: RENDER_MODES[this.renderMode].fps, renderedFrames: this.renderedFrames,
      renderWidth: this.engine.getRenderWidth(), renderHeight: this.engine.getRenderHeight(),
      meshCount: this.scene.meshes.length,
      frozenMeshes: this.scene.meshes.filter(mesh => mesh.isWorldMatrixFrozen).length,
      staticShadowCasters: this.shadowGenerator?.getShadowMap()?.renderList?.length ?? 0,
      shadowRefreshRate: this.shadowGenerator?.getShadowMap()?.refreshRate ?? null,
    };
  }

  private prepareStaticGeometry(): void {
    // Freeze only truly immobile world geometry. Cash clusters intentionally retain
    // parent-transform semantics; people, cups, progress, trolley and contact shadows move.
    const moving = new Set<TransformNode>([this.manager.root, this.manager.shadow, this.managerCart]);
    for (const person of this.customers.values()) { moving.add(person.root); moving.add(person.shadow); }
    if (this.renovationGhost) moving.add(this.renovationGhost);
    for (const station of this.stations.values()) {
      for (const root of [station.barista.root, station.barista.shadow, station.readyCup, station.progressFill, station.cashRoot]) moving.add(root);
    }
    const isMoving = (mesh: Mesh): boolean => {
      for (let node: TransformNode | null = mesh; node; node = node.parent as TransformNode | null) if (moving.has(node)) return true;
      return false;
    };
    for (const mesh of this.scene.meshes) {
      if (!(mesh instanceof Mesh)) continue;
      if (isMoving(mesh)) { mesh.unfreezeWorldMatrix(); this.staticCasters.delete(mesh); continue; }
      // Keep reusable source geometries and interactive anchor hierarchies unfrozen.
      // They must retain correct picking if a diagnostic/layout move occurs.
      if (mesh.name.startsWith('shared-') || mesh.name.startsWith('vault-')) continue;
      mesh.freezeWorldMatrix();
    }
    for (const mesh of this.staticCasters) {
      if (mesh.isDisposed()) this.staticCasters.delete(mesh);
      else this.shadowGenerator?.addShadowCaster(mesh, false);
    }
    // Static furniture shadows are rendered once, and invalidated only by an upgrade.
    const shadowMap = this.shadowGenerator?.getShadowMap();
    if (shadowMap) shadowMap.refreshRate = 0;
  }
}
