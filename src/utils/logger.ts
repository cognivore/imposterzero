import fs from 'fs';
import path from 'path';

export class Logger {
  private logFile: string;
  private logStream: fs.WriteStream;

  constructor(logFileName: string = 'imposter-kings-debug.log') {
    this.logFile = path.join(process.cwd(), logFileName);
    this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });

    // Log session start
    this.log('='.repeat(80));
    this.log(`NEW SESSION STARTED: ${new Date().toISOString()}`);
    this.log('='.repeat(80));
  }

  log(message: string, level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN' = 'INFO'): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;

    // Write to file
    this.logStream.write(logLine + '\n');

    // Also log to console for debugging
    console.log(`[LOG] ${logLine}`);
  }

  error(message: string, error?: Error): void {
    this.log(`ERROR: ${message}`, 'ERROR');
    if (error) {
      this.log(`ERROR STACK: ${error.stack}`, 'ERROR');
    }
  }

  debug(message: string, data?: any): void {
    this.log(`DEBUG: ${message}`, 'DEBUG');
    if (data) {
      this.log(`DEBUG DATA: ${JSON.stringify(data, null, 2)}`, 'DEBUG');
    }
  }

  warn(message: string): void {
    this.log(`WARN: ${message}`, 'WARN');
  }

  close(): void {
    this.log('='.repeat(80));
    this.log(`SESSION ENDED: ${new Date().toISOString()}`);
    this.log('='.repeat(80));
    this.logStream.end();
  }
}
