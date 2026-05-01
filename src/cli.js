// Libraries
const path = require('path');
const jetpack = require('fs-jetpack');

// Load .env file from current working directory (project root)
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

// Command Aliases
const DEFAULT = 'setup';
const ALIASES = {
  setup:            ['-s', '--setup'],
  clean:            ['-c', '--clean'],
  install:          ['-i', 'i', '--install'],
  version:          ['-v', '--version'],
  build:            ['-b', '--build'],
  publish:          ['-p', '--publish'],
  test:             ['-t', '--test'],
  'validate-certs': ['certs', '--validate-certs'],
  'sign-windows':   ['--sign-windows'],
  'push-secrets':   ['secrets', '--push-secrets'],
  'finalize-release': ['finalize', '--finalize-release'],
  runner:           ['--runner'],
};

// Resolve command name from aliases
function resolveCommand(options) {
  // Positional command
  if (options._.length > 0) {
    const command = options._[0];
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (command === key || aliases.includes(command)) {
        return key;
      }
    }
    return command;
  }

  // Flag-style alias
  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      if (options[alias.replace(/^-+/, '')]) {
        return key;
      }
    }
  }

  return DEFAULT;
}

// Main
function Main() {}

Main.prototype.process = async function (options) {
  options = options || {};
  options._ = options._ || [];

  const command = resolveCommand(options);

  try {
    const commandFile = path.join(__dirname, 'commands', `${command}.js`);

    if (!jetpack.exists(commandFile)) {
      throw new Error(`Error: Command "${command}" not found.`);
    }

    const Command = require(commandFile);
    await Command(options);
  } catch (e) {
    console.error(`Error executing command: ${e.message}`);
    throw e;
  }
};

module.exports = Main;
