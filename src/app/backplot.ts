import * as THREE from 'three';
import type { Move, Plane } from '../core/gcode/modal';

export interface BackplotHandle {
  setMoves(moves: Move[]): void;
  dispose(): void;
}

const colors = {
  rapid: 0xf0a870,
  linear: 0x7fc8a0,
  arc: 0x8ab4f8,
  cycle: 0xd6c17a,
};

const planeAxes: Record<Plane, { u: 'x' | 'y' | 'z'; v: 'x' | 'y' | 'z'; fixed: 'x' | 'y' | 'z' }> = {
  XY: { u: 'x', v: 'y', fixed: 'z' },
  ZX: { u: 'z', v: 'x', fixed: 'y' },
  YZ: { u: 'y', v: 'z', fixed: 'x' },
};

function vector(pose: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(pose.x, pose.y, pose.z);
}

function arcPoints(move: Extract<Move, { kind: 'arc' }>): THREE.Vector3[] {
  const points = [vector(move.from)];
  if (!move.center) {
    points.push(vector(move.to));
    return points;
  }

  const axes = planeAxes[move.plane];
  const [cu, cv] = move.center;
  const startU = move.from[axes.u] - cu;
  const startV = move.from[axes.v] - cv;
  const radius = Math.hypot(startU, startV);
  if (radius < 1e-6) {
    points.push(vector(move.to));
    return points;
  }

  const startAngle = Math.atan2(startV, startU);
  const endAngle = Math.atan2(
    move.to[axes.v] - cv,
    move.to[axes.u] - cu,
  );
  let sweep = endAngle - startAngle;
  if (move.clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }

  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const angle = startAngle + sweep * fraction;
    const point = vector(move.from);
    point[axes.u] = cu + radius * Math.cos(angle);
    point[axes.v] = cv + radius * Math.sin(angle);
    point[axes.fixed] = THREE.MathUtils.lerp(
      move.from[axes.fixed],
      move.to[axes.fixed],
      fraction,
    );
    points.push(point);
  }
  return points;
}

function cyclePoints(
  move: Extract<Move, { kind: 'canned-cycle' }>,
): THREE.Vector3[] {
  const top = move.from.z;
  const bottom = move.z ?? move.at.z;
  const retract = move.r ?? top;
  return [
    new THREE.Vector3(move.at.x, move.at.y, retract),
    new THREE.Vector3(move.at.x, move.at.y, bottom),
    new THREE.Vector3(move.at.x, move.at.y, retract),
    new THREE.Vector3(move.at.x, move.at.y, top),
  ];
}

function pointsForMove(move: Move): THREE.Vector3[] {
  switch (move.kind) {
    case 'rapid':
    case 'linear':
      return [vector(move.from), vector(move.to)];
    case 'arc':
      return arcPoints(move);
    case 'canned-cycle':
      return cyclePoints(move);
  }
}

function colorForMove(move: Move): number {
  switch (move.kind) {
    case 'rapid':
      return colors.rapid;
    case 'linear':
      return colors.linear;
    case 'arc':
      return colors.arc;
    case 'canned-cycle':
      return colors.cycle;
  }
}

function buildToolpath(moves: Move[]): THREE.Group {
  const group = new THREE.Group();
  for (const move of moves) {
    const points = pointsForMove(move);
    if (points.length < 2) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: colorForMove(move) });
    group.add(new THREE.Line(geometry, material));
  }
  return group;
}

function disposeToolpath(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose();
  });
}

export function createBackplot(container: HTMLElement): BackplotHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111820);

  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 10000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const grid = new THREE.GridHelper(200, 20, 0x3a4a5c, 0x25313d);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const axes = new THREE.AxesHelper(25);
  scene.add(axes);

  const viewCenter = new THREE.Vector3();
  let viewSize = 100;
  let toolpath: THREE.Group | null = null;

  function applyCamera(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const halfHeight = viewSize * 0.6;

    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.near = Math.max(0.1, viewSize / 1000);
    camera.far = viewSize * 100;
    camera.position.set(
      viewCenter.x + viewSize,
      viewCenter.y - viewSize * 1.3,
      viewCenter.z + viewSize * 0.9,
    );
    camera.lookAt(viewCenter);
    camera.updateProjectionMatrix();

    grid.scale.setScalar(Math.max(1, viewSize / 100));
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }

  const observer = new ResizeObserver(applyCamera);
  observer.observe(container);
  applyCamera();

  return {
    setMoves(moves) {
      if (toolpath) {
        scene.remove(toolpath);
        disposeToolpath(toolpath);
      }
      toolpath = buildToolpath(moves);
      scene.add(toolpath);

      const bounds = new THREE.Box3();
      for (const move of moves) {
        for (const point of pointsForMove(move)) bounds.expandByPoint(point);
      }
      if (bounds.isEmpty()) {
        viewCenter.set(0, 0, 0);
        viewSize = 100;
      } else {
        bounds.getCenter(viewCenter);
        const extent = bounds.getSize(new THREE.Vector3());
        viewSize = Math.max(extent.x, extent.y, extent.z, 20) * 1.4;
      }
      applyCamera();
    },
    dispose() {
      observer.disconnect();
      if (toolpath) {
        scene.remove(toolpath);
        disposeToolpath(toolpath);
      }
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material)
        ? grid.material
        : [grid.material]) {
        material.dispose();
      }
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material)
        ? axes.material
        : [axes.material]) {
        material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
