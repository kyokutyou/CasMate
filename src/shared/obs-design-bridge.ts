import type { Target } from './obs-style';
export interface ObsDesignBridge {
  onTarget(listener: (target: Target) => void): () => void;
  onCloseRequest(listener: () => void): () => void;
  closeReady(): void;
}
declare global { interface Window { casmateObsDesign?: ObsDesignBridge } }
