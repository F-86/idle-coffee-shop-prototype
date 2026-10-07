export interface Point2 { x: number; y: number }
export interface Bounds2 { left: number; right: number; bottom: number; top: number }
interface Vector { x: number; y: number; z: number }
interface Land { minX: number; maxX: number; minZ: number; maxZ: number; y: number }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Clip a convex camera-center region, not independent axes in two coordinate systems. */
function clip(polygon: Point2[], axis: 'x'|'y', value: number, lower: boolean): Point2[] {
  const result: Point2[] = [];
  const inside = (p: Point2) => lower ? p[axis] >= value - 1e-9 : p[axis] <= value + 1e-9;
  for (let i=0; i<polygon.length; i++) {
    const a=polygon[i], b=polygon[(i+1)%polygon.length], ai=inside(a), bi=inside(b);
    if(ai)result.push(a);
    if(ai!==bi) { const t=(value-a[axis])/(b[axis]-a[axis]); result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}); }
  }
  return result;
}

export function constrainPan(point: Point2, polygon: readonly Point2[]): Point2 {
  if(!polygon.length)return {x:0,y:0};
  let area=0, inside=true;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a.x*b.y-b.x*a.y;
    if((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)<-1e-8)inside=false;
  }
  if(area>1e-8&&inside)return point;
  let best=polygon[0], distance=Infinity;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    const p={x:a.x+dx*t,y:a.y+dy*t},d=(point.x-p.x)**2+(point.y-p.y)**2;
    if(d<distance){best=p;distance=d;}
  }
  return {x:best.x,y:best.y};
}

/** Find a legal center that shows the entire target, before changing zoom. */
export function panForTarget(polygon: readonly Point2[], target: Bounds2, halfWidth: number, halfHeight: number, padX: number, padY: number): Point2 | null {
  const left=target.right-halfWidth+padX,right=target.left+halfWidth-padX,
    bottom=target.top-halfHeight+padY,top=target.bottom+halfHeight-padY;
  if(left>right||bottom>top)return null;
  const visible=clip(clip(clip(clip([...polygon],'x',left,true),'x',right,false),'y',bottom,true),'y',top,false);
  return visible.length?constrainPan({x:(target.left+target.right)/2,y:(target.bottom+target.top)/2},visible):null;
}

/** Orthographic view must stay over finite land and keep the shop in useful reach. */
export function cameraFrame(input: {
  land: Land; content: Bounds2; base: Vector; right: Vector; up: Vector;
  width: number; height: number; nominalHalfHeight: number; zoom: number; home?: Point2;
}) {
  const {land,content,base,right,up}=input, aspect=Math.max(.1,input.width/Math.max(1,input.height));
  const determinant=right.x*up.z-right.z*up.x;
  const inverse={xx:up.z/determinant,xy:-right.z/determinant,zx:-up.x/determinant,zy:right.x/determinant};
  const groundOffset=up.y*(land.y-base.y);
  const project=(x:number,z:number):Point2=>({x:right.x*(x-base.x)+right.z*(z-base.z),y:up.x*(x-base.x)+up.z*(z-base.z)+groundOffset});
  const home=input.home??{x:(content.left+content.right)/2,y:(content.bottom+content.top)/2};
  const homeGround={x:base.x+inverse.xx*home.x+inverse.xy*(home.y-groundOffset),z:base.z+inverse.zx*home.x+inverse.zy*(home.y-groundOffset)};
  const unitX=Math.abs(inverse.xx)*aspect+Math.abs(inverse.xy),unitZ=Math.abs(inverse.zx)*aspect+Math.abs(inverse.zy);
  // A small ground margin absorbs camera Float32 precision at the viewport edge.
  const roomX=Math.min(homeGround.x-land.minX,land.maxX-homeGround.x)-.12;
  const roomZ=Math.min(homeGround.z-land.minZ,land.maxZ-homeGround.z)-.12;
  const maximumHalfHeight=Math.max(1e-6,Math.min(roomX/unitX,roomZ/unitZ));
  // Fit the current screen before applying user zoom. Even short, wide windows
  // retain enough zoom-in range to reach corner furniture without empty canvas.
  const nominal=Math.min(input.nominalHalfHeight,maximumHalfHeight);
  const minimumZoom=Math.max(.6,nominal/maximumHalfHeight),zoom=clamp(input.zoom,minimumZoom,2.25);
  const halfHeight=nominal/zoom,halfWidth=halfHeight*aspect;
  const hx=unitX*halfHeight,hz=unitZ*halfHeight;
  const x0=land.minX+hx+.04,x1=land.maxX-hx-.04,z0=land.minZ+hz+.04,z1=land.maxZ-hz-.04;
  let polygon=[project(x0,z0),project(x1,z0),project(x1,z1),project(x0,z1)];
  const padX=2*halfWidth*Math.min(64,input.width*.12)/Math.max(1,input.width);
  const padY=2*halfHeight*Math.min(96,input.height*.14)/Math.max(1,input.height);
  const interval=(lo:number,hi:number,half:number,pad:number):[number,number]=>{
    const a=lo+half-pad,b=hi-half+pad;
    // If the whole content fits, its spare frame space is a safe small pan range.
    return a<=b?[a,b]:[b,a];
  };
  let [left,rightEdge]=interval(content.left,content.right,halfWidth,padX),[bottom,top]=interval(content.bottom,content.top,halfHeight,padY);
  left=Math.min(left,home.x);rightEdge=Math.max(rightEdge,home.x);bottom=Math.min(bottom,home.y);top=Math.max(top,home.y);
  polygon=clip(clip(clip(clip(polygon,'x',left,true),'x',rightEdge,false),'y',bottom,true),'y',top,false);
  // Home is feasible by construction, including collapsed center intervals.
  if(!polygon.length)polygon=[home];
  return {halfHeight,halfWidth,zoom,minimumZoom,home,polygon,
    bounds:{left:Math.min(...polygon.map(p=>p.x)),right:Math.max(...polygon.map(p=>p.x)),bottom:Math.min(...polygon.map(p=>p.y)),top:Math.max(...polygon.map(p=>p.y))}};
}
