const storage = {};
let Store;

function SentryProcessor() {

}

async function parse(input) {
  // input = input || 'N/A'
  if (typeof input === 'string') {
    return input;
  } else if (input instanceof Promise) {
    try {
      return await input.catch(e => e);
    } catch (e) {
      return `${input}`
    }
  } else if (input instanceof Error) {
    return input;
  } else {
    return `${input}`
  }
}

// function stringify(input) {
//   input = input || 'N/A'
//   if (typeof input === 'string') {
//     return input;
//   } else if (input instanceof Promise) {
//     try {
//       // console.log('input.catch(e => e)', input.catch(e => e));
//       // console.log('await input.catch(e => e)', await input.catch(e => e));
//       // console.log('input.then(e => e)', input.then(e => e));
//       // console.log('input.then(e => e)', input.then(e => e));
//       // return `${input.catch(e => e)}`
//       const error = await input.catch(e => e);
//       console.log('----error.message', error.message);
//       console.log('----error.stack', error.stack);
//       return `${error}`
//     } catch (e) {
//       return `${e}`
//     }
//
//   } else {
//     return `${input}`
//   }
// }

SentryProcessor.extractError = async function (event, hint) {
  let message = '';
  let stack = '';
  if (hint.originalException) {
    message = hint.originalException.message || hint.originalException;
    stack = hint.originalException.stack;
  } else {
    let exception = (event.exception
      && event.exception.values
      && event.exception.values[0]
        ? event.exception.values[0]
        : null
      )
    if (exception) {
      message = exception.value;
      if (exception.stacktrace && Array.isArray(exception.stacktrace.frames)) {
        stack += `${message} `;
        exception.stacktrace.frames.forEach((item, i) => {
          stack += `at ${item.function} (${item.filename}:${item.lineno}:${item.colno}) `
        });
      }
    }
  }

  message = await parse(message);
  stack = message instanceof Error ? message.stack : await parse(stack);

  return {
    message: `${message}`,
    stack: `${stack}`,
    combo: `${message}|||${stack}`,
  };
};

SentryProcessor.filter = function (error) {
  const message = error.message;
  const stack = error.stack;
  const combo = error.combo;

  /*
    Check for invalid errors
  */
  // starter
  if (false) {

  // BrowserWindow Unresponsive
  } else if (combo.match(/BrowserWindow Unresponsive/i)) {
      return false

  // Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_ABORTED (-3) loading
  // Caused by webview navigation errors
  } else if (combo.match(/ERR_ABORTED (-3)|(-3) loading/i)) {
      return false

  // Possible side-effect in debug-evaluate
  // caused by trying to evaluate Manager or some other things in console
  } else if (combo.match(/side-effect in debug-evaluate/i)) {
      return false

  // Unexpected end of input
  // caused by trying to evaluate Manager or some other things in console
  } else if (combo.match(/Unexpected end of input/i)) {
      return false

  // ENOSPC: no space left on device, write
  // caused by trying to save data when there's no space
  } else if (combo.match(/ENOSPC/i)) {
      return false

  // read ECONNRESET
  // caused by trying to connect but it's erroring out
  } else if (combo.match(/read ECONNRESET/i)) {
      return false    

  // read ETIMEDOUT
  // caused by trying to connect but it's erroring out
  } else if (combo.match(/read ETIMEDOUT/i)) {
      return false            

  // stopper
  } else {
  }

  // If not, return true
  return true;
};

SentryProcessor.log = function (error, event) {
  // console.log('====LOGGER', error, event);
  try {
    error = error || {};
    event = event || {};      

    const type = process.type === 'browser' ? 'main' : process.type;
    const source = error.source || 'sentry';

    if (source !== 'sentry') {
      console.error('[Sentry Error Log]', error, event);
    }

    if (!storage[type]) {
      Store = Store || require('electron-store');
      storage[type] = new Store({
        cwd: `electron-manager/sentry-logs/${type}`,
        clearInvalidConfig: true,
      });
      storage[type].set('data.logs', [])
    }

    storage[type].set('data.logs',
      storage[type].get('data.logs', []).concat({
        timestamp: new Date().toISOString(),
        source: source,
        message: error.message || error,
        stack: error.stack,
        event: {
          tags: event.tags,
        },
      })
    )

  } catch (e) {
    console.error('[Sentry Error Log] Failed to save original error to logs:', e);
  }
};

SentryProcessor.clearOldLogs = function (error, event) {

};

module.exports = SentryProcessor;
