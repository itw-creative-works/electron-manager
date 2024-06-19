let SentryProcessor;

function ErrorCatcher(Manager) {
  const self = this;
  self.queue = [];
  self.handler = function (error, detail) {
    SentryProcessor = SentryProcessor || require('./sentry-processor.js');
    SentryProcessor.log({message: error.message, stack: error.stack, source: 'custom'}, {});
    self.queue.push(error);
  }
  self.Manager = Manager;
}

ErrorCatcher.prototype.register = function () {
  const self = this;
  if (process.type === 'renderer') {
    // //	Debounced because some packages, for example React, because of their error boundry feature, throws many identical uncaught errors
    // const errorHandler = debounce(error => {
    //   invokeErrorHandler('Unhandled Error', error);
    // }, 200);
    // window.addEventListener('error', event => {
    //   event.preventDefault();
    //   errorHandler(event.error || event);
    // });
    //
    // const rejectionHandler = debounce(reason => {
    //   invokeErrorHandler('Unhandled Promise Rejection', reason);
    // }, 200);
    // window.addEventListener('unhandledrejection', event => {
    //   event.preventDefault();
    //   rejectionHandler(event.reason);
    // });
  } else {
    process.on('uncaughtException', self.handler);
    process.on('unhandledRejection', self.handler);
  }
};

ErrorCatcher.prototype.unregister = function () {
  const self = this;
  const Manager = self.Manager;

  if (process.type === 'renderer') {
  } else {
    process.off('uncaughtException', self.handler);
    process.off('unhandledRejection', self.handler);
  }

  if (self.queue.length > 0 && Manager.libraries.sentry) {
    self.queue.forEach((e, i) => {
      Manager.libraries.sentry.captureException(e)
    });
    self.queue = [];
  }
};

module.exports = ErrorCatcher;
