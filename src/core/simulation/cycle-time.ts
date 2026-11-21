import type { Move } from '../gcode/modal';
import { pointsForMove, polylineLength } from '../interpreter/geometry';

type CycleMove = Extract<Move, { kind: 'canned-cycle' }>;

export interface CycleTimeRates {
  /** Machine rapid rate in mm/min. No default is inferred when absent. */
  rapidRateMmPerMin: number | null;
}

export interface CycleTimeBreakdownSeconds {
  rapid: number;
  feed: number;
  cycle: number;
  dwell: number;
}

export interface CycleTimeEstimate {
  /** Null when a required rate is missing; `reasons` explains what is needed. */
  seconds: number | null;
  breakdown: CycleTimeBreakdownSeconds;
  reasons: string[];
  /** Canned-cycle paths are approximated from R plane, depth, feed and peck Q. */
  approximateCycles: boolean;
}

function usableRate(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function cycleDistances(move: CycleMove): { rapidMm: number; feedMm: number } {
  const top = move.from.z;
  const retract = move.r ?? top;
  const bottom = move.z ?? move.at.z;
  const depth = Math.max(0, retract - bottom);
  const xyMm = Math.hypot(move.at.x - move.from.x, move.at.y - move.from.y);
  const liftMm = Math.max(0, top - retract);
  let feedMm = depth;
  let peckRetractMm = 0;

  if (move.code === 'G77') {
    feedMm = depth * 2;
  } else if (
    (move.code === 'G83' || move.code === 'G73') &&
    move.q !== undefined &&
    usableRate(move.q) !== null &&
    depth > 0
  ) {
    const pecks = Math.ceil(depth / move.q);
    peckRetractMm = Math.max(0, pecks - 1) * move.q;
  }

  return {
    rapidMm: xyMm + liftMm + peckRetractMm,
    feedMm,
  };
}

/** Estimates cycle time from the canonical toolpath; never guesses a missing rate. */
export function estimateCycleTime(
  moves: readonly Move[],
  dwellSeconds: number,
  rates: CycleTimeRates,
): CycleTimeEstimate {
  const rapidRate = usableRate(rates.rapidRateMmPerMin);
  const reasons = new Set<string>();
  const breakdown: CycleTimeBreakdownSeconds = {
    rapid: 0,
    feed: 0,
    cycle: 0,
    dwell: Number.isFinite(dwellSeconds)
      ? Math.max(0, dwellSeconds)
      : 0,
  };
  let approximateCycles = false;

  for (const move of moves) {
    if (move.kind === 'canned-cycle') {
      approximateCycles = true;
      const { rapidMm, feedMm } = cycleDistances(move);
      if (rapidMm > 0 && rapidRate === null) {
        reasons.add('Rapid rate is not configured for this variant.');
      }
      if (rapidRate !== null) breakdown.cycle += (rapidMm / rapidRate) * 60;
      const cycleFeedMode = move.feedMode ?? 'G94';
      if (feedMm > 0 && cycleFeedMode !== 'G94') {
        reasons.add(
          `Cycle time is unavailable for ${cycleFeedMode} feed on line ${move.line}.`,
        );
        continue;
      }
      const feed = usableRate(move.feed);
      if (feedMm > 0 && feed === null) {
        reasons.add(`Feed rate missing on line ${move.line}.`);
      }
      if (feed !== null) breakdown.cycle += (feedMm / feed) * 60;
      continue;
    }

    const distanceMm = polylineLength(pointsForMove(move));
    if (move.kind === 'rapid') {
      if (rapidRate === null) {
        reasons.add('Rapid rate is not configured for this variant.');
      } else {
        breakdown.rapid += (distanceMm / rapidRate) * 60;
      }
      continue;
    }

    const feedMode = move.feedMode ?? 'G94';
    if (feedMode !== 'G94') {
      reasons.add(
        `Cycle time is unavailable for ${feedMode} feed on line ${move.line}.`,
      );
      continue;
    }
    const feed = usableRate(move.feed);
    if (feed === null) {
      reasons.add(`Feed rate missing on line ${move.line}.`);
    } else {
      breakdown.feed += (distanceMm / feed) * 60;
    }
  }

  const seconds =
    reasons.size === 0
      ? breakdown.rapid + breakdown.feed + breakdown.cycle + breakdown.dwell
      : null;

  return {
    seconds,
    breakdown,
    reasons: [...reasons],
    approximateCycles,
  };
}
