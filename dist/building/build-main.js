const chalk = require('chalk');
const powertools = require('node-powertools');
const {get} = require('lodash');
const { Octokit } = require('@octokit/rest');
const moment = require('moment');
const fetch = require('wonderful-fetch');
const jetpack = require('fs-jetpack');
const os = require('os');
const path = require('path');

const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
});
const scriptName = '[build-main.js]';

const startTime = moment();
let activeRun;
let owner;
let repo;

function BuildScriptPost() {

}

BuildScriptPost.prototype.process = async function (options) {
  const self = this;
  let caughtError;

  // Log
  console.log(chalk.green(`*-*-*- Main-build Starting for ${options.package.productName} v${options.package.version} -*-*-*`));

  // Check for required environment variables
  if (!process.env.GH_TOKEN) {
    return error(new Error(`You need to set the GH_TOKEN environment variable`));
  } else if (!process.env.BACKEND_MANAGER_KEY) {
    return error(new Error(`You need to set the BACKEND_MANAGER_KEY environment variable`));
  }

  // Set environment variables
  process.env.ELECTRON_MANAGER_YEAR = process.env.ELECTRON_MANAGER_YEAR || new Date().getFullYear();

  // Get owner and repo
  const repoSplit = options.package.repository.split('/');
  owner = repoSplit[repoSplit.length - 2];
  repo = repoSplit[repoSplit.length - 1];

  // Handle options
  if (options.arguments.retrigger) {
    // Retrigger CI server if it failed
    caughtError = await process_retriggerCIServer(options.arguments.retrigger).catch(e => e)
    if (caughtError instanceof Error) {return error(caughtError)}
  } else if (options.arguments.local) {
    // Run local build
    caughtError = await process_runLocalBuild().catch(e => e)
    if (caughtError instanceof Error) {return error(caughtError)}

    return await beep();
  } else {
    // Check to make sure everything is sync'd
    caughtError = await process_checkUncomitted().catch(e => e)
    if (caughtError instanceof Error) {return error(caughtError)}

    // Check for invalid defaults
    caughtError = await process_checkInvalidDefaults(options).catch(e => e)
    if (caughtError instanceof Error) {return error(caughtError)}

    // Start workflow
    caughtError = await process_startWorkflow().catch(e => e)
    if (caughtError instanceof Error) {return error(caughtError)}

    // Just wait cause this shit is anoying
    console.log(chalk.blue(scriptName, `Stalling so workflow can queue...`));
    await powertools.poll(async (i) => {
      console.log(chalk.yellow(scriptName, `Stalling so workflow can queue - ${getElapsed()}`));
    }, {interval: 5000, timeout: 30000})
    .catch(e => e)

    // Actually wait for workflow to finish queueing
    caughtError = await process_waitForWorkflowStart().catch(e => e);
    if (caughtError instanceof Error) {return error(caughtError)}

    // Wait for workflow to finish
    caughtError = await process_waitForWorkflowComplete().catch(e => e);
    if (caughtError instanceof Error) {return error(caughtError)}

    // Report status
    if (activeRun.conclusion === 'failure') {
      await process_getWorkflowRunLogs(options).catch(e => e);

      // Log URL to the github website where the workflow is
      const workflowUrl = `https://github.com/${owner}/${repo}/actions/runs/${activeRun.id}`;
      console.log(chalk.yellow(scriptName, `View: ${workflowUrl}`));

      return error(new Error(`Workflow failed`));
    } else {
      console.log(chalk.green(scriptName, `Workflow ${activeRun.id} finished: created=${activeRun.created_at}, status=${activeRun.status}, conclusion=${activeRun.conclusion}`));
    }
  }

  // Wait for CI Server to finish
  caughtError = await process_waitForCIServerComplete().catch(e => e)
  if (caughtError instanceof Error) {return error(caughtError)}

  // Beep
  await beep();

  console.log(chalk.green(`*-*-*- Main-build Complete for ${options.package.productName} v${options.package.version} -*-*-*`));

};

module.exports = BuildScriptPost;

// Log error
function error(e) {
  console.log(chalk.red(scriptName, `${e.message}`));
  if (activeRun && activeRun.conclusion !== 'failure') {
    console.log('\n');
    console.log(chalk.yellow(scriptName, `You can retrigger this CI Server Build with: ${chalk.bold(`npx eman build --retrigger=${activeRun.id}`)}`));
  }
  throw new Error(e)
}

