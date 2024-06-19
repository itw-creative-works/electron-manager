// if (self.options.log) {
  //   self._loggerQueue = [];
  //   self._log = function () {
  //     console.log(...self._addLogData(arguments));
  //     if (self.log) {
  //       if (self._loggerQueue.length > 0) {
  //         for (var i = 0; i < self._loggerQueue.length; i++) {
  //           self.log(...self._loggerQueue[i])
  //         }
  //         self._loggerQueue = [];
  //       }
  //       self.log(...arguments)
  //     } else {
  //       self._loggerQueue.push(self._addLogData(arguments))
  //     }
  //   }
  //   // self.log = function () {
  //   //   self._log(...arguments)
  //   //   // console.log('----HERE');
  //   //   // self._loggerQueue.push(self._addLogData(arguments))
  //   // }
  // } else {
  //   if (self.isDevelopment) {
  //     // self.log = function () {
  //     //   console.log('Called .log() but options.log=false', ...arguments);
  //     // }
  //     self._log = function () {
  //       console.log('Called ._log() but options.log=false', ...arguments);
  //     }
  //   } else {
  //     // self.log = function () {}
  //     self._log = function () {}
  //   }
  // }

  // if (self.options.log) {
  //   self._loggerQueue = [];
  //   self._log = function () {
  //     console.log(...self._addLogData(arguments));
  //     if (self.log) {
  //       if (self._loggerQueue.length > 0) {
  //         for (var i = 0; i < self._loggerQueue.length; i++) {
  //           self.log(...self._addLogData(self._loggerQueue[i]))
  //         }
  //         self._loggerQueue = [];
  //       }
  //       self.log(...self._addLogData(arguments))
  //     } else {
  //       self._loggerQueue.push(arguments)
  //     }
  //   }
  // } else {
  //   self._log = function () {}
  // }
