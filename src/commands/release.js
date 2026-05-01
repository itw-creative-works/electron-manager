// release — trigger the GitHub Actions Build & Release workflow + stream logs locally.
//
// Replaces the old "do it from my laptop" release flow with "let CI do it, but make it
// feel local." User runs `npm run release` (or `npx mgr release`) and gets:
//   1. A workflow_dispatch POST to GH Actions on the consumer's repo (owner/repo derived
//      from package.json#repository.url, falling back to git remote origin).
//   2. A few seconds of waiting while GH spins up the run.
//   3. Live polling of every job's logs at 5s intervals, printing NEW lines as they
//      arrive (job-prefixed) so it looks like streaming.
//   4. Everything teed to <root>/logs/build.log with ANSI codes preserved on stdout
//      and stripped from the file (matches the dev/start log convention).
//   5. Exit 0 on success, 1 on any job failure.
//
// Why poll instead of stream? GH Actions doesn't expose live stdout — logs are only
// fetchable AFTER each STEP completes. So "streaming" is a polite fiction: every 5s
// we re-fetch each job's logs and diff against what we already printed.

const path     = require('path');
const fs       = require('fs');
const jetpack  = require('fs-jetpack');

const { discoverRepo, getOctokit } = require('../utils/github.js');
const Manager = new (require('../build.js'));

const logger = Manager.logger('release');

const POLL_INTERVAL_MS = 5000;
const WORKFLOW_FILE    = 'build.yml';