async function beep() {
  await powertools.execute('echo "\\a\\a\\a"').catch(e => e)
}


function process_checkUncomitted() {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Checking for uncommitted changes...`));

    powertools.execute('git status --porcelain')
    .then(async (uncommitted) => {
      if (uncommitted) {
        console.log(chalk.yellow(scriptName, `There are uncommitted changes that will not be included in your build... \n ${uncommitted}`));
        console.log(chalk.yellow(scriptName, `⛔️⛔️⛔️ Quit now if you need to commit your changes...`));
        await powertools.wait(5000);
      }

      return resolve();
    })
    .catch(e => reject(e))
  });
}

function process_checkInvalidDefaults(options) {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Checking for improper defaults...`));

    // https://github.com/itw-creative-works/electron-boilerplate

    // Reject if the package.json repository contains "electron-boilerplate"
    if (options.package.repository && options.package.repository.includes('electron-boilerplate')) {
      return reject(new Error(`The package.json repository contains "electron-boilerplate". Please update it to your own repository.`));
    }

    // Resolve otherwise
    return resolve();
  });
}

function process_runLocalBuild() {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Running local build...`));

    powertools.execute('npx electron-builder --mac --arm64', {log: true})
    .then(async (result) => {
      console.log(chalk.green(scriptName, `Local build successful`));
      return resolve()
    })
    .catch(e => reject(e))
  });
}

function process_startWorkflow() {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Starting workflow for owner=${owner}, repo=${repo}...`));

    octokit.rest.actions.createWorkflowDispatch({
      owner: owner,
      repo: repo,
      workflow_id: 'build.yml',
      ref: 'main',
    })
    .then(workflow => {
      console.log(chalk.green(scriptName, `Started workflow successfully`));
      return resolve(workflow)
    })
    .catch(e => reject(e))
  });
}

function process_waitForWorkflowStart() {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Waiting for workflow to start...`));

    powertools.poll(async (i) => {
      console.log(chalk.yellow(scriptName, `Waiting for workflow to start - ${getElapsed()}`));
      await octokit.rest.actions.listWorkflowRuns({
        owner: owner,
        repo: repo,
        workflow_id: 'build.yml',
      })
      .then((response) => {
        const runs = response?.data?.workflow_runs || [];

        // Loop through runs to find the active run
        runs.forEach(run => {
          // Wait until a run is started and not finished (which is the current run)
          if (!activeRun && !runs.conclusion) {
            activeRun = run;
          }
        });
      })
      return activeRun;
    }, {interval: 5000, timeout: 30000})
    .then(r => {
      console.log(chalk.green(scriptName, `Workflow ${activeRun.id} started: created=${activeRun.created_at}, status=${activeRun.status}, conclusion=${activeRun.conclusion}`));
      resolve(r)
    })
    .catch(e => reject(new Error(`Workflow did mot start successfully in time: ${e}`)))
  });
}

function process_waitForWorkflowComplete() {
  return new Promise(function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Waiting for workflow to finish...`));

    powertools.poll(async (i) => {
      let done = false;
      console.log(chalk.yellow(scriptName, `Waiting for workflow to finish - ${getElapsed()}`));
      await octokit.rest.actions.getWorkflowRun({
        owner: owner,
        repo: repo,
        run_id: activeRun.id,
      })
      .then((response) => {
        const run = response?.data || {};

        // Check if run is done
        if (!run.conclusion) {
          return
        }

        // Set done flag
        done = true;
        activeRun = run;
      })

      // Return done flag
      return done;
    }, {interval: 30000, timeout: 0})
    .then(r => {
      return resolve(activeRun)
    })
    .catch(e => reject(new Error(`Workflow did mot finish successfully in time: ${e}`)) )
  });
}

function process_getWorkflowRunLogs(options) {
  return new Promise(async function(resolve, reject) {
    // Log
    console.log(chalk.blue(scriptName, `Getting workflow run details...`));

    // Get logs
    await octokit.rest.actions.downloadWorkflowRunLogs({
      owner: owner,
      repo: repo,
      run_id: activeRun.id,
    })
    .then((response) => {
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(new Uint8Array(response.data));

      // Get the user's home directory
      const homeDir = os.homedir();

      // Construct the download path
      const fileName = `${options.package.productName}-${options.package.version}-workflow.zip`
        .replace(/ /g, '_');
      const downloadPath = path.join(homeDir, 'Downloads', fileName);

      // Save the zip file to user's downloads folder
      jetpack.write(downloadPath, buffer);

      // Log
      console.log(chalk.yellow(scriptName, `Workflow run details saved to ${downloadPath}`));

      // Resolve
      return resolve(details);
    })
    .catch(e => reject(e))
  });
}

