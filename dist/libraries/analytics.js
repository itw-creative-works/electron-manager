const fetch = require('wonderful-fetch');
const moment = require('moment');
const crypto = require('crypto');

function Analytics(m) {
  const self = this;

  // Set shortcuts
  self.Manager = m;

  // Set properties
  self.queue = [];
  self.initialized = false;

  // Return
  return self;
}

Analytics.prototype.init = function (options) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;

  // Get properties
  const electronManager = Manager.storage.electronManager.get('data.current', {})
  const protocol = Manager.options.app.id;

  // Set initialized
  self.initialized = false;

  // Set request properties
  self.request = {
    ip: electronManager?.meta?.ip || null,
    country: electronManager?.meta?.country || null,
    // city: self.assistant?.request?.geolocation?.city || '',
    // region: self.assistant?.request?.geolocation?.region || '',
    referrer: null,
    userAgent: null,
    // language: (self.assistant?.request?.client?.language || '').split(',')[0],
    // mobile: self.assistant?.request?.client?.mobile || false,
    platform: electronManager?.meta?.os?.name || null,
    // name: self.assistant?.meta?.name || '',
  }

  // Fix options
  // console.log('---options 1', options);
  options = options || {};
  options.dataSource = 'app';
  options.uuid = electronManager?.uuid || null
  options.startTime = electronManager?.meta?.startTime || null;
  options.sessionId = electronManager?.sessionId || null;
  options.isDevelopment = electronManager?.meta?.environment === 'development';
  options.pageview = typeof options.pageview === 'undefined' ? true : options.pageview;
  options.version = electronManager?.meta.version || null;
  options.userProperties = options.userProperties || {};
  options.userData = options.userData || {};
  options.mainRenderer = typeof options.mainRenderer === 'undefined' ? Manager.mainRenderer : options.mainRenderer;
  // options.screenview = typeof options.screenview === 'undefined' ? false : options.screenview;
  options.url = options.url || null;
  // options.log = typeof options.log !== 'undefined'
  //   ? options.log
  //   : electronManager?.meta?.environment === 'development';
  options.log = electronManager?.meta?.environment === 'development';

  // Handle different processes
  if (Manager.process === 'main') {
    options.url = `${protocol}://main`
    self.request.userAgent = Manager.libraries.electron.app.userAgentFallback;
    self.request.referrer = '';
  } else {
    if (options.mainRenderer) {
      options.url = `${protocol}://renderer`
    } else if (document.location.protocol === `${protocol}:`) {
      options.url = `${protocol}:${document.location.pathname}${document.location.search}`
    } else {
      options.url = document.location.origin + document.location.pathname + document.location.search;
    }
    self.request.userAgent = electronManager?.meta?.userAgent || navigator.userAgent;
    self.request.referrer = document.referrer;
  }

  // If no UUID, exit
  if (!options.uuid) {
    return self;
  }

  // Set user
  const authUser = electronManager?.user;
  self.userProperties = {
    app_version: {
      value: options.version || 'None',
    },
    // browser: {
    //   value: self.request.userAgent,
    // },
    device_category: {
      value: 'desktop',
    },
    // device_model: {
    //   value: 'None',
    // },
    operating_system: {
      value: self.request.platform || 'None',
    },
    // os_version: {
    //   value: 'None',
    // },
    // os_with_version: {
    //   value: 'None',
    // },
    platform: {
      value: 'web',
    },
    // screen_resolution: {
    //   value: 'None',
    // },
    age: {
      value: 'None',
    },
    country: {
      value: self.request.country || 'None',
    },
    city: {
      value: self.request.city || 'None',
    },
    gender: {
      value: 'None',
    },
    // interests: {
    //   value: 'None',
    // },
    language: {
      value: self.request.language || 'None',
    },

    // TODO
    // Add custom events for user properties, like plan ID, etc, draw from self.assistant.usage, etc
    authenticated: {
      value: authUser?.auth?.uid ? true : false,
    },
    plan_id: {
      value: authUser?.plan?.id || 'basic',
    },
    plan_trial_activated: {
      value: authUser?.plan?.trial?.activated || false,
    },
    activity_created: {
      value: moment(authUser?.activity?.created?.timestampUNIX
        ? authUser?.activity?.created?.timestamp
        : electronManager?.meta?.startTime).format('YYYY-MM-DD'),
    },

    // ds? 'app
    // uid?
    // uip?
    // ua?
    // dr? (referrer)
  };

  // Fix user data
  // https://developers.google.com/analytics/devguides/collection/ga4/uid-data
  // https://stackoverflow.com/questions/68636233/ga4-measurement-protocol-does-not-display-user-data-location-screen-resolution
  self.userData = {
    sha256_email_address: authUser?.auth?.email
      ? toSHA256(authUser?.auth?.email)
      : undefined,
    sha256_phone_number: authUser?.personal?.telephone?.number
      ? toSHA256(authUser?.personal?.telephone?.countryCode + authUser?.personal?.telephone?.number)
      : undefined,
    address: {
      sha256_first_name: authUser?.personal?.name?.first
        ? toSHA256(authUser?.personal?.name?.first)
        : undefined,
      sha256_last_name: authUser?.personal?.name?.last
        ? toSHA256(authUser?.personal?.name?.last)
        : undefined,
      // sha256_street: TODO,
      city: self.request.city || undefined,
      region: self.request.region || undefined,
      // postal_code: TODO,
      country: self.request.country || undefined,
    }
  }

  // Merge user properties
  self.userProperties = {
    ...self.userProperties,
    ...options.userProperties,
  };

  // Set id and secret
  self.analyticsId = Manager?.options?.config?.analytics?.id;
  self.analyticsSecret = Manager?.options?.config?.analytics?.secret;

  // Check if we have the required properties
  if (!self.analyticsId || !self.analyticsSecret) {
    console.error('Missing required properties analytics properties');

    return self;
  }

  // Attach options
  self.options = options;

  // self.user.set('ds', 'app');
  // self.user.set('uid', self.uuid);
  // self.user.set('uip', encodeURIComponent(get(electronManager, 'meta.ip', '')));
  // self.user.set('ua', encodeURIComponent(userAgent));
  // self.user.set('dr', encodeURIComponent(referrer));

  // Set initialized
  self.initialized = true;

  // Log initialization
  self._log('Initialized', self.analyticsId, options.uuid);

  // Handle pageview and screenview
  // if (Manager.process !== 'main') {
  //   if (options.pageview) {
  //     self.pageview({
  //       path: self.url,
  //       location: self.url,
  //       host: window.location.hostname,
  //       title: document.title,
  //     });
  //   }
  //   if (options.screenview) {
  //     self.screenview({
  //       screen: options.screenview,
  //     });
  //   }
  // }

  // Handle initial events
  if (Manager.process === 'main') {
    self.event('app_launch', {});
  } else if (options.mainRenderer) {
    self.event('page_view', {});
  }

  // Process queue
  if (self.queue.length > 0) {
    // Process each item in the queue
    self.queue.forEach((item, i) => {
      self[item.type](...item.arguments);
    });

    // Clear the queue
    self.queue = [];
  }

  // Return
  return self;
};

