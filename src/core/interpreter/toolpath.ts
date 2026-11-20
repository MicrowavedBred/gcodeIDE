import type { Move, ProgramEvaluation } from '../gcode/modal';
import {
  pointsForMove,
  polylineLength,
  toolpathBounds,
  type Bounds,
} from './geometry';

export type MoveKind = 'rapid' | 'linear' | 'arc' | 'cycle';
export type MoveCounts = Record<MoveKind, number>;

export interface MoveLengths extends MoveCounts {
  total: number;
}

/** Canonical toolpath shared by diagnostics, the backplot, and future cycle-time checks. */
export interface Toolpath {
  moves: Move[];
  bounds: Bounds | null;
  counts: MoveCounts;
  /** Polyline approximation of travel distance, in millimetres. */
  lengthsMm: MoveLengths;
}

function moveKind(move: Move): MoveKind {
  return move.kind === 'canned-cycle' ? 'cycle' : move.kind;
}

export function emptyCounts(): MoveCounts {
  return { rapid: 0, linear: 0, arc: 0, cycle: 0 };
}

/** Derives the canonical ordered toolpath from evaluated semantic events. */
export function buildToolpath(evaluation: ProgramEvaluation): Toolpath {
  const moves: Move[] = [];
  for (const event of evaluation.events) {
    if (event.kind === 'move') moves.push(event.move);
  }

  const counts = emptyCounts();
  const lengthsMm: MoveLengths = { rapid: 0, linear: 0, arc: 0, cycle: 0, total: 0 };

  for (const move of moves) {
    const kind = moveKind(move);
    counts[kind] += 1;
    lengthsMm[kind] += polylineLength(pointsForMove(move));
  }
  for (const kind of Object.keys(counts) as MoveKind[]) {
    lengthsMm.total += lengthsMm[kind];
  }

  return { moves, bounds: toolpathBounds(moves), counts, lengthsMm };
}
