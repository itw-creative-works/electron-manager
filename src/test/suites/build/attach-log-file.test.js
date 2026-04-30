// Build-layer tests for src/utils/attach-log-file.js — tee process.stdout/stderr to a file
// with ANSI stripping. Each test attaches, writes, detaches, then inspects the file.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'attach-log-file — tee stdout/stderr to a file',
  tests: [
    {
      name: 'exports the expected surface',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(typeof mod.detach).toBe('function');
        ctx.expect(typeof mod.stripAnsi).toBe('function');
      },
    },
    {
      name: 'stripAnsi removes color escape codes',
      run: (ctx) => {
        const { stripAnsi } = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const colored = '\x1B[31mred\x1B[0m and \x1B[32mgreen\x1B[0m';
        ctx.expect(stripAnsi(colored)).toBe('red and green');
      },
    },
    {
      name: 'attach + stdout.write + detach: file contains the writes',
      run: async (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tmpPath = path.join(os.tmpdir(), `em-log-${Date.now()}.log`);
        try {
          const stream = attach(tmpPath);
          process.stdout.write('hello world\n');
          process.stdout.write('\x1B[31mcolored\x1B[0m line\n');
          // Wait for stream to flush before detaching + reading.
          await new Promise((resolve) => stream.write('', resolve));
          attach.detach();
          // detach() ends the stream; wait for the close event.
          await new Promise((resolve) => stream.on('close', resolve));

          const contents = fs.readFileSync(tmpPath, 'utf8');
          ctx.expect(contents).toContain('hello world');
          ctx.expect(contents).toContain('colored line');
          ctx.expect(contents).not.toContain('\x1B[');
        } finally {
          attach.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'idempotent: attaching twice with same path returns same stream',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tmpPath = path.join(os.tmpdir(), `em-log-idem-${Date.now()}.log`);
        try {
          const s1 = attach(tmpPath);
          const s2 = attach(tmpPath);
          ctx.expect(s1).toBe(s2);
        } finally {
          attach.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'attach with falsy path returns null and does nothing',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        ctx.expect(attach(null)).toBe(null);
        ctx.expect(attach('')).toBe(null);
      },
    },
  ],
};
