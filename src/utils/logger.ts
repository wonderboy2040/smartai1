export enum Market {
  IN = 'IN',
  US = 'US',
}

export class Logger {
  static warn(message: string, error?: any) {
    console.warn(`[MindAdvance-Warn] ${message}`, error || '');
  }
  static error(message: string, error?: any) {
    console.error(`[MindAdvance-Error] ${message}`, error || '');
  }
  static info(message: string) {
    console.log(`[MindAdvance-Info] ${message}`);
  }
}