function process_waitForCIServerComplete() {
  return new Promise(function(resolve, reject) {
    let caughtError;

    console.log(chalk.blue(scriptName, `Waiting for CI server to finish...`));

    powertools.poll(async (i) => {
      let done = false;

      if (caughtError) {
        return true
      }

      // console.log(chalk.yellow(scriptName, `Waiting for CI server to finish - ${getElapsed()}`));
      await fetch('https://us-central1-itw-creative-works.cloudfunctions.net/bm_api', {
        method: 'post',
        response: 'json',
        body: {
          backendManagerKey: process.env.BACKEND_MANAGER_KEY,
          command: 'admin:firestore-read',
          payload: {
            path: `ci-builds/${activeRun.id}`,
          }
        }
      })
      .then(response => {
        const status = get(response, 'status');
        let message = '';

        done = true;

        // Get status of each platform. If any one of them is not complete, keep waiting
        Object.keys(status)
        .forEach(key => {
          const complete = status[key].complete;
          const error = status[key].error;
          message += `${key}=${complete} ${error ? '(ERROR!)' : ''}`
          if (error) {
            done = true;
            caughtError = error;
            return
          }
          if (!complete) {
            done = false;
          }

        })

        if (caughtError) {
          console.log(chalk.red(scriptName, `Error while waiting for CI server to finish: ${message} - ${getElapsed()}`));
          console.log(chalk.red(caughtError));
        } else {
          console.log(chalk.yellow(scriptName, `Waiting for CI server to finish: ${message} - ${getElapsed()}`));
        }

      })
      .catch(e => {
        console.warn(chalk.red(scriptName, `Failed to fetch CI status: ${e.message}`));
      })
      return done;
    }, {interval: 30000, timeout: 1000 * 60 * 30})
    .then(r => {
      return resolve()
    })
    .catch(e => {
      reject(new Error(`CI server did mot finish successfully in time: ${e}`))
    })

  });
}

function process_retriggerCIServer(id) {
  const now = new Date();

  return new Promise(async function(resolve, reject) {

    console.log(chalk.blue(scriptName, `Retriggering CI Server Build: ${id}...`));

    activeRun = await octokit.rest.actions.listWorkflowRuns({
      owner: owner,
      repo: repo,
      workflow_id: 'build.yml',
    })
    .then(response => {
      const runs = get(response, 'data.workflow_runs', []);

      runs.forEach(run => {
        if (run.id === id && run.conclusion === 'success') {
          activeRun = run;
        }
      });

      if (!activeRun) {
        throw new Error(`No run with this ID: ${id}`)
      }

      return activeRun;
    })
    .catch(e => e)

    if (activeRun instanceof Error) {
      return reject(activeRun);
    }

    console.log(chalk.green(scriptName, `Found run ${id}: created=${activeRun.created_at}, status=${activeRun.status}, conclusion=${activeRun.conclusion}`));

    fetch('https://us-central1-itw-creative-works.cloudfunctions.net/bm_api', {
      method: 'post',
      response: 'json',
      body: {
        backendManagerKey: process.env.BACKEND_MANAGER_KEY,
        command: 'admin:firestore-write',
        payload: {
          path: `ci-builds/${activeRun.id}`,
          document: {
            date: {
              timestamp: now.toISOString(),
              timestampUNIX: Math.round(now.getTime() / 1000),
            }
          }
        }
      }
    })
    .then(async r => {
      console.log(chalk.green(scriptName, `Successfully retriggerred CI Server Build: ${activeRun.id}`));

      // Stall so the CI server can reset fully
      await powertools.wait(30000)

      resolve(r)
    })
    .catch(e => reject(e))

  });
}

function getElapsed() {
  const duration = moment.duration(moment().diff(startTime));
  const min = `${parseInt(duration.asMinutes()) % 60}`.padStart(2, '0');
  const sec = `${parseInt(duration.asSeconds()) % 60}`.padStart(2, '0');

  return `${min}:${sec}`
}

