// Main-process tests for the harness CDP endpoint: test/harness/main-entry.js
// appends --remote-debugging-port=0 at require time and publishes the resolved
// port as process.env.EM_CDP_PORT before suites run — so consumer suites can
// drive real browser automation (playwright-core connectOverCDP) against the
// harness Electron itself.

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'harness CDP endpoint (main)',
  tests: [
    {
      name: 'remote-debugging-port switch is set on the harness',
      run: (ctx) => {
        const { app } = require('electron');
        ctx.expect(app.commandLine.hasSwitch('remote-debugging-port')).toBe(true);
      },
    },
    {
      name: 'EM_CDP_PORT is published with the resolved (non-zero) port',
      run: (ctx) => {
        const port = Number(process.env.EM_CDP_PORT);
        ctx.expect(Number.isInteger(port)).toBe(true);
        ctx.expect(port > 0).toBe(true);
        ctx.state.port = port;
      },
    },
    {
      name: 'the endpoint is live — /json/version serves a webSocketDebuggerUrl',
      run: async (ctx) => {
        const http = require('http');
        const body = await new Promise((resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port: ctx.state.port, path: '/json/version' }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.setTimeout(5000, () => { req.destroy(new Error('timed out')); });
        });
        const json = JSON.parse(body);
        ctx.expect(typeof json.webSocketDebuggerUrl).toBe('string');
        ctx.expect(json.webSocketDebuggerUrl.startsWith('ws://')).toBe(true);
      },
    },
  ],
};
