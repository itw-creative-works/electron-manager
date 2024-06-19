const ua = require('universal-analytics');
const { get } = require('lodash');

function Analytics(m) {
  const self = this;
  self.Manager = m;
  self.queue = [];
  self.initialized = false;

  return self;
}

Analytics.prototype.init = function (options) {
  const self = this;
  const electronManager = self.Manager.storage.electronManager.get('data.current', {})
  const protocol = self.Manager.options.app.id;
  let userAgent;
  let referrer;

  // Fix options
  options = options || {};
  options.pageview = typeof options.pageview === 'undefined' ? true : options.pageview;
  options.mainRenderer = typeof options.mainRenderer === 'undefined' ? self.Manager.mainRenderer : options.mainRenderer;
  // options.screenview = typeof options.screenview === 'undefined' ? false : options.screenview;

  // Set properties
  self.initialized = false;
  self.uuid = get(electronManager, 'uuid', null)
  self.version = get(electronManager, 'meta.version', null);
  self.log = typeof options.log !== 'undefined'
    ? options.log
    : get(electronManager, 'meta.environment', null) === 'development';

  // self.renderer = !!options.renderer;
  // self.url = self.renderer
  //   ? `${protocol}://renderer`
  //   : (document.location.protocol === `${protocol}:`
  //     ? `${protocol}:${document.location.pathname}${document.location.search}`
  //     : document.location.origin + document.location.pathname + document.location.search);

  if (self.Manager.process === 'main') {
    self.url = `${protocol}://main`
    userAgent = self.Manager.libraries.electron.app.userAgentFallback;
    referrer = '';
  } else {
    if (options.mainRenderer) {
      self.url = `${protocol}://renderer`
    } else if (document.location.protocol === `${protocol}:`) {
      self.url = `${protocol}:${document.location.pathname}${document.location.search}`
    } else {
      self.url = document.location.origin + document.location.pathname + document.location.search;
    }
    userAgent = get(electronManager, 'meta.userAgent') || navigator.userAgent;
    referrer = document.referrer;
  }

  if (!self.uuid) {
    return self;
  }

  // self.user = ua(self.log ? Global.apiKeys.analyticsDebug : Global.apiKeys.analytics, self.uuid, {
  //   strictCidFormat: false,
  // }); //https://analytics.google.com/analytics/web/#/report-home/a104885300w228822596p215709578
  self.user = ua(self.Manager.options.config.analytics.id, self.uuid, {
    strictCidFormat: false,
  }); //https://analytics.google.com/analytics/web/#/report-home/a104885300w228822596p215709578

  // if (self.renderer) {
  self.user.set('ds', 'app');
  // }
  self.user.set('uid', self.uuid);
  self.user.set('uip', encodeURIComponent(get(electronManager, 'meta.ip', '')));
  self.user.set('ua', encodeURIComponent(userAgent));
  self.user.set('dr', encodeURIComponent(referrer));

  self.initialized = true;

  // if (self.Manager.process === 'main') {
  //   self._log('Initialized', self.Manager.options.config.analytics.id, self.uuid);
  // } else {
  //   self._log('Initialized', self.Manager.options.config.analytics.id, self.uuid, self.user);
  // }

  self._log('Initialized', self.Manager.options.config.analytics.id, self.uuid);

  if (self.Manager.process !== 'main') {
    if (options.pageview) {
      self.pageview({
        path: self.url,
        location: self.url,
        host: window.location.hostname,
        title: document.title,
      });
    }
    if (options.screenview) {
      self.screenview({
        screen: options.screenview,
      });
    }
  }

  if (self.queue.length > 0) {
    self.queue.forEach((item, i) => {
      self[item.type](item.options);
    });
    self.queue = [];
  }

  return self;
};

Analytics.prototype.process = function (event) {
  const self = this;
  let trackingData = event.target.dataset.trackingEvent;
  if (trackingData && ![...event.target.classList].includes('disabled') && !event.target.getAttribute('disabled')) {
    let split = trackingData.split('|');
    self.event({
      category: split[0],
      action: split[1],
      label: split[2],
    })
  }
};

Analytics.prototype.pageview = function (options) {
  const self = this;
  options = options || {};
  options.path = options.path;
  options.location = options.location;
  options.host = options.host;
  options.title = options.title;

  if (!self.initialized) {
    self.queue = self.queue.concat({
      type: 'pageview',
      options: options,
    })
    return self;
  } else {
    self._log('Pageview:', options);
  }

  self.user.pageview({
    dp: options.path,
    dl: options.location,
    dh: options.host,
    dt: options.title,
  }).send();
  return self;
};

Analytics.prototype.screenview = function (options) {
  const self = this;
  options = options || {};
  options.screen = options.screen;

  if (!self.initialized) {
    self.queue = self.queue.concat({
      type: 'screenview',
      options: options,
    })
    return self;
  } else {
    self._log('Screenview:', options);
  }

  self.user.screenview(
    options.screen,
    self.Manager.options.app.name,
    self.version
  ).send();
  return self;
};

Analytics.prototype.event = function (options) {
  const self = this;
  options = options || {};
  options.category = options.category;
  options.action = options.action;
  options.label = options.label;
  options.value = options.value;
  options.path = options.path || self.url;

  if (!self.initialized) {
    self.queue = self.queue.concat({
      type: 'event',
      options: options,
    })
    return self;
  } else {
    self._log('Event:', options);
  }

  self.user.event({
    ec: options.category,
    ea: options.action,
    el: options.label,
    ev: options.value,
    dp: options.path,
  }).send();
  return self;
};

Analytics.prototype._log = function () {
  const self = this;
  if (self.log) {
    console.log('[Analytics]', ...arguments);
  }
};

module.exports = Analytics;
