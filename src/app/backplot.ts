import * as THREE from 'three';
import { pointsForMove, type Bounds } from '../core/interpreter/geometry';
import type { Move } from '../core/gcode/modal';
import type { Toolpath } from '../core/interpreter/toolpath';

export interface BackplotHandle {
  setToolpath(toolpath: Toolpath): void;
  dispose(): void;
}

const colors = {
  rapid: 0xf0a870,
  linear: 0x7fc8a0,
  arc: 0x8ab4f8,
  cycle: 0xd6c17a,
};

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

function buildLines(toolpath: Toolpath): THREE.Group {
  const group = new THREE.Group();
  for (const move of toolpath.moves) {
    const points = pointsForMove(move);
    if (points.length < 2) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
    );
    const material = new THREE.LineBasicMaterial({ color: colorForMove(move) });
    group.add(new THREE.Line(geometry, material));
  }
  return group;
}

function disposeLines(group: THREE.Group): void {
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
  let lines: THREE.Group | null = null;

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

  function applyBounds(bounds: Bounds | null): void {
    if (!bounds) {
      viewCenter.set(0, 0, 0);
      viewSize = 100;
      return;
    }
    viewCenter.set(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const extent = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    );
    viewSize = Math.max(extent, 20) * 1.4;
  }

  const observer = new ResizeObserver(applyCamera);
  observer.observe(container);
  applyCamera();

  return {
    setToolpath(toolpath) {
      if (lines) {
        scene.remove(lines);
        disposeLines(lines);
      }
      lines = buildLines(toolpath);
      scene.add(lines);
      applyBounds(toolpath.bounds);
      applyCamera();
    },
    dispose() {
      observer.disconnect();
      if (lines) {
        scene.remove(lines);
        disposeLines(lines);
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
