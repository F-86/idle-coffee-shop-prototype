import {counterOrdinal} from '../core/furnitureIds';
import { BackdropEnvironment, exteriorBounds, type CoffeeBackdrop } from './BackdropEnvironment';
import { cameraFrame, constrainPan, panForTarget, type Bounds2, type Point2 } from './CameraFraming';
export type { CoffeeBackdrop } from './BackdropEnvironment';
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
import type { Counter, CounterId, Customer, ShopLayout, SliceState } from '../core/types';
import {seatLevel} from '../core/upgrades';
import { GRID, layoutBounds, expansionSteps, MAX_EXPANSION_STEPS, furnitureCells, getLayout, interactionPoint, layoutExitAnchor } from '../core/layout';
import { DEFAULT_RENDER_MODE, RENDER_MODES, renderPixelRatio, type RenderMode } from './RenderBudget';

export type CoffeeSceneAction =
  | { type: 'invite' }
  | { type: 'seat'; id: string }
  | { type: 'counter'; id: CounterId }
  | { type: 'recipe'; id: CounterId }
  | { type: 'renovate' }
  | { type: 'layout-select'; id: string }
  | { type: 'layout-cell'; x: number; z: number }
  | { type: 'layout-drag'; phase: 'start' | 'move' | 'end' | 'cancel'; id: string; clientX: number; clientY: number };

export type CoffeeSceneAnchor =
  | 'invite' | `${CounterId}-upgrade` | `${CounterId}-recipe`
  | 'expansion' | `seat:${string}`;
export interface AnchorProjection { x: number; y: number; visible: boolean }

/** The optional engine is a QA seam; normal callers only supply canvas and action callback. */
export interface CoffeeSceneOptions { engine?: AbstractEngine; shadows?: boolean; renderMode?: RenderMode }

