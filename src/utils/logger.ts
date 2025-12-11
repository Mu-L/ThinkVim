import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARNING = 3,
  ERROR = 4
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export class Logger {
  private logLevel: LogLevel;
  private colorized: boolean;
  private saveToFile: boolean;
  private logFilePath: string;

  constructor(
    logLevel: LogLevel = LogLevel.INFO,
    colorized: boolean = true,
    saveToFile: boolean = true
  ) {
    this.logLevel = logLevel;
    this.colorized = colorized;
    this.saveToFile = saveToFile;
    
    // Create logs directory
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Set log file path with date
    const dateStr = new Date().toISOString().split('T')[0];
    this.logFilePath = path.join(logsDir, `bot-${dateStr}.log`);
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      formatted += '\n' + JSON.stringify(data, null, 2);
    }
    
    return formatted;
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.saveToFile) return;
    
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFilePath, line);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  debug(message: string, data?: any): void {
    if (this.logLevel > LogLevel.DEBUG) return;
    
    const formatted = this.formatMessage('DEBUG', message, data);
    if (this.colorized) {
      console.log(chalk.gray(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      message,
      data
    });
  }

  info(message: string, data?: any): void {
    if (this.logLevel > LogLevel.INFO) return;
    
    const formatted = this.formatMessage('INFO', message, data);
    if (this.colorized) {
      console.log(chalk.blue(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      data
    });
  }

  success(message: string, data?: any): void {
    if (this.logLevel > LogLevel.SUCCESS) return;
    
    const formatted = this.formatMessage('SUCCESS', message, data);
    if (this.colorized) {
      console.log(chalk.green(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: 'SUCCESS',
      message,
      data
    });
  }

  warning(message: string, data?: any): void {
    if (this.logLevel > LogLevel.WARNING) return;
    
    const formatted = this.formatMessage('WARNING', message, data);
    if (this.colorized) {
      console.log(chalk.yellow(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: 'WARNING',
      message,
      data
    });
  }

  error(message: string, error?: any): void {
    if (this.logLevel > LogLevel.ERROR) return;
    
    const formatted = this.formatMessage('ERROR', message, error);
    if (this.colorized) {
      console.log(chalk.red(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      data: error
    });
  }

  trade(action: 'BUY' | 'SELL', token: string, amount: string, hash: string, data?: any): void {
    const message = `${action} ${amount} of ${token} | TX: ${hash}`;
    const formatted = this.formatMessage(action, message, data);
    
    if (this.colorized) {
      const color = action === 'BUY' ? chalk.greenBright : chalk.redBright;
      console.log(color.bold(formatted));
    } else {
      console.log(formatted);
    }
    
    this.writeToFile({
      timestamp: new Date().toISOString(),
      level: action,
      message,
      data: {
        ...data,
        token,
        amount,
        hash
      }
    });
  }

  banner(): void {
    const banner = `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🎯 Four.Meme BSC Token Sniper Bot v1.0            ║
║                                                           ║
║        ⚠️  HIGH RISK - USE AT YOUR OWN RISK  ⚠️          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `;
    
    if (this.colorized) {
      console.log(chalk.cyan(banner));
    } else {
      console.log(banner);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
