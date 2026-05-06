// webpack — three configs (main / preload / renderer), compiled in parallel.
// Each target gets `EM_BUILD_JSON` injected via DefinePlugin.

const Manager = new (require('../../build.js'));
const logger = Manager.logger('webpack');
const path = require('path');
const glob = require('glob').globSync;
const webpack = require('webpack');
const jetpack = require('fs-jetpack');

const projectRoot = Manager.getRootPath('project');

module.exports = function webpackTask(done) {
  const mode = Manager.getMode();
  const isProd = mode.environment === 'production';
  const config = Manager.getConfig();

  // EM_BUILD_JSON — frozen at build time, accessible at runtime as window/globalThis.EM_BUILD_JSON.
  const buildJson = {
    config,
    package: Manager.getPackage('project'),
    mode,
    builtAt: new Date().toISOString(),
  };

  logger.log(`webpack — environment=${mode.environment}`);

  const configs = [
    makeMainConfig(buildJson, isProd),
    makePreloadConfig(buildJson, isProd),
    makeRendererConfig(buildJson, isProd),
  ].filter(Boolean);

  if (configs.length === 0) {
    logger.warn('No webpack configs to run.');
    return done();
  }

  webpack(configs, (err, stats) => {
    if (err) {
      logger.error('webpack fatal:', err);
      return done(err);
    }

    const info = stats.toJson({ errors: true, warnings: true, assets: true, modules: false });

    if (info.errors?.length) {
      info.errors.forEach((e) => logger.error(e.message || e));
      return done(new Error('webpack errors'));
    }

    if (info.warnings?.length) {
      info.warnings.forEach((w) => logger.warn(w.message || w));
    }

    // Log assets per child compilation
    (info.children || [info]).forEach((child) => {
      const target = child.name || child.outputPath;
      logger.log(`built ${target}:`);
      (child.assets || []).forEach((a) => {
        logger.log(`  ${a.name} (${formatBytes(a.size)})`);
      });
    });

    done();
  });
};

// Inject EM_BUILD_JSON into every bundle two ways:
// 1. DefinePlugin replaces the bare `EM_BUILD_JSON` identifier with the literal at build time
//    (so framework code can reference it without globals).
// 2. BannerPlugin prepends a tiny IIFE that assigns the same value to globalThis.EM_BUILD_JSON
//    (so it's reachable from DevTools and consumer code via window.EM_BUILD_JSON).
function buildJsonPlugins(buildJson) {
  const literal = JSON.stringify(buildJson);
  return [
    new webpack.DefinePlugin({
      EM_BUILD_JSON: literal,
    }),
    new webpack.BannerPlugin({
      banner: `(function(){var __em=${literal};if(typeof globalThis!=='undefined'){globalThis.EM_BUILD_JSON=__em;}if(typeof window!=='undefined'){window.EM_BUILD_JSON=__em;}})();`,
      raw:    true,
      entryOnly: true,
    }),
  ];
}

function makeMainConfig(buildJson, isProd) {
  const entry = path.join(projectRoot, 'src', 'main.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/main.js in consumer — skipping main bundle.');
    return null;
  }

  return {
    name:    'main',
    target:  'electron-main',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    output: {
      path:     path.join(projectRoot, 'dist'),
      filename: 'main.bundle.js',
      libraryTarget: 'commonjs2',
      module:   false,
    },
    node: {
      __dirname:  false,
      __filename: false,
    },
    externals: {
      electron: 'commonjs2 electron',
      // electron-store is ESM-only and loaded via dynamic import via the path resolved by Node's
      // require.resolve. Bundling it makes the resolve return a webpack contextual lookup, which
      // can't find the module at runtime. Stay external so Node resolves it from EM's installed
      // node_modules location (consumer must `npm i electron-store` — it's listed as a peer dep).
      'electron-store': 'commonjs2 electron-store',
      // Native modules — consumer can extend via config.em.webpack.externals
      ...resolveNativeExternals(),
    },
    plugins: buildJsonPlugins(buildJson),
    optimization: {
      minimize: isProd,
    },
  };
}

function makePreloadConfig(buildJson, isProd) {
  const entry = path.join(projectRoot, 'src', 'preload.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/preload.js in consumer — skipping preload bundle.');
    return null;
  }

  return {
    name:    'preload',
    target:  'electron-preload',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    output: {
      path:     path.join(projectRoot, 'dist'),
      filename: 'preload.bundle.js',
      libraryTarget: 'commonjs2',
      module:   false,
    },
    externals: {
      electron: 'commonjs2 electron',
    },
    plugins: buildJsonPlugins(buildJson),
    optimization: {
      minimize: isProd,
    },
  };
}

function makeRendererConfig(buildJson, isProd) {
  const componentsDir = path.join(projectRoot, 'src', 'assets', 'js', 'components');
  if (!jetpack.exists(componentsDir)) {
    logger.warn('No src/assets/js/components/ in consumer — skipping renderer bundles.');
    return null;
  }

  // One bundle per components/<name>/index.js
  const indexFiles = glob('*/index.js', { cwd: componentsDir });
  if (indexFiles.length === 0) {
    logger.warn('No component index.js entries found.');
    return null;
  }

  const entry = {};
  indexFiles.forEach((rel) => {
    const name = rel.replace(/\/index\.js$/, '');
    entry[name] = path.join(componentsDir, rel);
  });

  return {
    name:    'renderer',
    target:  'electron-renderer',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    output: {
      path:     path.join(projectRoot, 'dist', 'assets', 'js', 'components'),
      filename: '[name].bundle.js',
      module:   false,
    },
    plugins: buildJsonPlugins(buildJson),
    optimization: {
      minimize: isProd,
    },
  };
}

function resolveNativeExternals() {
  // Walk consumer's package.json for known native module names; mark them as commonjs externals
  // so electron-builder's afterPack rebuilds them out-of-bundle.
  const consumerPkg = Manager.getPackage('project');
  const all = Object.assign({}, consumerPkg.dependencies || {}, consumerPkg.devDependencies || {});

  // Conservative whitelist of *truly native* (C++) modules that need electron-builder's
  // afterPack to rebuild them out-of-bundle. electron-store is pure JS (ESM) so it bundles fine.
  // Consumer can extend via config.em.webpack.externals.
  const NATIVE = [
    'better-sqlite3',
    'keytar',
    'node-mac-permissions',
    'node-notifier',
    'sharp',
    'sqlite3',
  ];

  const externals = {};
  Object.keys(all).forEach((name) => {
    if (NATIVE.includes(name)) {
      externals[name] = `commonjs2 ${name}`;
    }
  });

  // Consumer-defined extras
  const config = Manager.getConfig();
  const extra = config?.em?.webpack?.externals || [];
  extra.forEach((name) => {
    externals[name] = `commonjs2 ${name}`;
  });

  return externals;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}
