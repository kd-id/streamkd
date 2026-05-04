const fs = require('fs');
const path = require('path');
const util = require('util');
const logDir = path.join(__dirname, '..', 'logs');
const logFilePath = path.join(logDir, 'app.log');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;
const nonFatalConsoleErrorCodes = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

function isNonFatalConsoleError(err) {
  return err && nonFatalConsoleErrorCodes.has(err.code);
}

function safeConsoleWrite(writer, args) {
  try {
    writer.apply(console, args);
  } catch (err) {
    if (!isNonFatalConsoleError(err)) {
      try {
        fs.appendFileSync(
          logFilePath,
          `${new Date().toISOString()} [ERROR] Console write failed: ${util.inspect(err, { depth: null, colors: false })}\n`
        );
      } catch (_) {
        // Logging must never crash the application.
      }
    }
  }
}

function ignoreBrokenPipe(stream) {
  if (!stream || typeof stream.on !== 'function') return;

  stream.on('error', (err) => {
    if (!isNonFatalConsoleError(err)) {
      try {
        fs.appendFileSync(
          logFilePath,
          `${new Date().toISOString()} [ERROR] Console stream error: ${util.inspect(err, { depth: null, colors: false })}\n`
        );
      } catch (_) {
        // Logging must never crash the application.
      }
    }
  });
}

function writeToLogFile(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => typeof arg === 'string' ? arg : util.inspect(arg, { depth: null, colors: false })).join(' ');
  const logEntry = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logEntry);
  } catch (err) {
    safeConsoleWrite(originalConsoleError, ['Failed to write to log file:', err]);
  }
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

console.log = (...args) => {
  writeToLogFile('log', ...args);
  safeConsoleWrite(originalConsoleLog, args);
};
console.error = (...args) => {
  writeToLogFile('error', ...args);
  safeConsoleWrite(originalConsoleError, args);
};
console.warn = (...args) => {
  writeToLogFile('warn', ...args);
  safeConsoleWrite(originalConsoleWarn, args);
};
console.info = (...args) => {
  writeToLogFile('info', ...args);
  safeConsoleWrite(originalConsoleInfo, args);
};
console.debug = (...args) => {
  writeToLogFile('debug', ...args);
  safeConsoleWrite(originalConsoleDebug, args);
};
console.log('Logger initialized. Output will be written to console and logs/app.log');
