// Test fixture: main module that imports from utils
import { add, multiply } from './utils';
import { Logger } from './logger';

export function calculateTotal(items: number[]): number {
  const logger = new Logger('calculator');
  const sum = items.reduce((acc, item) => add(acc, item), 0);
  logger.log(`Total: ${sum}`);
  return sum;
}

export function calculateProduct(items: number[]): number {
  return items.reduce((acc, item) => multiply(acc, item), 1);
}

export class Calculator {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('calc-instance');
  }

  sum(a: number, b: number): number {
    const result = add(a, b);
    this.logger.log(`${a} + ${b} = ${result}`);
    return result;
  }
}
