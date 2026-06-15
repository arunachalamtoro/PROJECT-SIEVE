// Test fixture: types file
import type { MathOperation } from './utils';

export interface Config {
  name: string;
  debug: boolean;
}

export type Handler = (config: Config) => void;

export interface Service {
  start(): void;
  stop(): void;
}