module.exports = async function release(options = {}) {
  const projectRoot = process.cwd();

  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN not set in env. Set it in .env (or shell) so we can dispatch the workflow.');
  }

  // silent: true — suppress octokit's default console output for transient 404s
  // (in-progress job logs return 404 until the step completes).
  const octokit = getOctokit({ silent: true });
  if (!octokit) {
    throw new Error('Failed to create octokit (missing GH_TOKEN?).');
  }

  // Discover repo from package.json#repository.url (falls back to git remote).
  let owner, repo;
  try {
    ({ owner, repo } = await discoverRepo(projectRoot));
  } catch (e) {
    throw new Error(`Could not determine GitHub repo: ${e.message}`);
  }

  // Discover ref (current branch or override via --ref).
  const ref = options.ref || (await currentBranch(projectRoot)) || 'main';

  logger.log(`Triggering ${owner}/${repo} workflow ${WORKFLOW_FILE} on ref=${ref}...`);

  // 1. Mark a "before" timestamp so we can identify the new run we just dispatched.
  const before = new Date();

  // 2. Dispatch.
  await octokit.rest.actions.createWorkflowDispatch({
    owner, repo,
    workflow_id: WORKFLOW_FILE,
    ref,
  });

  // 3. Wait for the new run to appear (GH Actions takes a few seconds to register it).
  const run = await waitForNewRun({ octokit, owner, repo, after: before, workflowFile: WORKFLOW_FILE });
  if (!run) {
    throw new Error('Workflow dispatch succeeded but no new run appeared after 60s. Check GitHub Actions UI.');
  }

  logger.log(`Run started: ${run.html_url}`);

  // 4. Set up the build log tee.
  const logsDir = path.join(projectRoot, 'logs');
  jetpack.dir(logsDir);
  const buildLogPath = path.join(logsDir, 'build.log');
  // Truncate so each release run starts fresh.
  fs.writeFileSync(buildLogPath, `# release run ${run.html_url}\n# started ${new Date().toISOString()}\n\n`);
  const logFile = fs.createWriteStream(buildLogPath, { flags: 'a' });

  // Spinner state. We tick every 250ms even between polls so the terminal feels alive.
  // The spinner line uses \r to overwrite itself; before printing real content we clear
  // the line, write content, then re-render the spinner. File output is unaffected.
  const startedAt   = Date.now();
  const isTty       = process.stdout.isTTY === true;
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerFrame = 0;
  let pollCount    = 0;
  let latestState  = null;
  let latestJobs   = [];

  function clearSpinner() {
    if (!isTty) return;
    process.stdout.write('\r\x1b[2K');
  }

  function renderSpinner() {
    if (!isTty || !latestState) return;
    const frame   = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
    const elapsed = formatElapsed(Date.now() - startedAt);
    const status  = `${latestState.status}${latestState.conclusion ? ` (${latestState.conclusion})` : ''}`;
    const jobBits = latestJobs.map((j) => `${jobSymbol(j)} ${j.name}`).join(' ');
    const line    = `${frame}  ${status} · ${elapsed} · ${pollCount} polls · ${jobBits}`;
    // Truncate so we never wrap (which breaks the \r overwrite).
    const cols    = process.stdout.columns || 120;
    const safe    = line.length > cols - 1 ? line.slice(0, cols - 2) + '…' : line;
    process.stdout.write(`\r${safe}`);
  }

  // Print line(s) to stdout AND tee to file. Clears spinner first; spinner re-renders next tick.
  function print(line) {
    clearSpinner();
    process.stdout.write(line);
    logFile.write(stripAnsi(line));
  }

  // Tick the spinner ~4 times/sec so it animates between polls.
  const spinnerTimer = isTty ? setInterval(() => {
    spinnerFrame += 1;
    renderSpinner();
  }, 250) : null;

  // 5. Poll until completion. Track byte offsets per job so we only print new lines.
  const printedByJob = new Map(); // jobId -> chars printed so far
  let lastStatusLine = '';

  try {
    while (true) {
      pollCount += 1;
      const { data: state } = await octokit.rest.actions.getWorkflowRun({
        owner, repo, run_id: run.id,
      });

      // Pull all jobs. Each job has steps; each step has a step-level status.
      const { data: jobsResp } = await octokit.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: run.id, per_page: 100,
      });
      const jobs = jobsResp.jobs || [];
      latestState = state;
      latestJobs  = jobs;

      // For each job, fetch its logs (only available once steps complete; for in-progress
      // jobs, GH returns 404 or partial — we tolerate both).
      for (const job of jobs) {
        // Skip queued jobs entirely (no logs yet).
        if (job.status === 'queued') continue;

        let logsText = '';
        try {
          const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
            owner, repo, job_id: job.id,
          });
          // Octokit returns the raw text content here.
          logsText = typeof data === 'string' ? data : Buffer.from(data || '').toString('utf8');
        } catch (e) {
          // 404 = logs not ready yet. Other errors we just skip until next tick.
          continue;
        }

        const printed = printedByJob.get(job.id) || 0;
        if (logsText.length > printed) {
          const fresh = logsText.slice(printed);
          // Prefix each line with the job name so interleaved output is readable.
          const prefix = `[${job.name}] `;
          for (const rawLine of fresh.split('\n')) {
            if (!rawLine) continue;
            print(`${prefix}${rawLine}\n`);
          }
          printedByJob.set(job.id, logsText.length);
        }
      }

      // Print a one-line status banner if it changed (no spam — only on transition).
      const banner = formatStatusBanner(state, jobs);
      if (banner !== lastStatusLine) {
        print(`\n${banner}\n`);
        lastStatusLine = banner;
      }

      if (state.status === 'completed') {
        clearSpinner();
        logFile.end();
        const success = state.conclusion === 'success';
        const symbol  = success ? '✓' : '✗';
        logger.log(`${symbol} Run ${state.conclusion} — ${state.html_url}`);
        logger.log(`Logs: ${path.relative(projectRoot, buildLogPath)}`);
        if (!success) {
          process.exitCode = 1;
          throw new Error(`Release run failed (conclusion=${state.conclusion}). See ${buildLogPath} or ${state.html_url}.`);
        }
        return;
      }

      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    if (spinnerTimer) clearInterval(spinnerTimer);
    clearSpinner();
  }
};

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function jobSymbol(j) {
  if (j.status === 'completed') return j.conclusion === 'success' ? '✓' : '✗';
  if (j.status === 'in_progress') return '…';
  if (j.status === 'queued') return '·';
  return '?';
}

async function waitForNewRun({ octokit, owner, repo, after, workflowFile }) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { data } = await octokit.rest.actions.listWorkflowRuns({
      owner, repo, workflow_id: workflowFile, per_page: 5, event: 'workflow_dispatch',
    });
    const runs = data.workflow_runs || [];
    // The newest run created strictly after our dispatch timestamp.
    const fresh = runs.find((r) => new Date(r.created_at).getTime() >= after.getTime() - 1000);
    if (fresh) return fresh;
    await sleep(2000);
  }
  return null;
}

function formatStatusBanner(run, jobs) {
  const parts = jobs.map((j) => `${jobSymbol(j)} ${j.name}`);
  return `── ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''} ── ${parts.join('  |  ')}`;
}

async function currentBranch(projectRoot) {
  try {
    const { execute } = require('node-powertools');
    const out = await execute('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, log: false });
    return String(out || '').trim();
  } catch (e) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(s) {
  // Minimal ANSI stripper — handles CSI sequences (colors, cursor moves).
  return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
