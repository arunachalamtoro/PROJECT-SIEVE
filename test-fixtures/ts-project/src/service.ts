// Test fixture: module that imports from types and uses Logger
import type { Config, Service } from './types';
import { Logger } from './logger';

export class AppService implements Service {
  private config: Config;
  private logger: Logger;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger(config.name);
  }

  start(): void {
    this.logger.log('Service starting...');
  }

  stop(): void {
    this.logger.log('Service stopping...');
  }
}
