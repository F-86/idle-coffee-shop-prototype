import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { layoutBounds } from '../core/layout';
import type { ShopLayout } from '../core/types';

export type CoffeeBackdrop = 'garden' | 'terrace' | 'sunset';
type Zone = 'rear' | 'left' | 'right' | 'front';
type Part = { name: string; min: number[]; max: number[] };
type Primitive = 'box' | 'sphere' | 'cylinder';
const range = (from: number, to: number, step: number): number[] => Array.from({ length: Math.max(0, Math.floor((to - from) / step) + 1) }, (_, i) => from + i * step);

/** Decorative land only. Playable grid, doors and camera limits keep their own bounds. */
export function exteriorBounds(layout: Pick<ShopLayout, 'expanded' | 'widthSteps' | 'depthSteps'>) {
  const b = layoutBounds(layout), minX = -19, maxX = b.maxX + 10, minZ = -26, maxZ = b.maxZ + 11;
  return { minX, maxX, minZ, maxZ, width: maxX-minX, depth: maxZ-minZ, centerX: (minX+maxX)/2, centerZ: (minZ+maxZ)/2 };
}

/** Four static vertex-colored batches per theme. No lights, textures or frame work. */
export class BackdropEnvironment {
  private readonly batches = new Map<CoffeeBackdrop, Map<Zone, Mesh>>();
  private readonly material: StandardMaterial;
  private readonly scene: Scene;
  private footprint = '18:13';

  constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial('backdrop-matte-vertex-colors', scene);
    this.material.diffuseColor = Color3.White();
    this.material.specularColor = Color3.Black();
    for (const theme of ['garden', 'terrace', 'sunset'] as const) this.build(theme, 18, 13);
    this.setTheme('garden');
  }

  setTheme(theme: CoffeeBackdrop): void {
    for (const [name, zones] of this.batches) for (const mesh of zones.values()) mesh.setEnabled(name === theme);
  }

  resize(layout: ShopLayout): void {
    const bounds = layoutBounds(layout);
    const footprint = `${bounds.width}:${bounds.depth}`;
    if (footprint !== this.footprint) {
      // Growth/preview changes are rare. Re-bake into the existing twelve meshes;
      // select complete clusters for this footprint instead of stretching/cropping them.
      for (const theme of ['garden', 'terrace', 'sunset'] as const) this.build(theme, bounds.width, bounds.depth);
      this.footprint = footprint;
    }
    for (const zones of this.batches.values()) for (const [zone, mesh] of zones) {
      mesh.unfreezeWorldMatrix();
      // Never scale objects when the shop grows. Only the two moving perimeter bands shift.
      mesh.position.set(zone === 'right' ? bounds.maxX - 10 : zone === 'front' ? (bounds.width - 18) / 2 : 0,
        0, zone === 'front' ? bounds.depth - 13 : 0);
      mesh.freezeWorldMatrix();
    }
  }

  /** Scene owns the shared material and the twelve geometries. */
  release(): void { this.batches.clear(); }

  private build(theme: CoffeeBackdrop, roomWidth: number, roomDepth: number): void {
    const zones = this.batches.get(theme) ?? new Map<Zone, Mesh>();
    this.batches.set(theme, zones);
    const centerX = 1.5 + (roomWidth - 18) / 2, rearWidth = roomWidth + 16, right = roomWidth - 8,
      front = roomDepth - 4, sideDepth = roomDepth + 14, sideCenter = 4 + (roomDepth - 13) / 2,
      frontWidth = roomWidth + 12;
    for (const zone of ['rear', 'left', 'right', 'front'] as const) {
      const geometry: VertexData[] = [], parts: Part[] = [];
      const shape = (name: string, kind: Primitive, x: number, y: number, z: number,
        w: number, h: number, d: number, color: string, yaw = 0) => {
        const data = kind === 'box' ? CreateBoxVertexData({ size: 1 }) : kind === 'sphere'
          ? CreateSphereVertexData({ diameter: 1, segments: 3 })
          : CreateCylinderVertexData({ diameter: 1, height: 1, tessellation: 10 });
        const normals = Array.from(data.normals!);
        data.transform(Matrix.Compose(new Vector3(w, h, d), Quaternion.RotationYawPitchRoll(yaw, 0, 0), new Vector3(x, y, z)));
        // VertexData.transform uses the position matrix for normals. Ellipsoids need
        // the inverse scale followed by rotation, otherwise flat canopies light wrongly.
        const rotation = Matrix.RotationY(yaw);
        for (let i = 0; i < normals.length; i += 3) {
          const normal = Vector3.TransformNormal(new Vector3(normals[i] / w, normals[i + 1] / h, normals[i + 2] / d), rotation).normalize();
          data.normals![i] = normal.x; data.normals![i + 1] = normal.y; data.normals![i + 2] = normal.z;
        }
        const c = Color3.FromHexString(color), count = data.positions!.length / 3;
        data.colors = Array.from({ length: count }, () => [c.r, c.g, c.b, 1]).flat();
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.positions!.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], data.positions![i]); max[axis] = Math.max(max[axis], data.positions![i]); }
        parts.push({ name, min, max }); geometry.push(data);
      };
      const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, color: string, yaw = 0) => shape(name, 'box', x, y, z, w, h, d, color, yaw);
      const ball = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, color: string) => shape(name, 'sphere', x, y, z, w, h, d, color);
      const pole = (name: string, x: number, y: number, z: number, diameter: number, h: number, color: string) => shape(name, 'cylinder', x, y, z, diameter, h, diameter, color);
      const tree = (name: string, x: number, z: number, size: number, leaf = '#6f9972') => {
        pole(`${name}-trunk`, x, size * .45, z, .28, size * .9, '#957558');
        ball(`${name}-crown`, x, size * .92, z, size * .92, size * .95, size * .86, leaf);
        ball(`${name}-crown-light`, x + size * .24, size * 1.09, z - .2, size * .67, size * .7, size * .7, '#9fb584');
      };
      const bed = (name: string, x: number, z: number, w: number, leaf: string, bloom: string) => {
        box(`${name}-edge`, x, .1, z, w, .22, .95, '#b5a187');
        box(`${name}-leaf`, x, .28, z, w - .16, .24, .78, leaf);
        for (let i = 0; i < 5; i++) ball(`${name}-flower-${i}`, x + (i - 2) * w / 6, .48, z, .32, .25, .32, i % 2 ? '#f1d796' : bloom);
      };
      const bench = (name: string, x: number, z: number, color = '#b78860') => {
        box(`${name}-seat`, x, .55, z, 2.25, .14, .66, color);
        box(`${name}-back`, x, .98, z - .32, 2.25, .46, .1, color);
        for (const dx of [-.83, .83]) box(`${name}-leg-${dx}`, x + dx, .27, z, .12, .54, .54, '#56635a');
      };
      const lamp = (name: string, x: number, z: number) => {
        pole(`${name}-base`, x, .05, z, .48, .1, '#5d6260');
        pole(`${name}-post`, x, 1.3, z, .11, 2.6, '#5d6260');
        box(`${name}-lantern`, x, 2.6, z, .36, .43, .36, '#f7db9b');
        box(`${name}-cap`, x, 2.87, z, .52, .1, .52, '#5d6260');
      };

      if (theme === 'garden') {
        if (zone === 'rear') {
          box('garden-meadow', centerX, -.16, -17, rearWidth, .09, 14, '#94ad7d');
          box('garden-back-path', centerX, -.08, -11.2, rearWidth, .06, 1.2, '#d9c7a2');
          // The distant canopy and two quiet cottages create a recognizable neighborhood.
          for (const [i, x] of range(-14, right + 6, 6.2).entries()) tree(`garden-rear-tree-${i}`, x, -18 - i % 2 * 2, 3.4 + i % 3 * .55, i % 2 ? '#668e71' : '#7c9c71');
          for (const [i, x, color] of [[0, -6, '#e0c2a0'], [1, 10 + (roomWidth - 18) / 2, '#c1cfc0']] as const) {
            box(`garden-cottage-${i}`, x, 1.6, -14, 5, 3.2, 3.5, color);
            box(`garden-cottage-roof-${i}`, x, 3.28, -14, 5.7, .35, 4.1, '#96765f');
            box(`garden-cottage-door-${i}`, x, .88, -12.22, .9, 1.75, .08, '#6c897c');
            for (const dx of [-1.55, 1.55]) { box(`garden-window-frame-${i}-${dx}`, x + dx, 1.7, -12.2, 1.02, 1.3, .08, '#f0e7cb'); box(`garden-window-${i}-${dx}`, x + dx, 1.7, -12.14, .78, 1.02, .05, '#759692'); }
          }
          for (const [i, x] of range(centerX-rearWidth/2+.2, centerX+rearWidth/2-.2, 3.6).entries()) box(`garden-fence-post-${i}`, x, .55, -10.45, .14, 1.1, .14, '#dfd3b3');
          for (const y of [.35, .84]) box(`garden-fence-rail-${y}`, centerX, y, -10.45, rearWidth, .12, .12, '#dfd3b3');
        } else if (zone === 'left') {
          box('garden-side-meadow', -15.2, -.13, sideCenter, 7.2, .06, sideDepth, '#93ae7e');
          box('garden-side-trail', -12, -.065, sideCenter, 1.1, .05, sideDepth, '#d8cba9');
          for (const [i, z] of range(-5, front+5, 6).entries()) tree(`garden-side-tree-${i}`, -15.6 - i % 2 * 1.1, z, 2.5 + i % 2 * .7);
          bench('garden-bench', -12.8, -1.7); bed('garden-left-bed', -12.8, 10, 2.6, '#6e9775', '#e7aaa3');
          for (const [i, z] of range(12, front+7, 1.9).entries()) box(`garden-stepping-stone-${i}`, -11.8, -.025, z, .9, .05, .64, '#e2d7bc', i % 2 * .16);
        } else if (zone === 'right') {
          // A low, broad border stays clear of all four exit positions.
          box('garden-right-lawn', 17, -.13, (8+front+8)/2, 4.2, .06, front, '#98b284');
          for (const z of range(10, front+8, 5)) bed(`garden-right-bed-${z}`, 17, z, 2.9, '#789a71', '#e1a297');
          for (const z of range(11.5, front+8, 6)) ball(`garden-right-stone-${z}`, 19, .17, z, 1.1, .4, .7, '#b3b3a0');
        } else {
          box('garden-front-gravel', 1.5, -.09, 13.5, frontWidth, .08, 3.8, '#c9bb97');
          box('garden-front-verge', 1.5, -.12, 16.5, frontWidth, .08, 2.4, '#94ad7d');
          for (const x of range(4-frontWidth/2, frontWidth/2-1, 8)) bed(`garden-front-bed-${x}`, x, 16.2, 3.5, '#73946d', '#dcaaa4');
          for (const [i, x] of range(3-frontWidth/2, frontWidth/2, 3.8).entries()) box(`garden-front-paver-${i}`, x, -.035, 12.6, 1.8, .045, .65, '#e1d5b4');
        }
      } else if (theme === 'terrace') {
        if (zone === 'rear') {
          box('terrace-opposite-pavement', centerX, -.08, -12.1, rearWidth, .09, 4.1, '#d4c7b2');
          const colors = ['#d6b89e', '#b4c3b9', '#cbbcad', '#c0b1a5', '#cbbf9c'];
          for (const [i, x] of range(-11, right+5, 8.2).entries()) {
            const h = 3.7 + i % 3 * .8;
            box(`terrace-townhouse-${i}`, x, h / 2, -16.1, 6.7, h, 4.5, colors[i % colors.length]);
            box(`terrace-roof-line-${i}`, x, h + .07, -16.1, 7, .16, 4.8, '#877f73');
            box(`terrace-shopfront-${i}`, x, 1.12, -13.81, 5.45, 2, .1, '#64827e');
            for (const dx of [-2.3, 0, 2.3]) box(`terrace-shop-mullion-${i}-${dx}`, x + dx, 1.15, -13.73, .09, 2.1, .09, '#e8dfcc');
            box(`terrace-awning-${i}`, x, 2.33, -13.25, 6, .16, 1.5, i % 2 ? '#889d8d' : '#c79777');
            for (let j = 0; j < 5; j++) box(`terrace-awning-stripe-${i}-${j}`, x - 2.4 + j * 1.2, 2.425, -13.25, .44, .025, 1.5, '#eadfc6');
            for (const dx of [-1.8, 1.8]) { box(`terrace-upper-frame-${i}-${dx}`, x + dx, h - .95, -13.79, 1.24, 1.4, .08, '#eadfc6'); box(`terrace-upper-window-${i}-${dx}`, x + dx, h - .95, -13.73, 1, 1.15, .07, '#799690'); }
          }
          for (const x of range(-10, right+3, 18)) { lamp(`terrace-street-lamp-${x}`, x, -11); bed(`terrace-street-planter-${x}`, x + 2, -11, 2.2, '#799780', '#e4b18d'); }
        } else if (zone === 'left') {
          box('terrace-side-plaza', -15, -.12, sideCenter, 7.3, .08, sideDepth, '#c5b79f');
          for (const [i, z] of range(-9, front+8, 3.4).entries()) box(`terrace-side-joint-${i}`, -15, -.068, z, 7.3, .012, .035, '#a89983');
          // A seating pocket belongs to the plaza, away from the entrance corridor.
          for (const z of range(-1, front+6, 14)) {
            pole(`terrace-table-${z}`, -15.7, .8, z, 1.6, .12, '#aa8663');
            pole(`terrace-table-base-${z}`, -15.7, .4, z, .16, .8, '#6d7368');
            pole(`terrace-parasol-pole-${z}`, -15.7, 1.25, z, .085, 2.5, '#7d7663');
            ball(`terrace-parasol-${z}`, -15.7, 2.55, z, 3.4, .5, 3.4, '#dcc7a0');
            for (const dx of [-1.4, 1.4]) { box(`terrace-chair-${z}-${dx}`, -15.7 + dx, .5, z, .64, .12, .65, '#a88d6c'); box(`terrace-chair-back-${z}-${dx}`, -15.7 + dx, .8, z - .3, .64, .6, .1, '#a88d6c'); }
          }
        } else if (zone === 'right') {
          box('terrace-right-paving', 17, -.12, (8+front+8)/2, 4.5, .08, front, '#c5b79f');
          for (const z of range(10, front+5, 6)) { bed(`terrace-right-planter-${z}`, 17.5, z, 3, '#8c9c78', '#cdab82'); bench(`terrace-right-bench-${z}`, 17.5, z + 2); }
        } else {
          box('terrace-front-plaza', 1.5, -.105, 14.4, frontWidth, .09, 6.3, '#c5b79f');
          for (const [i, x] of range(1.7-frontWidth/2, frontWidth/2+1.3, 3.5).entries()) box(`terrace-front-joint-${i}`, x, -.052, 14.4, .035, .012, 6.3, '#aa9b86');
          for (const z of [12.3, 14.5, 16.7]) box(`terrace-front-course-${z}`, 1.5, -.05, z, frontWidth, .012, .035, '#aa9b86');
          for (const x of range(4-frontWidth/2, frontWidth/2-1, 9)) bed(`terrace-front-bed-${x}`, x, 17.5, 3.4, '#909f7c', '#dcb295');
        }
      } else {
        if (zone === 'rear') {
          box('sunset-water', centerX, -.155, -17, rearWidth, .09, 10, '#87a6a5');
          box('sunset-far-bank', centerX, -.045, -24, rearWidth, .09, 4, '#999b92');
          // Muted distant massing, with a few tall silhouettes, leaves the shop dominant.
          for (const [i, x] of range(-12, right+5, 6.1).entries()) { const h = 1.5 + (i * 7 % 5) * .55; box(`sunset-skyline-${i}`, x, h / 2, -24, 4.4, h, 3, i % 2 ? '#9f9994' : '#a9a197'); }
          for (const [i, x] of range(-12, right+5, 4.9).entries()) box(`sunset-water-ripple-${i}`, x, -.095, -13 - i % 4 * 2.5, 2.3 + i % 3, .01, .14, i % 2 ? '#b3bfb0' : '#d9c5a2');
          box('sunset-quayside', centerX, -.04, -10.75, rearWidth, .12, 1.9, '#b7a292');
          for (const y of [.43, .86]) box(`sunset-rear-railing-${y}`, centerX, y, -11.5, rearWidth, .075, .075, '#727f7a');
          for (const [i, x] of range(centerX-rearWidth/2+.2, centerX+rearWidth/2-.2, 3.6).entries()) pole(`sunset-rear-post-${i}`, x, .46, -11.5, .09, .92, '#727f7a');
          for (const x of range(-12, right+5, 14)) lamp(`sunset-promenade-lamp-${x}`, x, -10.2);
          for (const x of range(-9, right-4, 28)) { box(`sunset-boat-${x}`, x, -.015, -16, 2.7, .24, 1.05, '#e2c7a3', -.12); box(`sunset-boat-cabin-${x}`, x - .25, .3, -16, 1.05, .4, .74, '#f0ddbb'); }
        } else if (zone === 'left') {
          box('sunset-side-promenade', -14.7, -.09, sideCenter, 6.4, .1, sideDepth, '#c4ab96');
          for (const z of range(-4, front+1, 14)) { lamp(`sunset-side-lamp-${z}`, -15.7, z); bench(`sunset-side-bench-${z}`, -13.8, z + 3, '#b88e76'); bed(`sunset-side-bed-${z}`, -15, z + 6, 2.5, '#979e85', '#cfab91'); }
          for (const [i, z] of range(-9, front+8, 3).entries()) box(`sunset-side-board-${i}`, -14.7, -.032, z, 6.4, .012, .04, '#ac9180');
        } else if (zone === 'right') {
          box('sunset-right-cobble', 17.5, -.1, (8+front+8)/2, 4.5, .1, front, '#c4ab96');
          for (const z of range(10, front+8, 6)) bed(`sunset-right-bed-${z}`, 17.8, z, 3.3, '#999b7c', '#d9b796');
          for (const z of range(12, front+8, 7)) pole(`sunset-right-bollard-${z}`, 16.2, .32, z, .28, .64, '#877e71');
        } else {
          box('sunset-front-promenade', 1.5, -.09, 14.4, frontWidth, .1, 6.3, '#c4ab96');
          for (const [i, x] of range(1.7-frontWidth/2, frontWidth/2+1.3, 2.5).entries()) box(`sunset-front-board-${i}`, x, -.032, 14.4, .045, .012, 6.3, '#aa9180');
          box('sunset-front-verge', 1.5, -.13, 18.4, frontWidth, .1, 1.7, '#b0a27f');
          for (const x of range(4-frontWidth/2, frontWidth/2-1, 9)) bed(`sunset-front-grasses-${x}`, x, 18.2, 3.8, '#a0a084', '#cfb38e');
        }
      }

      const data = geometry[0].merge(geometry.slice(1), true);
      const mesh = zones.get(zone) ?? new Mesh(`backdrop-${theme}-${zone}`, this.scene);
      mesh.unfreezeWorldMatrix();
      data.applyToMesh(mesh);
      mesh.material = this.material;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.metadata = { coffeeExterior: 'decoration', coffeeBackdropDetail: theme, coffeeBackdropZone: zone, coffeeBackdropParts: parts };
      mesh.freezeWorldMatrix();
      zones.set(zone, mesh);
    }
  }
}