type Shape = 'box' | 'cylinder' | 'sphere' | 'ring';
type PointerGesture = { id: number; x: number; y: number; lastX: number; lastY: number; time: number; dragged: boolean; target: Mesh | null; targetPoint: Vector3 | null; invalidated: boolean; action?: CoffeeSceneAction };
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
  machineExtras: TransformNode[];
  readyCup: TransformNode;
  selection: Mesh;
  level: number;
  recipe: string;
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
// Raised slightly above the continuous floor to prevent contact-shadow z-fighting.
const CONTACT_SHADOW_Y = .074;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
// Fixed-camera room coordinates, shared by its solids and their world-scaled patterns.
const ROOM = { width: 18, depth: 13, centerX: 1.5, centerZ: 3, floorY: 0, rearZ: -3.5, sideX: -7.5, height: 3.3, tilePitch: 1, panelPitch: .72 };
const BACKDROPS = { garden: { lawn: '#a8ba83', paving: '#d7c9ae', sky: '#b5c598ff' }, terrace: { lawn: '#c1bdac', paving: '#b1aaa0', sky: '#cec9b8ff' }, sunset: { lawn: '#b4a27c', paving: '#d9b49b', sky: '#dbc2a0ff' } } as const;

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
  private readonly baseTarget = new Vector3(2.1, .6, 2.8);
  private readonly cameraOffset = new Vector3(10, 16, 22);
  private readonly screenRight: Vector3;
  private readonly screenUp: Vector3;
  private readonly anchors = new Map<CoffeeSceneAnchor, Mesh>();
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private minimumZoom = .6;
  private frameFootprint = '';
  private frameContent: Bounds2 | null = null;
  private homePan: Point2 = {x:0,y:0};
  private panRegion: Point2[] = [{x:0,y:0}];
  private viewportSize = '';
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; x: number; y: number } | null = null;
  private panBounds = { left: 0, right: 0, bottom: 0, top: 0 };
  private readonly staticCasters = new Set<Mesh>();
  private renderedFrames = 0;
  private renderMode: RenderMode;
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly shapes = new Map<Shape, Mesh>();
  private readonly customers = new Map<number, Person>();
  private readonly stations = new Map<CounterId, Station>();
  private readonly tables = new Map<string, TransformNode>();
  private readonly chairPoses = new Map<string, { tableId: string; x: number; z: number; yaw: number }>();
  private readonly counterServicePoses = new Map<CounterId, { x: number; z: number; yaw: number }>();
  private readonly gridCells = new Map<string, Mesh>();
  private exteriorLawn!: Mesh;
  private readonly exteriorPaving: Mesh[] = [];
  private exitRoot!: TransformNode;
  private groupGhosts=new Map<string,Mesh>();
  private renovationSelection:string[]=[];
  private tableLabels = new Map<string,Label>();
  private backdropEnvironment!: BackdropEnvironment;
  private expandedRear!: TransformNode;
  private expansionRoot!: TransformNode;
  private expansionFloor!: Mesh;
  private expansionTiles!: StandardMaterial;
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
  private readonly recipeImages = new Map<string, HTMLImageElement>();
  private readonly shadowGenerator: ShadowGenerator | null;
  private disposed = false;
  private interactionEnabled = true;
  private animationTime = 0;
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
    this.loadRecipeIcons();
    this.makeEnvironment();
    this.stations.set('counter-a', this.makeStation('counter-a', 0, COLORS.teal, COLORS.tealDark, 'A'));
    this.stations.set('counter-b', this.makeStation('counter-b', 5, COLORS.rose, COLORS.roseDark, 'B'));
    this.makeEntrance();
    this.makeExpansion();
    this.prepareStaticGeometry();
    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('pointercancel', this.handleCancel);
    canvas.addEventListener('lostpointercapture', this.handleCancel);
    canvas.addEventListener('blur', this.handleBlur);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    if (typeof window !== 'undefined') window.addEventListener('blur', this.handleBlur);
    this.resize();
  }

  /** Advances presentation only; the caller supplies the authoritative snapshot each frame. */
  update(state: Readonly<SliceState>, dt: number): void {
    if (this.disposed) return;
    const frame = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    // Closing admissions drains guests online; only the empty closed shop is still.
    const animating = !state.paused || state.customers.length > 0;
    if (animating) this.animationTime += frame;
    const motion = animating ? frame : 0;
    this.liveLayout = getLayout(state);
    this.reconcileLayout(this.previewLayout ?? this.liveLayout);
    for (const counter of state.counters) {
      const station = this.stations.get(counter.id);
      if (station) this.updateStation(station, counter, !animating);
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
        person.root.rotation.y = this.initialCustomerYaw(customer);
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
  setRenovationPreview(layout: ShopLayout | null, selectedId: string | null = null, valid = true, selectedIds:readonly string[]=[]): void {
    if (this.disposed) return;
    const modeChanged = Boolean(this.previewLayout) !== Boolean(layout);
    if (modeChanged) { this.clearTouchGesture(); this.releasePointer(); }
    this.previewLayout = layout ? structuredClone(layout) : null;
    this.renovationSelected = selectedId;this.renovationSelection=[...new Set(selectedIds)];
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

  /** CSS position of the presented object, including stored catalogue items. */
  projectLayoutItem(id: string): AnchorProjection {
    const layout = this.previewLayout ?? this.displayedLayout;
    const item = layout?.furniture.find(item => item.id === id);
    if (!item || this.disposed) return { x: 0, y: 0, visible: false };
    const p = this.projectWorld(new Vector3(item.x, .55, item.z));
    const rect = this.canvas.getBoundingClientRect();
    return { x: p.x, y: p.y, visible: p.z >= 0 && p.z <= 1 && p.x >= 0 && p.x <= rect.width && p.y >= 0 && p.y <= rect.height };
  }

  /**
   * Pointer projection is independent of foreground furniture, people and editor ink.
   * Keep out-of-bounds rounded coordinates for a red draft; never clamp an illegal drop.
   */
  pickLayoutPlacement(clientX: number, clientY: number, id: string): { x: number; z: number } | null {
    const layout = this.previewLayout ?? this.displayedLayout;
    const coordinates = this.pickCoordinates(clientX, clientY);
    if (!layout || !coordinates) return null;
    if (id.startsWith('menu-')) return null;
    this.scene.updateTransformMatrix(true);
    const ray = this.scene.createPickingRay(coordinates.x, coordinates.y, Matrix.Identity(), this.camera);
    const denominator = ray.direction.y;
    if (Math.abs(denominator) < 1e-8) return null;
    const distance = (ROOM.floorY - ray.origin.y) / denominator;
    if (!Number.isFinite(distance) || distance < 0) return null;
    const position = ray.origin.add(ray.direction.scale(distance));
    return { x: Math.round(position.x) || 0, z: Math.round(position.z) || 0 };
  }

  /** Cancel only the current gesture, without re-entering the host's draft controller. */
  cancelLayoutDrag(): void { this.releasePointer(false); }

  private reconcileLayout(layout: ShopLayout): void {
    // Traffic scheduling and economy ticks do not rebuild or reallocate furniture.
    const signature = JSON.stringify([layout.active, expansionSteps(layout), layout.furniture.map(item => [item.id, item.kind, item.counterId, item.x, item.z, item.rotation, item.stored, item.level])]);
    this.displayedLayout = layout;
    if (signature === this.layoutSignature) return;
    this.layoutSignature = signature;
    const items = layout.furniture.filter(item => !item.stored);
    this.chairPoses.clear();
    this.counterServicePoses.clear();
    for (const item of items) {
      if (item.kind === 'table') {
        const seat = interactionPoint(item, 'seat');
        this.chairPoses.set(`${seat.x},${seat.z}`, { tableId: item.id, ...seat, yaw: Math.atan2(item.x - seat.x, item.z - seat.z) });
      } else if (item.counterId) {
        const service = interactionPoint(item, 'service');
        this.counterServicePoses.set(item.counterId, { ...service, yaw: Math.atan2(item.x - service.x, item.z - service.z) });
      }
    }
    const counters = new Set(items.filter(item => item.kind === 'counter').map(item => item.counterId!));
    for (const [id, station] of this.stations) {
      if (counters.has(id)) continue;
      this.disposeFurnitureRoot(station.root);
      station.barista.shadow.dispose(false, false);
      this.stations.delete(id);
    }
    const tableIds = new Set(items.filter(item => item.kind === 'table').map(item => item.id));
    for (const [id, root] of this.tables) if (!tableIds.has(id)) { this.disposeFurnitureRoot(root); this.tables.delete(id); this.tableLabels.delete(id); }
    const palette = [[COLORS.teal, COLORS.tealDark], [COLORS.rose, COLORS.roseDark], ['#b49a5c', '#766441'], ['#8899b0', '#526680']];
    for (const item of items) {
      let root: TransformNode;
      if (item.kind === 'counter') {
        if (!item.counterId) continue;
        let station = this.stations.get(item.counterId);
        if (!station) {
          const index = counterOrdinal(item.counterId)-1;
          const [accent, deep] = palette[index % palette.length];
          station = this.makeStation(item.counterId, item.x, accent, deep, String(counterOrdinal(item.counterId)));
          this.stations.set(item.counterId, station);
        }
        this.positionCounterControls(station, item.rotation);
        root = station.root;
      } else {
        let table = this.tables.get(item.id);
        if (!table) { table = this.makeTable(item.id); this.tables.set(item.id, table); }
        root = table;const label=this.tableLabels.get(item.id);if(label){label.mesh.metadata={...label.mesh.metadata,coffeeSeatLevel:seatLevel(item)};this.paintLabel(label,`seat-${seatLevel(item)}`,(ctx,w,h)=>{this.roundRect(ctx,0,0,w,h,12,'#25534b');this.text(ctx,`Lv.${seatLevel(item)}`,w/2,h/2,66,'#fff6df');});}
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
    this.reconcileRoom(layout);
    const steps = expansionSteps(layout), canExpand = steps.width < MAX_EXPANSION_STEPS || steps.depth < MAX_EXPANSION_STEPS;
    for (const name of ['expansion-marker', 'expansion-marker-post', 'expansion-plus-horizontal', 'expansion-plus-vertical']) this.scene.getMeshByName(name)?.setEnabled(canExpand);
    if (!canExpand && this.focused === 'expansion') this.focused = null;
    this.expansionGate.setEnabled(!layout.expanded);
    this.expandedRear.setEnabled(layout.expanded);
    for (const mesh of this.exitRoot.getChildMeshes()) mesh.unfreezeWorldMatrix();
    this.exitRoot.position.x = layoutExitAnchor(layout).x + .5;
    this.exitRoot.computeWorldMatrix(true);
    this.expansionFloor.material = layout.expanded ? this.expansionTiles : this.material('#ccd0ac');
    this.expansionFloor.metadata = { coffeeExpansion: layout.expanded ? 'open' : 'locked', coffeeAction: { type: 'renovate' } };
    this.prepareStaticGeometry();
    this.shadowGenerator?.getShadowMap()?.resetRefreshCounter();
    this.updateRenovationGrid();
    this.refreshPanBounds();
  }

  private reconcileRoom(layout:ShopLayout):void{
    const bounds=layoutBounds(layout),addX=bounds.width-18,addZ=bounds.depth-13,wing=addX||6,cx=10.5+wing/2,cz=3+addZ/2;
    const size=(name:string,values:{x?:number;z?:number;w?:number;d?:number})=>{const m=this.scene.getMeshByName(name);if(!m)return;m.unfreezeWorldMatrix();if(values.x!==undefined)m.position.x=values.x;if(values.z!==undefined)m.position.z=values.z;if(values.w!==undefined)m.scaling.x=values.w;if(values.d!==undefined)m.scaling.z=values.d;m.computeWorldMatrix(true);};
    const exterior=exteriorBounds(layout);
    size('exterior-lawn',{x:exterior.centerX,z:exterior.centerZ,w:exterior.width,d:exterior.depth});
    size('neighborhood-road',{x:exterior.centerX,w:exterior.width-.8});
    size('rear-pavement',{x:ROOM.centerX+addX/2,w:bounds.width+13});
    for(let i=-3;i<=4;i++)size(`street-mark-${i}`,{x:exterior.centerX+(i-.5)*(exterior.width-4)/8});
    size('continuous-shop-floor',{z:cz,d:bounds.depth});size('front-floor-trim',{z:bounds.maxZ+.5});
    for(const suffix of ['wall','wall-cap','wainscot','chair-rail','baseboard'])size(`right-front-${suffix}`,{z:8.175+addZ/2,d:2.65+addZ+(suffix==='wall-cap'?.04:0)});
    size('expansion-floor',{x:cx,z:cz,w:wing,d:bounds.depth});for(const suffix of ['wall','wall-cap','wainscot','chair-rail','baseboard'])size(`expansion-rear-${suffix}`,{x:cx,w:wing+(suffix==='wall-cap'?.04:0)});
    size('expansion-edge--3.42',{x:cx,w:wing});size('expansion-edge-9.42',{x:cx,z:bounds.maxZ+.42,w:wing});size('expansion-far-edge',{x:10.5+wing-.05,z:cz,d:bounds.depth});
    for(const name of ['expansion-marker','expansion-marker-post','expansion-plus-horizontal','expansion-plus-vertical'])size(name,{x:bounds.maxX+3.5});
    size('front-garden-walk',{x:3+addX/2,z:bounds.maxZ+1.3,w:31+addX});
    const plant=this.scene.getTransformNodeByName('garden-plant-front');if(plant){for(const m of plant.getChildMeshes())m.unfreezeWorldMatrix();plant.position.z=bounds.maxZ+2.8;plant.computeWorldMatrix(true);}
    size('garden-shrub-1',{x:18.6+addX});size('garden-shrub-2',{x:17.8+addX,z:11.8+addZ});size('garden-shrub-3',{z:14+addZ});
    this.backdropEnvironment.resize(layout);
    const pattern=(name:string,u:number,v:number)=>{const mat=this.scene.getMeshByName(name)?.material as StandardMaterial|null;if(!mat?.metadata?.coffeePattern)return;mat.metadata.coffeePattern.repeatU=u;mat.metadata.coffeePattern.repeatV=v;const texture=mat.diffuseTexture as Texture|null;if(texture){texture.uScale=u;texture.vScale=v;}};
    pattern('continuous-shop-floor',bounds.depth/ROOM.tilePitch,18/ROOM.tilePitch);this.expansionFloor.material=this.expansionTiles;pattern('expansion-floor',bounds.depth/ROOM.tilePitch,wing/ROOM.tilePitch);
  }

  private positionCounterControls(station: Station, rotation: number): void {
    // The machine and stacked cups fill the top. On away-facing turns the same two
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
    const seat=this.box(`${id}-chair-seat`, .63, .12, .62, 0, .51, 1, COLORS.teal, root);seat.metadata={coffeeAction:{type:'seat',id}};
    const back=this.box(`${id}-chair-back`, .63, .58, .09, 0, .8, 1.31, COLORS.tealDark, root);back.metadata={coffeeAction:{type:'seat',id}};
    const label=this.makeLabel(`${id}-seat-level`,.55,.22,new Vector3(0,.87,1.37),root,{type:'seat',id},256,128,.03);this.tableLabels.set(id,label);this.registerAnchor(`seat:${id}`,label.mesh);
    for (const x of [-.24, .24]) for (const z of [.78, 1.23]) this.box(`${id}-chair-leg-${x}-${z}`, .075, .48, .075, x, .24, z, COLORS.woodDark, root);
    return root;
  }

  private makeExpansion(): void {
    this.expansionRoot = new TransformNode('adjacent-expansion', this.scene);
    this.expansionFloor = this.box('expansion-floor', 6, .12, 13, 13.5, -.06, 3, '#ccd0ac', this.expansionRoot, false);
    this.expansionTiles = this.surfacePattern('expansion-tile-ink', COLORS.tile, '#c2b49b', ROOM.depth / ROOM.tilePitch, 6 / ROOM.tilePitch, true);
    this.expansionFloor.metadata = { coffeeExpansion: 'locked', coffeeAction: { type: 'renovate' } };
    for (const z of [-3.42, 9.42]) this.box(`expansion-edge-${z}`, 6, .025, .08, 13.5, .03, z, '#a5b197', this.expansionRoot, false);
    this.box('expansion-far-edge', .08, .025, 13, 16.45, .03, 3, '#a5b197', this.expansionRoot, false);
    this.expansionGate = new TransformNode('expansion-locked-divider', this.scene);
    this.expansionGate.parent = this.expansionRoot;
    for (const z of [-2.8, .1, 3, 8.8]) {
      this.box(`expansion-post-${z}`, .14, .8, .14, 10.63, .4, z, COLORS.woodDark, this.expansionGate);
      this.cylinder(`expansion-post-cap-${z}`, .21, .075, 10.63, .84, z, COLORS.gold, this.expansionGate);
    }
    for (const z of [-1.35, 1.55]) this.box(`expansion-rope-${z}`, .055, .065, 2.8, 10.63, .66, z, '#a88c60', this.expansionGate, false);
    // A timber building marker, with an embodied plus, is also the expansion entry.
    const marker = this.box('expansion-marker', 1.15, .9, .1, 13.5, 1.48, -4.4, COLORS.tealDark, this.expansionRoot);
    marker.metadata = { coffeeAction: { type: 'renovate' }, coffeeExpansionSign: true };
    this.box('expansion-marker-post', .13, 1.2, .13, 13.5, .6, -4.46, COLORS.woodDark, this.expansionRoot);
    for (const [name, w, h] of [['horizontal', .56, .105], ['vertical', .105, .56]] as const) {
      const plus = this.box(`expansion-plus-${name}`, w, h, .025, 13.5, 1.48, -4.335, COLORS.gold, this.expansionRoot, false);
      plus.metadata = { coffeeAction: { type: 'renovate' } };
    }
    this.registerAnchor('expansion', marker);
  }

  private updateRenovationGrid(): void {
    const layout = this.previewLayout;
    const signature = layout ? JSON.stringify(expansionSteps(layout)) : '';
    if (signature !== this.gridSignature) {
      for (const mesh of this.gridCells.values()) mesh.dispose(false, false);
      this.gridCells.clear();
      this.gridSignature = signature;
      if (layout) {
        for (let x = GRID.minX; x <= layoutBounds(layout).maxX; x++) for (let z = GRID.minZ; z <= layoutBounds(layout).maxZ; z++) {
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
      for(const mesh of this.groupGhosts.values())mesh.dispose(false,false);this.groupGhosts.clear();
      this.renovationGhost?.dispose(false, false);
      this.renovationGhost = null;
      return;
    }
    const members=this.renovationSelection.length>1?layout.furniture.filter(item=>this.renovationSelection.includes(item.id)&&!item.stored):[];
    const ids=new Set(members.map(item=>item.id));for(const [id,mesh]of this.groupGhosts)if(!ids.has(id)){mesh.dispose(false,false);this.groupGhosts.delete(id);}
    for(const item of members){let ghost=this.groupGhosts.get(item.id);if(!ghost){ghost=this.box(`renovation-group-${item.id}`,1,.055,1,0,.115,0,'#71b684',undefined,false);ghost.isPickable=false;ghost.receiveShadows=false;this.groupGhosts.set(item.id,ghost);}const cells=furnitureCells(item),minX=Math.min(...cells.map(c=>c.x)),maxX=Math.max(...cells.map(c=>c.x)),minZ=Math.min(...cells.map(c=>c.z)),maxZ=Math.max(...cells.map(c=>c.z));ghost.unfreezeWorldMatrix();ghost.scaling.set(maxX-minX+.98,.055,maxZ-minZ+.98);ghost.position.set((minX+maxX)/2,.115,(minZ+maxZ)/2);ghost.material=this.material(this.renovationValid?'#71b684':'#d76262',true,.55);ghost.metadata={coffeeFootprint:item.id,coffeeGroupSelection:true,coffeePlacementValid:this.renovationValid};}
    const selected = members.length?undefined:layout.furniture.find(item => item.id === this.renovationSelected && !item.stored);
    if (!selected) { this.renovationGhost?.setEnabled(false); return; }
    if (!this.renovationGhost) {
      this.renovationGhost = this.box('renovation-footprint-ghost', 1, .055, 1, 0, .115, 0, '#71b684', undefined, false);
      this.renovationGhost.isPickable = false;
      this.renovationGhost.receiveShadows = false;
    }
    this.renovationGhost.unfreezeWorldMatrix();
    this.renovationGhost.setEnabled(true);
    const cells = furnitureCells(selected);
    const minX = Math.min(...cells.map(cell => cell.x)), maxX = Math.max(...cells.map(cell => cell.x));
    const minZ = Math.min(...cells.map(cell => cell.z)), maxZ = Math.max(...cells.map(cell => cell.z));
    this.renovationGhost.scaling.set(maxX - minX + .98, .055, maxZ - minZ + .98);
    this.renovationGhost.position.set((minX + maxX) / 2, .115, (minZ + maxZ) / 2);
    this.renovationGhost.material = this.material(this.renovationValid ? '#71b684' : '#d76262', true, .55);
    this.renovationGhost.metadata = { coffeeFootprint: selected.id, coffeePlacementValid: this.renovationValid, coffeePlacementSurface: 'floor' };
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
    if (!enabled) { this.clearTouchGesture(); this.releasePointer(); }
  }

  getFocus(): CoffeeSceneAnchor | null { return this.disposed ? null : this.focused; }

  /** Keyboard focus recolors a real mounting rim and centers that object at useful scale. */
  focusAnchor(key: CoffeeSceneAnchor): void {
    if (this.disposed || !this.interactionEnabled) return;
    const mesh = this.anchors.get(key);
    if (!mesh || !mesh.isEnabled()) return;
    for (const [mount, material] of this.focusMaterials) mount.material = material;
    this.focusMaterials.clear();
    const mount = this.scene.getMeshByName(mesh.metadata?.coffeeMount ?? '');
    if (mount instanceof Mesh && mount.material instanceof StandardMaterial) {
      this.focusMaterials.set(mount, mount.material);
      mount.material = this.material('#e1bb69');
    }
    this.focused = key;
    this.refreshPanBounds();
    const target:Bounds2={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
    mesh.computeWorldMatrix(true);
    for(const world of mesh.getBoundingInfo().boundingBox.vectorsWorld){const relative=world.subtract(this.baseTarget),x=Vector3.Dot(relative,this.screenRight),y=Vector3.Dot(relative,this.screenUp);target.left=Math.min(target.left,x);target.right=Math.max(target.right,x);target.bottom=Math.min(target.bottom,y);target.top=Math.max(target.top,y);}
    // At the furthest overview, finite-land containment can leave a corner control
    // partly outside the frame. Focus may zoom in just enough to reveal its polygon.
    for(let attempt=0;attempt<25;attempt++){
      const rect=this.canvas.getBoundingClientRect(),halfWidth=this.camera.orthoRight!,halfHeight=this.camera.orthoTop!;
      const center=panForTarget(this.panRegion,target,halfWidth,halfHeight,30*halfWidth/rect.width,30*halfHeight/rect.height);
      if(center){this.setPan(center.x,center.y);return;}
      if(this.zoom>=2.25)return;
      this.zoomBy(1.08);
      if(this.disposed||!this.interactionEnabled||mesh.isDisposed()||!mesh.isEnabled())return;
    }
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

  /** Device-local orthographic camera zoom; never touches the game snapshot. */
  getZoom(): number { return this.zoom; }
  getZoomLimits(): { min: number; max: number } { return { min: this.minimumZoom, max: 2.25 }; }
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    if (this.disposed || !this.interactionEnabled || !Number.isFinite(factor) || factor <= 0) return;
    if (clientX !== undefined && !Number.isFinite(clientX) || clientY !== undefined && !Number.isFinite(clientY)) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (this.down) this.releasePointer();
    if (this.disposed || !this.interactionEnabled) return;
    const next = clamp(this.zoom * factor, this.minimumZoom, 2.25);
    if (Math.abs(next - this.zoom) < 1e-8) return;
    const x = clientX === undefined ? 0 : clamp((clientX - rect.left) / rect.width, 0, 1) - .5;
    const y = clientY === undefined ? 0 : .5 - clamp((clientY - rect.top) / rect.height, 0, 1);
    const beforeWidth = this.camera.orthoRight! - this.camera.orthoLeft!;
    const beforeHeight = this.camera.orthoTop! - this.camera.orthoBottom!;
    const beforeX = this.panX, beforeY = this.panY;
    this.zoom = next; this.resize();
    this.setPan(beforeX + x * (beforeWidth - (this.camera.orthoRight! - this.camera.orthoLeft!)), beforeY + y * (beforeHeight - (this.camera.orthoTop! - this.camera.orthoBottom!)));
    if (this.down) this.down.invalidated = true;
  }
  resetZoom(): void {
    if(this.disposed||!this.interactionEnabled)return;
    this.clearTouchGesture();this.releasePointer();
    if(this.disposed||!this.interactionEnabled)return;
    this.zoom=1;this.resize();this.setPan(this.homePan.x,this.homePan.y);
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.disposed || !this.interactionEnabled || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault?.();
    this.clearTouchGesture(); this.releasePointer();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.getBoundingClientRect().height : 1;
    this.zoomBy(Math.exp(-clamp(event.deltaY * unit, -600, 600) * .0015), event.clientX, event.clientY);
  };

  setRenderMode(mode: RenderMode): void {
    if (this.disposed || this.renderMode === mode) return;
    this.renderMode = mode;
    this.resize();
  }

  resize(): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const viewportSize=`${rect.width}:${rect.height}`,changed=!!this.viewportSize&&viewportSize!==this.viewportSize;
    this.viewportSize=viewportSize;
    if(changed){this.clearTouchGesture();this.releasePointer();if(this.disposed)return;}
    if (this.ownsEngine && typeof window !== 'undefined') {
      const scale = 1 / renderPixelRatio(rect.width, rect.height, window.devicePixelRatio || 1, this.renderMode);
      if (Math.abs(this.engine.getHardwareScalingLevel() - scale) > .001) this.engine.setHardwareScalingLevel(scale);
    }
    this.engine.resize();
    this.refreshPanBounds();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTouchGesture(); this.releasePointer();
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    this.canvas.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointercancel', this.handleCancel);
    this.canvas.removeEventListener('lostpointercapture', this.handleCancel);
    this.canvas.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.handleBlur);
    this.shadowGenerator?.dispose();
    // Shared materials and geometries are disposed once with the scene, not per character.
    this.scene.dispose();
    this.backdropEnvironment.release();
    this.exteriorPaving.length = 0;
    if (this.ownsEngine) this.engine.dispose();
    this.customers.clear();
    this.stations.clear();
    this.tables.clear();
    this.chairPoses.clear();
    this.counterServicePoses.clear();
    this.gridCells.clear();this.groupGhosts.clear();this.renovationSelection=[];
    this.previewLayout = this.liveLayout = this.displayedLayout = null;
    for (const image of this.recipeImages.values()) { image.onload = null; image.onerror = null; }
    this.recipeImages.clear();
    this.materials.clear();
    this.shapes.clear();
    this.labels.length = 0;
    this.anchors.clear();
    this.focusMaterials.clear();
    this.staticCasters.clear();
    this.focused = null;
  }

  private readonly handleDown = (event: PointerEvent): PointerGesture | null => {
    if (this.disposed || !this.interactionEnabled) return null;
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2) {
        event.preventDefault?.();
        const down = this.down; this.down = null;
        if (down && !this.touches.has(down.id) && this.canvas.hasPointerCapture(down.id)) this.canvas.releasePointerCapture(down.id);
        if (down?.dragged && down.action?.type === 'layout-select') this.onAction({ type: 'layout-drag', phase: 'cancel', id: down.action.id, clientX: down.lastX, clientY: down.lastY });
        if (this.disposed || !this.interactionEnabled || this.touches.size < 2) return null;
        const [a, b] = [...this.touches.values()];
        this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.canvas.setPointerCapture(event.pointerId);
        return null;
      }
    }
    if (this.disposed || !this.interactionEnabled || this.down || !event.isPrimary || event.button !== 0) return null;
    const target = this.pickAt(event.clientX, event.clientY);
    const action = this.actionForMesh(target);
    const targetPoint = target ? this.projectWorld(this.anchorWorld(target)) : null;
    this.down = { target, targetPoint, invalidated: false, action, id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, dragged: false };
    this.canvas.setPointerCapture(event.pointerId);
    return this.down;
  };
  private readonly handleMove = (event: PointerEvent): void => {
    if(this.down||this.pinch){
      const rect=this.canvas.getBoundingClientRect();
      if(`${rect.width}:${rect.height}`!==this.viewportSize){this.resize();return;}
    }
    if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.interactionEnabled && this.touches.size >= 2) {
      event.preventDefault?.();
      const pinch=this.pinch;
      const [a, b] = [...this.touches.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      this.panBy(this.pinch.x - x, this.pinch.y - y);
      this.zoomBy(distance / this.pinch.distance, x, y);
      if(this.pinch!==pinch||!this.interactionEnabled||this.touches.size<2)return;
      this.pinch = { distance, x, y }; return;
    }
    const down = this.down;
    if (!this.interactionEnabled || !down || event.pointerId !== down.id) return;
    const startsDrag = !down.dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9;
    if (startsDrag) down.dragged = true;
    if (down.dragged) {
      if (down.action?.type === 'layout-select') {
        event.preventDefault?.();
        if (startsDrag) this.onAction({ type: 'layout-drag', phase: 'start', id: down.action.id, clientX: down.x, clientY: down.y });
        // Host callbacks can synchronously cancel editing or disable interaction.
        if (this.down !== down || !this.interactionEnabled) return;
        this.onAction({ type: 'layout-drag', phase: 'move', id: down.action.id, clientX: event.clientX, clientY: event.clientY });
      } else this.panBy(down.lastX - event.clientX, down.lastY - event.clientY);
    }
    down.lastX = event.clientX; down.lastY = event.clientY;
  };
  private readonly handleBlur = (): void => { this.clearTouchGesture(); this.releasePointer(); };
  private readonly handleCancel = (event: PointerEvent): void => {
    if (this.pinch && this.touches.has(event.pointerId)) { this.clearTouchGesture(); return; }
    this.touches.delete(event.pointerId);
    if (this.down && event.pointerId === this.down.id) this.releasePointer();
  };
  private readonly handleUp = (event: PointerEvent): void => {
    if (this.pinch && this.touches.has(event.pointerId)) { this.clearTouchGesture(); return; }
    this.touches.delete(event.pointerId);
    const down = this.down;
    if (!this.interactionEnabled || !down || event.pointerId !== down.id) return;
    this.releasePointer(false);
    if (this.disposed || !this.interactionEnabled) return;
    if (down.dragged) {
      if (down.action?.type === 'layout-select') this.onAction({ type: 'layout-drag', phase: 'end', id: down.action.id, clientX: event.clientX, clientY: event.clientY });
      return;
    }
    if (down.invalidated || event.timeStamp - down.time > 800) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 9) return;
    const target = this.pickAt(event.clientX, event.clientY);
    const action = this.actionForMesh(target);
    if (target && down.targetPoint) {
      const point = this.projectWorld(this.anchorWorld(target));
      if (Math.hypot(point.x - down.targetPoint.x, point.y - down.targetPoint.y) > 9) return;
    }
    // Both ends must hit the same actual mesh. A moved furnishing, foreground customer,
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
    const coordinates = this.pickCoordinates(clientX, clientY);
    if (!coordinates) return null;
    this.scene.updateTransformMatrix(true);
    // Pick the front visible solid, including people, furniture and all control mounts.
    // Restricting the predicate to actions would incorrectly click through occluding objects.
    const pick = this.scene.pick(coordinates.x, coordinates.y, undefined, false, this.camera);
    return pick?.hit && pick.pickedMesh instanceof Mesh ? pick.pickedMesh : null;
  }

  private pickCoordinates(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (this.disposed || !Number.isFinite(clientX) || !Number.isFinite(clientY) || !rect.width || !rect.height) return null;
    const cssX = clientX - rect.left, cssY = clientY - rect.top;
    if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return null;
    // Babylon applies hardware scaling in its ray helper; convert to logical coordinates once.
    const scale = this.engine.getHardwareScalingLevel();
    return { x: cssX * this.engine.getRenderWidth() * scale / rect.width, y: cssY * this.engine.getRenderHeight() * scale / rect.height };
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

  private clearTouchGesture(): void {
    const ids = [...this.touches.keys()];
    this.pinch = null; this.touches.clear();
    for (const id of ids) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  private releasePointer(cancel = true): void {
    const down = this.down;
    const id = down?.id;
    this.down = null;
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    if (cancel && down?.dragged && down.action?.type === 'layout-select') this.onAction({ type: 'layout-drag', phase: 'cancel', id: down.action.id, clientX: down.lastX, clientY: down.lastY });
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
    const layout=this.previewLayout??this.displayedLayout??{expanded:false},bounds=layoutBounds(layout),footprint=`${bounds.width}:${bounds.depth}`;
    const changed=footprint!==this.frameFootprint;
    if(changed||!this.frameContent){
      const content:Bounds2={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
      const include=(world:Vector3)=>{const p=world.subtract(this.baseTarget),x=Vector3.Dot(p,this.screenRight),y=Vector3.Dot(p,this.screenUp);content.left=Math.min(content.left,x);content.right=Math.max(content.right,x);content.bottom=Math.min(content.bottom,y);content.top=Math.max(content.top,y);};
      for(const x of [bounds.minX-.5,bounds.maxX+.5])for(const z of [bounds.minZ-.5,bounds.maxZ+.5])include(new Vector3(x,.06,z));
      // The actual cutaway walls and door approach paths form a stable useful envelope.
      // Furniture drags must not change the camera while their previews move.
      for(const x of [bounds.minX-.5,bounds.maxX+.5])include(new Vector3(x,ROOM.height+.1,bounds.minZ-.5));
      include(new Vector3(bounds.minX-.5,ROOM.height+.1,bounds.maxZ+.5));
      include(new Vector3(-9,.06,5));include(new Vector3(bounds.maxX+3,.06,6));
      for(const [key,mesh]of this.anchors){if(!mesh.isEnabled()||key!=='invite'&&key!=='expansion')continue;mesh.computeWorldMatrix(true);for(const point of mesh.getBoundingInfo().boundingBox.vectorsWorld)include(point);}
      this.frameContent=content;this.frameFootprint=footprint;
    }
    const rect=this.canvas.getBoundingClientRect(),aspect=Math.max(.1,rect.width/Math.max(1,rect.height)),land=exteriorBounds(layout);
    const shopCenter=new Vector3((bounds.minX+bounds.maxX)/2,.8,(bounds.minZ+bounds.maxZ)/2).subtract(this.baseTarget);
    const frame=cameraFrame({land:{...land,y:this.exteriorLawn.position.y+this.exteriorLawn.scaling.y/2},content:this.frameContent,home:{x:Vector3.Dot(shopCenter,this.screenRight),y:Vector3.Dot(shopCenter,this.screenUp)},base:this.baseTarget,right:this.screenRight,up:this.screenUp,width:rect.width,height:rect.height,nominalHalfHeight:rect.width>=1000?10.4:aspect>1.8?5:6.15,zoom:this.zoom});
    this.zoom=frame.zoom;this.minimumZoom=frame.minimumZoom;this.homePan=frame.home;this.panRegion=frame.polygon;this.panBounds=frame.bounds;
    this.camera.orthoLeft=-frame.halfWidth;this.camera.orthoRight=frame.halfWidth;this.camera.orthoTop=frame.halfHeight;this.camera.orthoBottom=-frame.halfHeight;
    this.setPan(changed?frame.home.x:this.panX,changed?frame.home.y:this.panY);
  }

  private setPan(x: number, y: number): void {
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const point=constrainPan({x,y},this.panRegion);
    this.panX=point.x;this.panY=point.y;
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
    // Finite floor and two trimmed walls expose the surrounding garden. These visual
    // solids never participate in grid navigation; every decorative prop sits outside it.
    const exterior = exteriorBounds({expanded:false});
    this.exteriorLawn = this.box('exterior-lawn', exterior.width, .14, exterior.depth, exterior.centerX, -.28, exterior.centerZ, '#a8ba83', undefined, false);
    this.exteriorLawn.metadata = { coffeeExterior: 'lawn' };
    const paving = (name: string, w: number, d: number, x: number, z: number) => {
      const mesh = this.box(name, w, .1, d, x, -.05, z, '#d7c9ae', undefined, false);
      mesh.metadata = { coffeeExterior: 'paving' }; this.exteriorPaving.push(mesh); return mesh;
    };
    paving('rear-pavement', 31, 2.2, 1.5, -4.75);
    paving('entrance-outside-walk', 2.8, 14.2, -9, 2.85);
    paving('front-garden-walk', 31, 1.45, 3, 10.3);
    const road = this.box('neighborhood-road', exterior.width-.8, .08, 4.6, exterior.centerX, -.19, -8.15, '#8b8980', undefined, false);
    road.metadata = { coffeeExterior: 'road' };
    for (let i = -3; i <= 4; i++) {
      const mark=this.box(`street-mark-${i}`, 2.3, .012, .11, exterior.centerX+(i-.5)*(exterior.width-4)/8, -.14, -8.15, '#e6dbc1', undefined, false);
      mark.isPickable=false;mark.metadata={coffeeExterior:'road-mark'};
    }

    const floor = this.box('continuous-shop-floor', ROOM.width, .12, ROOM.depth,
      ROOM.centerX, ROOM.floorY - .06, ROOM.centerZ, COLORS.tile, undefined, false);
    floor.material = this.surfacePattern('floor-tile-ink', COLORS.tile, '#c2b49b', ROOM.depth / ROOM.tilePitch, ROOM.width / ROOM.tilePitch, true);
    floor.metadata = { coffeeEnvironment: true, coffeeSurface: 'floor', coffeePattern: { axes: 'xz', pitch: ROOM.tilePitch, originX: ROOM.sideX, originZ: ROOM.rearZ } };
    this.box('front-floor-trim', ROOM.width, .16, .1, ROOM.centerX, -.035, 9.5, '#c2af8b', undefined, false);
    this.makeWall('rear', ROOM.width + .22, ROOM.height, .22, ROOM.centerX, ROOM.rearZ - .11);
    // A real opening covers the entry and the one-time old-route exit lane at z=6.
    this.makeWall('right-rear', .22, ROOM.height, 7.05, ROOM.sideX - .11, .025);
    this.makeWall('right-front', .22, ROOM.height, 2.65, ROOM.sideX - .11, 8.175);
    this.expandedRear = new TransformNode('expanded-rear-wall', this.scene);
    this.makeWall('expansion-rear', 6, ROOM.height, .22, 13.5, ROOM.rearZ - .11, this.expandedRear);
    this.expandedRear.setEnabled(false);
    const brand = this.makeLabel('brand-sign', 3.7, .66, new Vector3(1.2, 2.6, -3.34));
    this.paintLabel(brand, 'brand', (ctx, w, h) => {
      this.roundRect(ctx, 8, 8, w - 16, h - 16, 20, '#315d54');
      this.text(ctx, 'MELLOW BEAN', w / 2, h / 2 + 2, 64, '#fff5df');
    });
    this.makePlant('garden-plant-entry', -10.4, 2.6, .9);
    this.makePlant('garden-plant-front', -6.1, 11.8, .7);
    this.makePlant('garden-plant-rear', 9.7, -4.65, .82);
    // Every shrub is outside the owned grid, including the expanded shop footprint.
    for (const [i, x, z] of [[0, -12, -1], [1, 18.6, 1], [2, 17.8, 11.8], [3, -3, 14]] as const) {
      const shrub = this.shape('sphere', `garden-shrub-${i}`, new Vector3(1.5, .85, 1.3), new Vector3(x, .25, z), '#83a078', undefined, false);
      shrub.metadata = { coffeeExterior: 'decoration' };
    }
    this.backdropEnvironment = new BackdropEnvironment(this.scene);
    this.setBackdrop('garden');
  }

  private makeWall(name: string, width: number, height: number, depth: number, x: number, z: number, parent?: TransformNode): void {
    const wall = this.box(`${name}-wall`, width, height, depth, x, height / 2, z, COLORS.cream, parent, false);
    wall.metadata = { coffeeEnvironment: true, coffeeSurface: 'cutaway-wall' };
    this.box(`${name}-wall-cap`, width + .04, .12, depth + .04, x, height + .02, z, '#f7f0df', parent, false);
    const side = width < depth;
    const panel = this.box(`${name}-wainscot`, side ? .08 : width, .83, side ? depth : .08,
      x + (side ? .15 : 0), .42, z + (side ? 0 : .15), COLORS.tealDark, parent, false);
    panel.metadata = { coffeeSurface: 'wall-panels' };
    this.box(`${name}-chair-rail`, side ? .12 : width, .1, side ? depth : .12,
      x + (side ? .16 : 0), .89, z + (side ? 0 : .16), COLORS.woodLight, parent, false);
    this.box(`${name}-baseboard`, side ? .1 : width, .09, side ? depth : .1,
      x + (side ? .16 : 0), .045, z + (side ? 0 : .16), COLORS.woodDark, parent, false);
  }

  /** Device-only appearance setting; no simulation data or indoor material is changed. */
  setBackdrop(theme: CoffeeBackdrop): void {
    if (this.disposed || !this.exteriorLawn || !Object.hasOwn(BACKDROPS, theme)) return;
    const colors = BACKDROPS[theme];
    this.exteriorLawn.material = this.material(colors.lawn);
    for (const mesh of this.exteriorPaving) mesh.material = this.material(colors.paving);
    this.scene.clearColor = Color4.FromHexString(colors.sky);
    this.backdropEnvironment.setTheme(theme);
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
    // The meter is a physical inset on the espresso machine front, not a floating bar.
    const progressRoot = CreateBox(`${id}-progress`, { width: .98, height: .13, depth: .018 }, this.scene);
    progressRoot.parent = machine;
    progressRoot.position.set(-.05, .36, .191);
    progressRoot.material = this.material('#faf5e5');
    progressRoot.receiveShadows = true;
    const progressFill = this.box(`${id}-progress-fill`, 1, .072, .018, -.45, 0, .018, accent, progressRoot, false);
    progressRoot.metadata = { coffeeDisplay: 'brew-progress' };
    progressRoot.setEnabled(false);
    const station: Station = { root, barista, progressRoot, progressFill, plaque, selector, machineExtras: extras, readyCup, selection, level: -1, recipe: '' };
    // Build the initial labels even before the first simulation frame arrives.
    this.updateStation(station, { id, x, level: 1, recipe: letter === 'A' ? 'espresso' : 'latte', pendingCash: 0, brewed: 0, brew: null }, false);
    return station;
  }

  private loadRecipeIcons(): void {
    if (typeof Image === 'undefined') return;
    for (const recipe of ['espresso', 'latte']) {
      const image = new Image(); this.recipeImages.set(recipe, image);
      image.onload = () => { if (this.disposed) return; for (const station of this.stations.values()) if (station.recipe === recipe) { station.selector.key = ''; this.paintRecipeIcon(station.selector, recipe); } };
      image.src = `./assets/catalog-${recipe}.svg`;
    }
  }

  private paintRecipeIcon(label: Label, recipe: string): void {
    const image = this.recipeImages.get(recipe), ready = !!image?.complete && image.naturalWidth > 0;
    label.mesh.metadata = { ...label.mesh.metadata, coffeeRecipeIcon: recipe, coffeeRecipeAsset: `./assets/catalog-${recipe}.svg`, coffeeAccessibleName: recipe === 'espresso' ? '浓缩咖啡，点击选择配方' : '拿铁，点击选择配方' };
    this.paintLabel(label, `${recipe}:icon:${ready ? 'loaded' : 'pending'}`, (ctx, w, h) => {
      this.roundRect(ctx, 3, 3, w - 6, h - 6, 22, '#f5efda');
      if (ready) { const scale = Math.min(w * .9 / image!.naturalWidth, h * .9 / image!.naturalHeight); const width = image!.naturalWidth * scale, height = image!.naturalHeight * scale; ctx.drawImage(image!, (w - width) / 2, (h - height) / 2, width, height); }
    });
  }

  private updateStation(station: Station, counter: Counter, paused: boolean): void {
    if (station.level !== counter.level) {
      this.paintLabel(station.plaque, `level-${counter.level}`, (ctx, w, h) => {
        this.roundRect(ctx, 8, 8, w - 16, h - 16, 24, '#f5d98b');
        this.text(ctx, `Lv. ${counter.level}`, w / 2, h / 2 + 1, 112, '#5a492b');
      });
      station.machineExtras[0].setEnabled(counter.level >= 2);
      station.machineExtras[1].setEnabled(counter.level >= 6);
      station.level = counter.level;
      this.shadowGenerator?.getShadowMap()?.resetRefreshCounter();
    }
    if (station.recipe !== counter.recipe) {
      this.paintRecipeIcon(station.selector, counter.recipe);
      station.recipe = counter.recipe;
    }
    const brew = counter.brew;
    const brewing = !!brew && brew.elapsed < brew.duration;
    const progress = brew ? clamp(brew.elapsed / Math.max(0.001, brew.duration)) : 0;
    station.progressRoot.setEnabled(brewing);
    station.progressFill.scaling.x = Math.max(0.015, progress * .90);
    station.progressFill.position.x = -.45 + station.progressFill.scaling.x / 2;
    station.readyCup.setEnabled(Boolean(brew) && progress > 0.32 && progress < 1);
    if (brew) station.readyCup.scaling.setAll(brew.recipe === 'espresso' ? 0.82 : 1);
    if (!brewing) {
      station.barista.rightArm.rotation.x = -.12;
      station.barista.leftArm.rotation.x = -.12;
      station.barista.root.position.y = 0;
    } else if (!paused) {
      const pulse = Math.sin(this.animationTime * 5.2);
      station.barista.rightArm.rotation.x = -0.78 + pulse * 0.2;
      station.barista.leftArm.rotation.x = -0.4 - pulse * 0.15;
      station.barista.root.position.y = Math.max(0, pulse) * 0.019;
    }
    station.barista.root.computeWorldMatrix(true);
    const baristaPosition = station.barista.root.getAbsolutePosition();
    station.barista.shadow.position.set(baristaPosition.x, CONTACT_SHADOW_Y, baristaPosition.z);
    station.barista.shadow.setEnabled(station.root.isEnabled());
    station.selection.setEnabled(this.selected === counter.id);
  }

  private makePerson(name: string, skinIndex: number, shirt: string, guest: boolean): Person {
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
      this.box(`${name}-${side}-trouser`, 0.21, 0.49, 0.24, 0, -0.245, 0, '#485451', leg);
      this.box(`${name}-${side}-shoe`, 0.24, 0.14, 0.37, 0, -0.58, 0.063, guest ? '#f4eddd' : '#51483d', leg);
    }
    if (guest && skinIndex % 3 === 0) {
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

  private initialCustomerYaw(customer: Customer): number {
    // The face is local +Z. A first-frame guest has no observed displacement;
    // use its next nonzero path segment instead of the old fixed -Z pose.
    const target = customer.nav?.find(point => Number.isFinite(point.x) && Number.isFinite(point.z) && Math.hypot(point.x - customer.x, point.z - customer.z) > .003);
    if (target) return Math.atan2(target.x - customer.x, target.z - customer.z);
    // Route reservation may not yet have granted nav to the outside guest.
    // Its mandatory first ingress segment still points through this doorway.
    if (customer.phase === 'entering' && customer.x < GRID.entry.x - .003 && Math.abs(customer.z - GRID.entry.z) < .003)
      return Math.atan2(GRID.entry.x - customer.x, GRID.entry.z - customer.z);
    return Math.PI;
  }

  private updateCustomer(person: Person, customer: Customer, dt: number): void {
    const dx = customer.x - person.previousX;
    const dz = customer.z - person.previousZ;
    const distance = Math.hypot(dx, dz);
    // Completing dining clears seatId before an exit route is necessarily free.
    // Physical chair occupancy also reconstructs that waiting pose after reload.
    const chair = customer.phase === 'dining' || customer.phase === 'leaving'
      ? this.chairPoses.get(`${Math.round(customer.x)},${Math.round(customer.z)}`) : undefined;
    const seated = chair && (customer.phase === 'leaving' || customer.seatId === chair.tableId) &&
      Math.abs(customer.x - chair.x) < 1e-8 && Math.abs(customer.z - chair.z) < 1e-8 ? chair : undefined;
    // Paid guests can wait here for a seat/exit route after the service phase.
    // Physical occupancy restores their inward heading after loading too.
    const service = this.counterServicePoses.get(customer.counterId);
    // A routed paid guest may cross this tile later on the way out. Only an
    // unrouted paid guest is still waiting here; granted routes move immediately.
    const waitingAtCounter = customer.phase !== 'leaving' && customer.phase !== 'seeking-seat' || !customer.nav?.length;
    const atService = !seated && waitingAtCounter && service && Math.abs(customer.x - service.x) < 1e-8 && Math.abs(customer.z - service.z) < 1e-8;
    // Phases describe intent. A reserved/blocked route can remain 'entering'
    // for seconds without any movement, so only actual displacement drives gait.
    const walking = !seated && !atService && dt > 0 && distance / dt > .025;
    // The app supplies adjacent-step interpolated coordinates. A second lag filter
    // would reintroduce speed pulses and make the pose depend on display refresh.
    person.root.position.x = customer.x;
    person.root.position.z = customer.z;
    if (atService) person.root.rotation.y = service.yaw;
    else if (Math.hypot(dx, dz) > 0.003 && walking) {
      const target = Math.atan2(dx, dz);
      const current = person.root.rotation.y;
      const delta = ((target - current + Math.PI * 3) % TAU) - Math.PI;
      person.root.rotation.y += delta * (1 - Math.exp(-dt * 14));
    }
    const gait = walking ? Math.sin(this.animationTime * 9 + customer.id * 0.91) * 0.33 : 0;
    if (dt > 0) {
      person.leftLeg.rotation.x = gait;
      person.rightLeg.rotation.x = -gait;
      person.leftArm.rotation.x = -gait * 0.7;
      person.rightArm.rotation.x = customer.hasCup || customer.phase === 'receiving' ? -0.95 : gait * 0.7;
      person.root.position.y = walking ? Math.abs(gait) * 0.035 : Math.sin(this.animationTime * 2 + customer.id) * 0.008;
    }
    if (seated) {
      person.root.position.set(seated.x, -.045, seated.z);
      person.root.rotation.y = seated.yaw;
      person.leftLeg.rotation.x = -1.4; person.rightLeg.rotation.x = -1.4;
      person.leftArm.rotation.x = -.7; person.rightArm.rotation.x = -1.02;
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

  private makeCup(name: string, sleeve: string, parent?: TransformNode): TransformNode {
    const root = new TransformNode(name, this.scene);
    if (parent) root.parent = parent;
    this.cylinder(`${name}-cup`, 0.215, 0.25, 0, 0.135, 0, '#fcf4e2', root, false);
    this.cylinder(`${name}-sleeve`, 0.223, 0.09, 0, 0.135, 0, sleeve, root, false);
    this.cylinder(`${name}-lid`, 0.245, 0.038, 0, 0.275, 0, '#fdf9ee', root, false);
    this.cylinder(`${name}-sip`, 0.06, 0.012, 0.035, 0.3, 0.035, '#63554c', root, false);
    return root;
  }

  private makeEntrance(): void {
    this.makeDoorway('entrance', ROOM.sideX, GRID.entry.z, true);
    this.exitRoot = this.makeDoorway('exit', GRID.maxX + .5, 6, false).root;
  }

  private makeDoorway(kind: 'entrance' | 'exit', x: number, z: number, invite: boolean): { root: TransformNode } {
    const root = new TransformNode(`${kind}-doorway`, this.scene);
    root.position.set(x, 0, z);
    root.metadata = { coffeeDoor: kind, coffeeOpeningWidth: 2.55, coffeeOutsideDirection: invite ? -1 : 1 };
    const threshold = this.box(`${kind}-threshold`, .52, .035, 2.6, 0, .018, 0, '#b89a68', root, false);
    threshold.metadata = { coffeeDoorThreshold: kind };
    const outside = invite ? -.08 : .08;
    for (const edge of [-1.38, 1.38]) {
      this.box(`${kind}-door-jamb-${edge}`, .22, 2.65, .18, outside, 1.325, edge, COLORS.woodDark, root);
      this.box(`${kind}-door-inlay-${edge}`, .235, 2.42, .06, outside + .015, 1.3, edge, COLORS.woodLight, root, false);
    }
    this.box(`${kind}-door-lintel`, .24, .24, 2.95, 0, 2.77, 0, COLORS.woodDark, root);
    if (!invite) {
      const path = this.box('exit-outside-walk', 2.4, .08, 3.2, 1.2, -.03, 0, '#d7c9ae', root, false);
      path.metadata = { coffeeExterior: 'paving' }; this.exteriorPaving.push(path);
    }
    return { root };
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
    // Freeze only truly immobile world geometry. People, cups, brew progress
    // and contact shadows keep their animated parent-transform semantics.
    const moving = new Set<TransformNode>();
    for (const person of this.customers.values()) { moving.add(person.root); moving.add(person.shadow); }
    if (this.renovationGhost) moving.add(this.renovationGhost);
    for (const station of this.stations.values()) {
      for (const root of [station.barista.root, station.barista.shadow, station.readyCup, station.progressFill]) moving.add(root);
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
      if (mesh.name.startsWith('shared-')) continue;
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
