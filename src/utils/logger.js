import pino from 'pino';

/**
 * Factory function untuk membuat logger instance per module.
 * Menggunakan Pino untuk performa tinggi (penting karena bot real-time).
 *
 * @param {string} name - Nama module (akan muncul di log)
 * @param {string} [levelOverride] - Override log level
 * @returns {import('pino').Logger}
 */
export function createLogger(name, levelOverride) {
  return pino({
    name,
    level: levelOverride || process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
}