Analytics.prototype.process = function (event) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;

  // Get tracking data
  const trackingData = event?.target?.dataset?.trackingEvent;

  // If it's and invalid event, exit
  if (
    !trackingData
    || [...event.target.classList].includes('disabled')
    || event.target.getAttribute('disabled')
  ) {
    return;
  }

  // Split tracking data
  const payload = {
    name: '',
    params: {},
  };

  // Split tracking data
  (trackingData.split('|') || []).forEach((item, i) => {
    // The first item is the event name
    if (i === 0) {
      payload.name = item;
    }

    // Split item based on : or =
    const split = item.split(/:|=/);

    // If it's not a key value pair, exit
    if (!split[0]) {
      return
    }

    // If it's a key value pair, add it to the payload
    payload.params[split[0]] = parseValue(split[1]);
  })

  // Send event
  self.event(payload.name, payload.params);
};

// NO-OP'd
Analytics.prototype.pageview = function (options) {
  // const self = this;
  // options = options || {};
  // options.path = options.path;
  // options.location = options.location;
  // options.host = options.host;
  // options.title = options.title;

  // if (!self.initialized) {
  //   self.queue = self.queue.concat({
  //     type: 'pageview',
  //     options: options,
  //   })
  //   return self;
  // } else {
  //   self._log('Pageview:', options);
  // }

  // self.user.pageview({
  //   dp: options.path,
  //   dl: options.location,
  //   dh: options.host,
  //   dt: options.title,
  // }).send();
  // return self;
};

