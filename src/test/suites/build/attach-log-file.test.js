// Build-layer tests for src/utils/attach-log-file.js — tee process.stdout/stderr to a file
// with ANSI stripping. Each test attaches, writes, detaches, then inspects the file.
//
// CRITICAL: these tests run INSIDE a live `npx mgr test` process whose own output is being
// teed to logs/test.log by the singleton. So they must NOT touch the singleton — exercising
// attach()/detach() on it would detach the live tee mid-run and truncate logs/test.log. Each
// test uses its OWN `createTee()` instance, which stacks under the live singleton tee and
// restores it cleanly on detach.

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
        ctx.expect(typeof mod.createTee).toBe('function');
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
        // Isolated instance — stacks under the live test.log tee, never clobbers it.
        const tee = attach.createTee();
        const tmpPath = path.join(os.tmpdir(), `em-log-${Date.now()}.log`);
        try {
          const stream = tee.attach(tmpPath);
          process.stdout.write('hello world\n');
          process.stdout.write('\x1B[31mcolored\x1B[0m line\n');
          // Wait for stream to flush before detaching + reading.
          await new Promise((resolve) => stream.write('', resolve));
          tee.detach();
          // detach() ends the stream; wait for the close event.
          await new Promise((resolve) => stream.on('close', resolve));

          const contents = fs.readFileSync(tmpPath, 'utf8');
          ctx.expect(contents).toContain('hello world');
          ctx.expect(contents).toContain('colored line');
          ctx.expect(contents).not.toContain('\x1B[');
        } finally {
          tee.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'idempotent: attaching twice with same path returns same stream',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tee = attach.createTee();
        const tmpPath = path.join(os.tmpdir(), `em-log-idem-${Date.now()}.log`);
        try {
          const s1 = tee.attach(tmpPath);
          const s2 = tee.attach(tmpPath);
          ctx.expect(s1).toBe(s2);
        } finally {
          tee.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'attach with falsy path returns null and does nothing',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tee = attach.createTee();
        ctx.expect(tee.attach(null)).toBe(null);
        ctx.expect(tee.attach('')).toBe(null);
      },
    },
  ],
};
