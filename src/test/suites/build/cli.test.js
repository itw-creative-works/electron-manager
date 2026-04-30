// CLI structure tests — every alias has a command file, every command file is a function, bin is executable.

const path = require('path');
const fs = require('fs');

const Manager = require('../../../build.js');
const root = Manager.getRootPath('main');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'CLI',
  tests: [
    {
      name: 'every alias has a corresponding command file',
      run: (ctx) => {
        const cliSrc = fs.readFileSync(path.join(root, 'dist', 'cli.js'), 'utf8');
        const aliasMatch = cliSrc.match(/const ALIASES = \{([\s\S]*?)\};/);
        if (!aliasMatch) throw new Error('Could not parse ALIASES block from dist/cli.js');

        const commands = [];
        for (const line of aliasMatch[1].split('\n')) {
          const m = line.match(/^\s*['"]?([a-z-]+)['"]?:/);
          if (m) commands.push(m[1]);
        }

        ctx.expect(commands.length).toBeGreaterThan(0);

        for (const cmd of commands) {
          const file = path.join(root, 'dist', 'commands', `${cmd}.js`);
          if (!fs.existsSync(file)) {
            throw new Error(`Command "${cmd}" registered in ALIASES but no dist/commands/${cmd}.js exists.`);
          }
        }
      },
    },
    {
      name: 'every command file exports a function',
      run: (ctx) => {
        const cmdDir = path.join(root, 'dist', 'commands');
        const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'));
        ctx.expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
          const fn = require(path.join(cmdDir, file));
          if (typeof fn !== 'function') {
            throw new Error(`commands/${file} does not export a function`);
          }
        }
      },
    },
    {
      name: 'bin/electron-manager exists and is executable',
      run: (ctx) => {
        const binFile = path.join(root, 'bin', 'electron-manager');
        ctx.expect(fs.existsSync(binFile)).toBeTruthy();
        const stat = fs.statSync(binFile);
        ctx.expect((stat.mode & 0o100) !== 0).toBeTruthy();
      },
    },
  ],
};