// NO-OP'd
Analytics.prototype.screenview = function (options) {
  // const self = this;

  // // Set shortcuts
  // const Manager = self.Manager;

  // // Get properties
  // options = options || {};
  // options.screen = options.screen;

  // //
  // if (!self.initialized) {
  //   self.queue = self.queue.concat({
  //     type: 'screenview',
  //     options: options,
  //   })
  //   return self;
  // } else {
  //   self._log('Screenview:', options);
  // }

  // self.user.screenview(
  //   options.screen,
  //   Manager.options.app.name,
  //   self.version
  // ).send();
  // return self;
};

Analytics.prototype.event = function (name, params) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;
  const options = self.options;
  const request = self.request;
  const userProperties = self.userProperties;
  const userData = self.userData;

  // Handle events when not initialized
  if (!self.initialized) {
    // Add to queue
    self.queue = self.queue.concat({
      type: 'event',
      arguments: arguments,
    })

    // Return
    return self;
  }

  // Fix event name
  name = `${name}`
    // Replace anything not a letter, number, or underscore with an underscore
    .replace(/[^a-zA-Z0-9_]/g, '_')
    // Remove leading and trailing underscores
    .replace(/^_+|_+$/g, '')
    // Remove multiple underscores
    .replace(/_+/g, '_');

  // Fix params
  params = params || {};

  // Set properties
  // payload.category = payload.category;
  // payload.action = payload.action;
  // payload.label = payload.label;
  // payload.value = payload.value;
  // payload.path = payload.path || self.url;

  // Fix payload
  params.event_source = options.dataSource;
  params.page_location = options.url; // Supposed to be domain
  params.page_title = options.url; // Supposed to be title
  params.ip_override = request.ip;
  params.user_agent = request.userAgent;
  params.page_referrer = request.referrer;
  // https://stackoverflow.com/questions/70708893/google-analytics-4-measurement-protocol-shows-events-but-no-users/71811327#71811327
  params.engagement_time_msec = new Date().getTime() - new Date(options.startTime).getTime();
  // params.engagement_time_msec = 1;
  params.debug_mode = false;
  params.session_id = options.sessionId;

  // Build url and body
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${self.analyticsId}&api_secret=${self.analyticsSecret}`;
  const body = {
    client_id: options.uuid,
    user_id: options.uuid,
    // timestamp_micros: new Date().getTime() * 1000,
    user_properties: self.userProperties,
    user_data: self.userData,
    // consent: {},
    // non_personalized_ads: false,
    events: [{
      name: name,
      params: params,
    }],
  }

  // Log event
  // self._log('Event:', name, params);
  self._log('Event:', name, '<redacted>');
  // console.log('Event:', body, name, params);

  // Send event
  fetch(url, {
    method: 'post',
    response: 'text',
    tries: 2,
    timeout: 30000,
    body: body,
  })
  .then((r) => {
    self._log('Sent event', r);
  })
  .catch((e) => {
    console.error('Failed to send event', e);
  });

  // Return
  return self;
};

Analytics.prototype._log = function () {
  const self = this;

  // Shortcuts
  const options = self.options;

  if (options.log) {
    console.log('[Analytics]', ...arguments);
  }
};

function toSHA256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  if (!isNaN(+value)) return +value;
  return value;
}

module.exports = Analytics;
