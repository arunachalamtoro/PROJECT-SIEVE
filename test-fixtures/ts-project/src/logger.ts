// Test fixture: Logger class
export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  log(message: string): void {
    console.log(`[${this.prefix}] ${message}`);
  }

  error(message: string): void {
    console.error(`[${this.prefix}] ERROR: ${message}`);
  }
}

export class FileLogger extends Logger {
  private filePath: string;

  constructor(prefix: string, filePath: string) {
    super(prefix);
    this.filePath = filePath;
  }

  writeToFile(message: string): void {
    // Simulated file write
    this.log(`Writing to ${this.filePath}: ${message}`);
  }
}
