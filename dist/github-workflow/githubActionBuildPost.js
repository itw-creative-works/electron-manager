const path = require('path')
const Manager = new (require(path.resolve(process.cwd(), 'node_modules', 'electron-manager')))();
const chalk = Manager.require('chalk');
const fetch = Manager.require('wonderful-fetch')
const jetpack = Manager.require('fs-jetpack');
const {get, set} = Manager.require('lodash');
const { Octokit } = Manager.require('@octokit/rest');
const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
});

const packageJSON = require(path.join(process.cwd(), 'package.json'));
const electronManagerConfig = require(path.join(process.cwd(), 'electron-manager/config.json'));
const scriptName = '[githubActionBuildPost.js]';

exports.default = async function () {
  let caughtError;

  console.log(chalk.green(`\n*-*-*- Post-build: Starting for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));
  
  // Register CI server listener
  // const serverListener = process_registerListener().catch(e => e)

  // Send request to CI server
  await process_sendRequestToCI()
  .catch(e => caughtError = e)
  if (caughtError) { return error(caughtError) }

  // Build hashes
  await process_buildHashes()
  .catch(e => caughtError = e)
  if (caughtError) { return error(caughtError) }

  // TODO: Download releases and update installer
  // REMOVE THIS PROCESS FROM THE CI Server
  // NEED to do the following...
  // - setup serverListener in beginning of this function
  // - wait for ALL platforms are completely done on CI server (for now just windows)
  // - then, download all releases from update-server and put them on installer (just like CI server)

  console.log(chalk.green(`*-*-*- Post-build: Complete for ${packageJSON.productName} v${packageJSON.version} -*-*-*`));

};

// Run if called from command line
if (require.main == module) {
  exports.default()
}

function process_registerListener() {
  return new Promise(function(resolve, reject) {
    
  });
}

function process_sendRequestToCI() {
  return new Promise(async function(resolve, reject) {
    const runId = parseInt(process.env.GITHUB_RUN_ID);
    const docPath = `ci-builds/${runId}`;
    const now = new Date();

    if (!runId) {
      return reject(new Error('Missing GITHUB_RUN_ID'))
    }

    console.log(chalk.blue(scriptName, `Sending request to CI server (${chalk.bold(docPath)})...`));

    await fetch('https://us-central1-itw-creative-works.cloudfunctions.net/bm_api', {
      method: 'post',
      body: {
        backendManagerKey: process.env.BACKEND_MANAGER_KEY,
        command: 'admin:firestore-write',
        payload: {
          path: docPath,
          document: {
            package: require(path.join(process.cwd(), 'package.json')),
            status: {
              windows: {
                complete: false,
                error: null,
              },
              // mac: {
              //   complete: false,
              //   error: null,
              // },     
              // linux: {
              //   complete: false,
              //   error: null,
              // },                   
            },          
            date: {
              timestamp: now.toISOString(),
              timestampUNIX: Math.round(now.getTime() / 1000),
            },
            id: runId,
          }
        }
      }    
    })
    .then(r => {
      console.log(chalk.green(scriptName, `Sent request to CI server`));
      return resolve(r)
    })
    .catch(e => reject(e))    
  });  
}

function process_buildHashes() {
  return new Promise(async function(resolve, reject) {
    const Hash = Manager.require(path.join(process.cwd(), 'node_modules/electron-manager/dist/libraries/hash.js'));
    const emHashConfig = get(electronManagerConfig, 'build.hash', {});
   
    if (emHashConfig.repository) {
      emHashConfig.output = emHashConfig.output || 'data/resources/hashes';
      emHashConfig.output = path.join(emHashConfig.output, `${packageJSON.version}.json`)
        .replace(/^\/|^\.\//, '');

      const hashed = await Hash.build(emHashConfig);

      const buff = Buffer.from(JSON.stringify(hashed, null, 2));
      const base64data = buff.toString('base64');

      const repoSplit = emHashConfig.repository.split('/');
      const owner = repoSplit[repoSplit.length - 2];
      const repo = repoSplit[repoSplit.length - 1]; 
      
      // Get and update content
      const existingSha = await octokit.rest.repos.getContent({
        owner: owner,
        repo: repo,
        path: emHashConfig.output,
      })
      .then(content => {
        return get(content, 'data.sha');
      })
      .catch(e => e);

      if (existingSha instanceof Error) {
        if (existingSha.status === 404) {
          console.log(chalk.blue(scriptName, `Creating new hash file because there is none existing`));
        } else {
          return reject(existingSha);
        }
      } else {
        console.log(chalk.blue(scriptName, `Overwriting existing hashes with sha ${existingSha}`));
      }

      octokit.repos.createOrUpdateFileContents({
        // replace the owner and email with your own details
        owner: owner,
        repo: repo,
        path: emHashConfig.output,
        message: `Post-build script: ${new Date().toISOString()}`,
        content: base64data,
        sha: existingSha,
        committer: {
          name: `Post-build script`,
          email: 'hello@itwcreativeworks.com',
        },
        author: {
          name: "Post-build script",
          email: 'hello@itwcreativeworks.com',
        },
      })
      .then(r => {
        console.log(chalk.green(scriptName, `Saved hashes (${chalk.bold(Object.keys(hashed).length + ' files')}) to: ${emHashConfig.repository} @ ${emHashConfig.output}`));
        return resolve(r)
      })
      .catch(e => reject(e))        
   

    } else {
      console.log(chalk.yellow(scriptName, `Skipping hashes`));
      return resolve();
    }

  });
}

// Log error
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));
  throw new Error(e)
}
