const chalk = require('chalk');
// const package = require('../../package.json');
// const builder = require('../../electron-builder.json');
const cp = require('child_process');
// const argv = require('yargs').argv;
// const platform = require('os').platform();
// let buildFile;
// try {
//   buildFile = require('./build.js');
// } catch (e) {
//
// }
//
// const publish = !!argv.publish;
// const devMode = !!argv.dev || !!argv.devmode;
// const platformCode = argv.platform === 'win' ? '-w' : (argv.platform === 'mac' ? '-m' : '-l');
// if (!argv.platform) {
//   throw new Error('No platform specified!');
// }

function BuildScript() {

}

BuildScript.prototype.build = async function (options) {
  let caughtError = false;
  const platformCode = options.platform === 'win' ? '-w' : (options.platform === 'mac' ? '-m' : '-l');

  console.log(chalk.blue(`
  \n\n\n\n\n
  --------------------------
  Project v${options.package.version} is being built ${options.publish ? 'and published ' : ''}on ${options.platform}!
  --------------------------
  `));

  if (options.buildFile) {
    await buildFile();
  }

  function _logError(e) {
    console.error(chalk.red('Error executing command:', typeof e === 'string' ? e : e.toString()));
  }

  // await asyncCmd('pwd')
  //   .catch(err => {
  //     caughtError = err;
  //   })

  if (platformCode === '-m') {
    await asyncCmd('xattr', ['-cr', '*'])
      .catch(err => {
        // caughtError = err;
      })
    await asyncCmd('rm', ['-r', '~/Library/Caches/com.apple.amp.itmstransporter/UploadTokens'])
      .catch(err => {
        // caughtError = err;
      })
    if (caughtError) { return; }
  }

  await asyncCmd('npm', ['install'])
  // await asyncCmd('npm', ['ci'])
    .catch(err => {
      // caughtError = err;
    })
  if (caughtError) { return; }

  // APPX build
  if (options.platform === 'appx') {
    await asyncCmd('electron-builder', ['-w', 'appx'])
      .catch(err => {
        caughtError = err;
      })
    if (caughtError) { return; }
  } else if (options.platform === 'snap') {
    await asyncCmd('electron-builder', ['--linux', 'snap'].concat(options.publish ? ['-p', 'always'] : []).concat(devMode ? ['-c.snap.confinement=devmode'] : []))
      .catch(err => {
        caughtError = err;
      })
    if (caughtError) { return; }
  } else {
    await asyncCmd('electron-builder', [platformCode].concat(options.publish ? ['-p', 'always'] : []))
      .catch(err => {
        caughtError = err;
      })
    if (caughtError) { return; }
  }

  console.log(chalk.blue(`
  \n\n\n\n\n
  --------------------------
  Project v${options.package.version} has been built ${options.publish ? 'and published ' : ''}on ${options.platform}!
  --------------------------
  ** The build:post process needs to be executed in the root of this project (OUTSIDE DOCKER) **
    - npx em build:post

  `));


};

module.exports = BuildScript;


// (async function() {
//
// }());

function asyncCmd(command, args) {
  return new Promise(function(resolve, reject) {
    const full = `${command} ${(args || []).join(' ')}`;

    console.log('Executing:', full, command, args);
    // const ls = cp.spawn(command, args);
    const ls = cp.exec(full);

    ls.stdout.on('data', (data) => {
      console.log(`${data}`.replace('\n', ''));
    });

    ls.stderr.on('data', (data) => {
      console.error(chalk.red(`stderr: ${data}`));
      return reject(data);
    });

    ls.on('close', (code) => {
      console.log(chalk.green(`child process for command="${full}" exited with code ${code}`));
      return resolve(code);
    });
  });
}
