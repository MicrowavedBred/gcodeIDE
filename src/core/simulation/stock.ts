import type { Move } from '../gcode/modal';
import type { StockBounds, Vec3 } from '../shared/types';
import { pointsForMove } from '../interpreter/geometry';
import type { Toolpath } from '../interpreter/toolpath';

export type ToolTipShape = 'flat' | 'ball' | 'bull';

/** Grid resolution applies to the longest stock axis; other axes scale to square cells. */
export interface StockConfig {
  bounds: StockBounds;
  toolDiameterMm: number;
  /** G-code Z is the lowest point of the tool. Defaults to a flat end mill. */
  toolTip?: ToolTipShape;
  /** Corner radius for bull-nose tools; clamped to half the tool diameter. */
  cornerRadiusMm?: number;
  resolution?: number;
}

export interface RapidPenetration {
  /** Maximum depth below the material present when the rapid executed. */
  depthMm: number;
  at: Vec3;
}

export interface StockSimulation {
  bounds: StockBounds;
  toolTip: ToolTipShape;
  cornerRadiusMm: number;
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

/** Structured-clone-safe form returned by the simulation worker. */
export interface SerializedStockSimulation {
  bounds: StockBounds;
  toolTip: ToolTipShape;
  cornerRadiusMm: number;
  columns: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  heights: Float32Array;
  initialVolumeMm3: number;
  remainingVolumeMm3: number;
  /** Rapid penetrations keyed by the index of the move in the simulated list. */
  penetrations: Array<{ moveIndex: number; depthMm: number; at: Vec3 }>;
}

type StockGrid = Pick<
  StockSimulation,
  'bounds' | 'columns' | 'rows' | 'cellWidthMm' | 'cellHeightMm' | 'heights'
>;

/** Builds the height lookup for a grid; shared by simulation and worker restore. */
export function makeHeightAt(grid: StockGrid): (x: number, y: number) => number | null {
  const { bounds, columns, rows, cellWidthMm, cellHeightMm, heights } = grid;
  return function heightAt(x: number, y: number): number | null {
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
  };
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

/**
 * Bottom surface of the tool at a radial distance from its centre. The tip is
 * the lowest point, so rounded tools leave material outside the centre.
 */
function toolSurfaceZ(
  tipZ: number,
  distance: number,
  radius: number,
  shape: ToolTipShape,
  cornerRadius: number,
): number {
  if (shape === 'flat') return tipZ;
  if (shape === 'ball') {
    if (distance >= radius) return tipZ + radius;
    return tipZ + radius - Math.sqrt(Math.max(0, radius ** 2 - distance ** 2));
  }

  const coreRadius = radius - cornerRadius;
  if (distance <= coreRadius) return tipZ;
  if (distance >= radius) return tipZ + cornerRadius;
  const offset = distance - coreRadius;
  return tipZ + cornerRadius - Math.sqrt(Math.max(0, cornerRadius ** 2 - offset ** 2));
}

/** Sweeps the canonical toolpath through a 2.5D stock height map. */
export function simulateStock(
  toolpath: Pick<Toolpath, 'moves'>,
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
  const toolTip = config.toolTip ?? 'flat';
  const cornerRadiusMm = Math.min(
    radius,
    Math.max(0, config.cornerRadiusMm ?? 0),
  );

  const heights = new Float32Array(columns * rows).fill(bounds.max.z);
  const heightAt = makeHeightAt({
    bounds,
    columns,
    rows,
    cellWidthMm,
    cellHeightMm,
    heights,
  });
  let remainingVolumeMm3 = heights.length * cellArea * (bounds.max.z - bounds.min.z);

  function removeAt(x: number, y: number, z: number): void {
    if (z >= bounds.max.z) return;

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
        const distanceSquared = (centerX - x) ** 2 + (centerY - y) ** 2;
        if (distanceSquared > radiusSquared) {
          continue;
        }
        const target = Math.max(
          bounds.min.z,
          toolSurfaceZ(
            z,
            Math.sqrt(distanceSquared),
            radius,
            toolTip,
            cornerRadiusMm,
          ),
        );
        if (target >= bounds.max.z) continue;
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
    toolTip,
    cornerRadiusMm,
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

/** Converts move-identity keys to indices so the result can cross a worker boundary. */
export function serializeStockSimulation(
  simulation: StockSimulation,
  moves: Move[],
): SerializedStockSimulation {
  const moveIndex = new Map<Move, number>(moves.map((move, index) => [move, index]));
  const penetrations: SerializedStockSimulation['penetrations'] = [];
  for (const [move, penetration] of simulation.penetrationByMove) {
    const index = moveIndex.get(move);
    if (index === undefined) continue;
    penetrations.push({
      moveIndex: index,
      depthMm: penetration.depthMm,
      at: penetration.at,
    });
  }
  return {
    bounds: simulation.bounds,
    toolTip: simulation.toolTip,
    cornerRadiusMm: simulation.cornerRadiusMm,
    columns: simulation.columns,
    rows: simulation.rows,
    cellWidthMm: simulation.cellWidthMm,
    cellHeightMm: simulation.cellHeightMm,
    heights: simulation.heights,
    initialVolumeMm3: simulation.initialVolumeMm3,
    remainingVolumeMm3: simulation.remainingVolumeMm3,
    penetrations,
  };
}

/** Rebuilds move-identity keys and the height lookup on the receiving side. */
export function restoreStockSimulation(
  data: SerializedStockSimulation,
  moves: Move[],
): StockSimulation {
  const penetrationByMove = new Map<Move, RapidPenetration>();
  for (const { moveIndex, depthMm, at } of data.penetrations) {
    const move = moves[moveIndex];
    if (move) penetrationByMove.set(move, { depthMm, at });
  }
  return {
    bounds: data.bounds,
    toolTip: data.toolTip,
    cornerRadiusMm: data.cornerRadiusMm,
    columns: data.columns,
    rows: data.rows,
    cellWidthMm: data.cellWidthMm,
    cellHeightMm: data.cellHeightMm,
    heights: data.heights,
    initialVolumeMm3: data.initialVolumeMm3,
    remainingVolumeMm3: data.remainingVolumeMm3,
    penetrationByMove,
    heightAt: makeHeightAt(data),
  };
}
