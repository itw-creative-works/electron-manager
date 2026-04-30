// Build-layer tests for src/utils/github.js — discoverRepo logic.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'utils/github — repo discovery + octokit factory',
  tests: [
    {
      name: 'github utils module exports the expected surface',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        ctx.expect(typeof mod.discoverRepo).toBe('function');
        ctx.expect(typeof mod.getOctokit).toBe('function');
        ctx.expect(typeof mod.ensureRepo).toBe('function');
      },
    },
    {
      name: 'discoverRepo parses package.json repository.url (object form)',
      run: async (ctx) => {
        const { discoverRepo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-gh-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
          name: 'foo',
          repository: { type: 'git', url: 'https://github.com/myorg/myrepo.git' },
        }));
        try {
          const result = await discoverRepo(tmp);
          ctx.expect(result.owner).toBe('myorg');
          ctx.expect(result.repo).toBe('myrepo');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo parses package.json repository.url (string form)',
      run: async (ctx) => {
        const { discoverRepo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-gh-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
          name: 'foo',
          repository: 'github.com/another/proj',
        }));
        try {
          const result = await discoverRepo(tmp);
          ctx.expect(result.owner).toBe('another');
          ctx.expect(result.repo).toBe('proj');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo strips trailing .git from repo name',
      run: async (ctx) => {
        const { discoverRepo } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-gh-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
          repository: { url: 'git+https://github.com/owner/repo.git' },
        }));
        try {
          const result = await discoverRepo(tmp);
          ctx.expect(result.owner).toBe('owner');
          ctx.expect(result.repo).toBe('repo');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'getOctokit returns null when GH_TOKEN missing',
      run: (ctx) => {
        const { getOctokit } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const orig = process.env.GH_TOKEN;
        delete process.env.GH_TOKEN;
        try {
          ctx.expect(getOctokit()).toBe(null);
        } finally {
          if (orig !== undefined) process.env.GH_TOKEN = orig;
        }
      },
    },
    {
      name: 'getOctokit returns a client when GH_TOKEN set',
      run: (ctx) => {
        const { getOctokit } = require(path.join(__dirname, '..', '..', '..', 'utils', 'github.js'));
        const orig = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_fake_token_for_unit_test';
        try {
          const client = getOctokit();
          ctx.expect(client).toBeDefined();
          ctx.expect(typeof client.rest).toBe('object');
        } finally {
          if (orig !== undefined) process.env.GH_TOKEN = orig;
          else delete process.env.GH_TOKEN;
        }
      },
    },
  ],
};
