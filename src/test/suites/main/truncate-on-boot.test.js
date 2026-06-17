module.exports = {
  layer: 'main',
  description: 'runtime.log truncates on boot',
  run: (ctx) => {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'logs', 'runtime.log');

    fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
    fs.writeFileSync(logPath, 'STALE DATA FROM PREVIOUS RUN\n');
    ctx.expect(fs.readFileSync(logPath, 'utf8')).toContain('STALE DATA');

    const { app } = require('electron');
    const _logPath = app.isPackaged
      ? path.join(app.getPath('logs'), 'runtime.log')
      : path.join(process.cwd(), 'logs', 'runtime.log');
    fs.writeFileSync(_logPath, '');

    ctx.expect(fs.readFileSync(logPath, 'utf8')).toBe('');
  },
};
