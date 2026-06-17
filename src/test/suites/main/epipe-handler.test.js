module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'EPIPE handler (main)',
  tests: [
    {
      name: 'EPIPE errors call process.exit(0) instead of cascading',
      run: (ctx) => {
        const origExit = process.exit;
        let exitCode = null;
        process.exit = (code) => { exitCode = code; };
        try {
          const err = new Error('write EPIPE');
          err.code = 'EPIPE';
          process.emit('uncaughtException', err);
          ctx.expect(exitCode).toBe(0);
        } finally {
          process.exit = origExit;
        }
      },
    },
    {
      name: 'non-EPIPE errors are logged, not silently exited',
      run: (ctx) => {
        const origExit = process.exit;
        let exitCode = null;
        process.exit = (code) => { exitCode = code; };
        try {
          const err = new Error('something broke');
          err.code = 'ERR_SOMETHING';
          process.emit('uncaughtException', err);
          ctx.expect(exitCode).toBe(null);
        } finally {
          process.exit = origExit;
        }
      },
    },
  ],
};
