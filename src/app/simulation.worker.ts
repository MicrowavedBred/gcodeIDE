import {
  serializeStockSimulation,
  simulateStock,
  type SerializedStockSimulation,
  type StockConfig,
} from '../core/simulation/stock';
import type { Move } from '../core/gcode/modal';

export interface SimulationRequest {
  id: number;
  moves: Move[];
  config: StockConfig;
}

export interface SimulationResponse {
  id: number;
  simulation: SerializedStockSimulation;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
  postMessage(message: SimulationResponse): void;
};

scope.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const { id, moves, config } = event.data;
  const simulation = simulateStock({ moves }, config);
  scope.postMessage({
    id,
    simulation: serializeStockSimulation(simulation, moves),
  });
};
