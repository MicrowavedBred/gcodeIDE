import * as THREE from 'three';
import { pointsForMove, type Bounds } from '../core/interpreter/geometry';
import type { Move } from '../core/gcode/modal';
import type { StockSimulation } from '../core/simulation/stock';
import type { Toolpath } from '../core/interpreter/toolpath';

export interface BackplotHandle {
  setToolpath(toolpath: Toolpath): void;
  setStock(simulation: StockSimulation | null): void;
  dispose(): void;
}

const colors = {
  rapid: 0xf0a870,
  linear: 0x7fc8a0,
  arc: 0x8ab4f8,
  cycle: 0xd6c17a,
  stock: 0x5f8f70,
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

function buildStock(simulation: StockSimulation): THREE.Group {
  const group = new THREE.Group();
  const { bounds, columns, rows, cellWidthMm, cellHeightMm, heights } = simulation;
  const box = new THREE.Box3(
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  );
  group.add(new THREE.Box3Helper(box, colors.stock));

  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      let total = 0;
      let count = 0;
      for (const adjacentRow of [row - 1, row]) {
        for (const adjacentColumn of [column - 1, column]) {
          if (
            adjacentRow < 0 ||
            adjacentRow >= rows ||
            adjacentColumn < 0 ||
            adjacentColumn >= columns
          ) {
            continue;
          }
          total += heights[adjacentRow * columns + adjacentColumn];
          count += 1;
        }
      }

      const vertex = row * (columns + 1) + column;
      positions[vertex * 3] = bounds.min.x + column * cellWidthMm;
      positions[vertex * 3 + 1] = bounds.min.y + row * cellHeightMm;
      positions[vertex * 3 + 2] = count > 0 ? total / count : bounds.min.z;
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lowerLeft = row * (columns + 1) + column;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + columns + 1;
      const upperRight = upperLeft + 1;
      indices.push(lowerLeft, upperLeft, lowerRight);
      indices.push(lowerRight, upperLeft, upperRight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: colors.stock,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(geometry, material));
  return group;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose();
  });
}

function unionBounds(first: Bounds | null, second: Bounds | null): Bounds | null {
  if (!first) return second;
  if (!second) return first;
  return {
    min: {
      x: Math.min(first.min.x, second.min.x),
      y: Math.min(first.min.y, second.min.y),
      z: Math.min(first.min.z, second.min.z),
    },
    max: {
      x: Math.max(first.max.x, second.max.x),
      y: Math.max(first.max.y, second.max.y),
      z: Math.max(first.max.z, second.max.z),
    },
  };
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
  let stock: THREE.Group | null = null;
  let toolpathBounds: Bounds | null = null;
  let stockBounds: Bounds | null = null;

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

  function applyBounds(): void {
    const bounds = unionBounds(toolpathBounds, stockBounds);
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
        disposeGroup(lines);
      }
      lines = buildLines(toolpath);
      scene.add(lines);
      toolpathBounds = toolpath.bounds;
      applyBounds();
      applyCamera();
    },
    setStock(simulation) {
      if (stock) {
        scene.remove(stock);
        disposeGroup(stock);
      }
      stock = simulation ? buildStock(simulation) : null;
      if (stock) scene.add(stock);
      stockBounds = simulation?.bounds ?? null;
      applyBounds();
      applyCamera();
    },
    dispose() {
      observer.disconnect();
      if (lines) {
        scene.remove(lines);
        disposeGroup(lines);
      }
      if (stock) {
        scene.remove(stock);
        disposeGroup(stock);
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
