import type { Move } from '../gcode/modal';
import type { StockBounds, Vec3 } from '../shared/types';
import { pointsForMove } from '../interpreter/geometry';
import type { Toolpath } from '../interpreter/toolpath';

/** Grid resolution applies to the longest stock axis; other axes scale to square cells. */
export interface StockConfig {
  bounds: StockBounds;
  toolDiameterMm: number;
  resolution?: number;
}

export interface RapidPenetration {
  /** Maximum depth below the material present when the rapid executed. */
  depthMm: number;
  at: Vec3;
}

export interface StockSimulation {
  bounds: StockBounds;
  columns: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  /** Row-major remaining top Z in mm; index = row * columns + col. */
  heights: Float32Array;
  initialVolumeMm3: number;
  remainingVolumeMm3: number;
  /** Keyed by canonical move object, so subprogram line numbers cannot collide. */
  penetrationByMove: Map<Move, RapidPenetration>;
  /** Returns null outside the stock XY envelope or where material is fully removed. */
  heightAt(x: number, y: number): number | null;
}

const MAX_GRID_RESOLUTION = 320;
const MIN_GRID_RESOLUTION = 16;
const PENETRATION_TOLERANCE_MM = 0.01;

function resample(points: Vec3[], maxStepMm: number): Vec3[] {
  if (points.length === 0) return [];

  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    totalLength += Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
      current.z - previous.z,
    );
  }
  const step = Math.max(maxStepMm, totalLength / 20000);
  if (step <= 0) return [points[0]];

  const sampled: Vec3[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
      current.z - previous.z,
    );
    const divisions = Math.max(1, Math.ceil(length / step));
    for (let division = 1; division <= divisions; division += 1) {
      const fraction = division / divisions;
      sampled.push({
        x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction,
        z: previous.z + (current.z - previous.z) * fraction,
      });
    }
  }
  return sampled;
}

/** Sweeps the canonical toolpath through a 2.5D stock height map. */
export function simulateStock(
  toolpath: Toolpath,
  config: StockConfig,
): StockSimulation {
  const { bounds } = config;
  const spanX = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const spanY = Math.max(bounds.max.y - bounds.min.y, 1e-6);
  const resolution = Math.min(
    MAX_GRID_RESOLUTION,
    Math.max(MIN_GRID_RESOLUTION, Math.round(config.resolution ?? 160)),
  );
  const cellsPerMm = resolution / Math.max(spanX, spanY);
  const columns = Math.max(1, Math.ceil(spanX * cellsPerMm));
  const rows = Math.max(1, Math.ceil(spanY * cellsPerMm));
  const cellWidthMm = spanX / columns;
  const cellHeightMm = spanY / rows;
  const cellArea = cellWidthMm * cellHeightMm;
  const radius = Math.max(config.toolDiameterMm, 0.01) / 2;
  const radiusSquared = radius * radius;

  const heights = new Float32Array(columns * rows).fill(bounds.max.z);
  let remainingVolumeMm3 = heights.length * cellArea * (bounds.max.z - bounds.min.z);

  function heightAt(x: number, y: number): number | null {
    if (
      x < bounds.min.x ||
      x > bounds.max.x ||
      y < bounds.min.y ||
      y > bounds.max.y
    ) {
      return null;
    }
    const column = Math.min(
      columns - 1,
      Math.max(0, Math.floor((x - bounds.min.x) / cellWidthMm)),
    );
    const row = Math.min(
      rows - 1,
      Math.max(0, Math.floor((y - bounds.min.y) / cellHeightMm)),
    );
    const height = heights[row * columns + column];
    return height > bounds.min.z + 1e-6 ? height : null;
  }

  function removeAt(x: number, y: number, z: number): void {
    const target = Math.max(z, bounds.min.z);
    if (target >= bounds.max.z) return;

    const firstColumn = Math.max(
      0,
      Math.floor((x - radius - bounds.min.x) / cellWidthMm),
    );
    const lastColumn = Math.min(
      columns - 1,
      Math.ceil((x + radius - bounds.min.x) / cellWidthMm),
    );
    const firstRow = Math.max(
      0,
      Math.floor((y - radius - bounds.min.y) / cellHeightMm),
    );
    const lastRow = Math.min(
      rows - 1,
      Math.ceil((y + radius - bounds.min.y) / cellHeightMm),
    );

    for (let row = firstRow; row <= lastRow; row += 1) {
      const centerY = bounds.min.y + (row + 0.5) * cellHeightMm;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const centerX = bounds.min.x + (column + 0.5) * cellWidthMm;
        if (
          (centerX - x) ** 2 + (centerY - y) ** 2 > radiusSquared
        ) {
          continue;
        }
        const index = row * columns + column;
        const top = heights[index];
        if (top <= target) continue;
        remainingVolumeMm3 -= (top - target) * cellArea;
        heights[index] = target;
      }
    }
  }

  const penetrationByMove = new Map<Move, RapidPenetration>();
  const sampleStepMm = Math.max(0.05, Math.min(cellWidthMm, cellHeightMm) * 0.75);

  for (const move of toolpath.moves) {
    const points = resample(pointsForMove(move), sampleStepMm);
    if (move.kind === 'rapid') {
      let deepest: RapidPenetration | null = null;
      for (const point of points) {
        const height = heightAt(point.x, point.y);
        if (height === null) continue;
        const depthMm = height - point.z;
        if (depthMm <= PENETRATION_TOLERANCE_MM) continue;
        if (deepest && depthMm <= deepest.depthMm) continue;
        deepest = { depthMm, at: point };
      }
      if (deepest) penetrationByMove.set(move, deepest);
      continue;
    }

    for (const point of points) removeAt(point.x, point.y, point.z);
  }

  return {
    bounds,
    columns,
    rows,
    cellWidthMm,
    cellHeightMm,
    heights,
    initialVolumeMm3: heights.length * cellArea * (bounds.max.z - bounds.min.z),
    remainingVolumeMm3: Math.max(0, remainingVolumeMm3),
    penetrationByMove,
    heightAt,
  };
}
