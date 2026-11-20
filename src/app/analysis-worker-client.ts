import { restoreStockSimulation, simulateStock } from '../core/simulation/stock';
import type { SerializedStockSimulation } from '../core/simulation/stock';
import type { ParsedProgram } from '../core/gcode/parser';
import type { ResolvedMachineProfile } from '../core/profiles/types';
import SimulationWorker from './simulation.worker?worker';
import type { SimulationRequest, SimulationResponse } from './simulation.worker';
import { buildAnalysisParts, finishAnalysis } from './analysis';
import type { AnalysisOptions, ProgramAnalysis } from './analysis';

interface Pending {
  resolve: (data: SerializedStockSimulation) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const instance = new SimulationWorker();
    instance.onmessage = (event: MessageEvent<SimulationResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve(event.data.simulation);
    };
    instance.onerror = (event) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(event.message || 'Simulation worker failed.'));
      }
      pending.clear();
      instance.terminate();
      if (worker === instance) worker = null;
    };
    worker = instance;
    return instance;
  } catch {
    return null;
  }
}

/** Terminates the worker and rejects in-flight simulations so callers can fall back. */
export function disposeAnalysisWorker(): void {
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) {
    entry.reject(new Error('Simulation worker disposed.'));
  }
  pending.clear();
}

/**
 * Runs parse/evaluate/toolpath and rules on the caller thread, with stock
 * simulation offloaded to a worker. Falls back to synchronous simulation when
 * workers are unavailable or fail.
 */
export async function analyzeProgramAsync(
  text: string,
  file: string,
  profile: ResolvedMachineProfile,
  subprograms: ParsedProgram[] = [],
  options: AnalysisOptions = {},
): Promise<ProgramAnalysis> {
  const parts = buildAnalysisParts(text, file, profile, subprograms);
  const stock = options.stock;
  if (!stock) return finishAnalysis(parts, profile, options, null);

  const simulateLocally = () =>
    finishAnalysis(parts, profile, options, simulateStock(parts.toolpath, stock));
  const instance = getWorker();
  if (!instance) return simulateLocally();

  const id = ++nextId;
  try {
    const data = await new Promise<SerializedStockSimulation>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const request: SimulationRequest = {
        id,
        moves: parts.toolpath.moves,
        config: stock,
      };
      instance.postMessage(request);
    });
    return finishAnalysis(
      parts,
      profile,
      options,
      restoreStockSimulation(data, parts.toolpath.moves),
    );
  } catch {
    return simulateLocally();
  }
}
