let get;

function Gathering(m) {
  this.Manager = m;
}

Gathering.prototype.init = function (options) {
  const self = this;
  options = options || {};
  get = require('lodash/get')

  return new Promise(function(resolve, reject) {
    if (typeof firebase === 'undefined') {
      console.log('---firebase', undefined);
      return resolve();
    } else {
      console.log('---firebase', firebase);
      // // https://firebase.google.com/docs/firestore/solutions/presence#solution_cloud_functions_with_realtime_database
      // var uid = Math.floor(new Date().getTime()) + '-' + (Math.floor((Math.random() * 1000)) + '').padStart(4, '0');
      //
      // var userStatusDatabaseRef = firebase.database().ref('gatherings/online/' + uid);
      //
      // // var isOfflineForDatabase = {
      // //   state: 'offline',
      // //   uid: uid,
      // //   // last_changed: firebase.database.ServerValue.TIMESTAMP,
      // // };
      //
      // var isOnlineForDatabase = {
      //   state: 'online',
      //   uid: uid,
      //   app: self.options.app,
      //   environment: self.options.environment,
      //   timestamp: new Date().toISOString(),
      //   // last_changed: firebase.database.ServerValue.TIMESTAMP,
      // };
      //
      // firebase.database().ref('.info/connected').on('value', function(snapshot) {
      //   if (snapshot.val() == false) { return; };
      //
      //   userStatusDatabaseRef.onDisconnect().remove().then(function() {
      //     userStatusDatabaseRef.set(isOnlineForDatabase);
      //   });
      // });
      return resolve();
    }
  });
};


module.exports = Gathering;
