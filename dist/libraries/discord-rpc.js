function RPC(Manager) {
  const self = this;

  // Set shortcuts
  self.Manager = Manager;

  // Set properties
  self.instance = null;
  self.connection = null;
  self.status = null;
  self.setActivityInterval = null;
  self.reconnectionTimeout = null;

  // Set flags
  self.initialized = false;
}

// https://discord.js.org/#/docs/rpc/master/class/RPCClient?scrollTo=subscribe
RPC.prototype.init = function () {
  const self = this;

  return new Promise(async function(resolve, reject) {
    const Manager = self.Manager;
    const data = Manager.storage.electronManager.get('data.current');
    const discord = Manager.options.config.discord;

    // Check if Discord is enabled
    if (!discord) {
      return resolve();
    }

    // Check if already initialized
    if (self.initialized) {
      return resolve();
    }

    // Set the instance
    self.instance = self.instance || require('discord-rpc-electron');

    // Only needed for discord allowing spectate, join, ask to join
    self.instance.register(discord.id);
    self.connection = new self.instance.Client({ transport: 'ipc' });

    // Handle ready event
    self.connection.on('ready', () => {
      self.isConnected = true;
      Manager.log('[RPC] Connected to Discord');
      self.setActivity();
    });

    // Handle disconnected event
    self.connection.on('disconnected', () => {
      Manager.log('[RPC] Disconnected from Discord');
      _reconnect(self, data);
    });

    // Login to Discord
    await self.connection.login({
      clientId: discord.id,
      // scopes: scopes,
    })
    .then(async () => {
      Manager.log('[RPC] Logged in to Discord');

      // Handle the protocol for production
      if (data.meta.environment !== 'development') {
        await Manager.app().setAsDefaultProtocolClient(`discord-${discord.id}`);
      }

      // Set initialized flag
      self.initialized = true;

      // Set the activity
      self.setActivity();

      // Return
      return resolve();
    })
    .catch((e) => {
      _reconnect(self, data);

      return reject(new Error(`[RPC] Failed to login to Discord: ${e.message}`));
    });

    // await self.app().setAsDefaultProtocolClient('http').catch(e => console.error);
  });
};

RPC.prototype.setActivity = function (activity) {
  const self = this;

  return new Promise(function(resolve, reject) {
    const Manager = self.Manager;
    const data = Manager.storage.electronManager.get('data.current');
    const isDevelopment = data.meta.environment === 'development';

    // activity can only be set every 15 seconds
    clearInterval(self.setActivityInterval);
    self.setActivityInterval = setInterval(() => {
      self.setActivity();
    }, 15e3);

    // Save the activity config
    if (activity) {
      self.activity = activity;
    }

    self.activity = self.activity || {};
    self.activity.buttons = self.activity.buttons || [];
    self.activity.buttons[0] = self.activity.buttons[0] || {};
    self.activity.buttons[0].label = self.activity.buttons[0].label || '🚀 Try for free';
    self.activity.buttons[0].url = _addUTMTags(Manager.package.name, self.activity.buttons[0].url || `${Manager.package.homepage}/download`);

    // self.activity = activity && (activity.details || activity.state) ? activity : self.activity;

    if (!self.initialized || !self.connection || !self.isConnected) {
      // self.init();
      return resolve(false);
    }

    // Build the final activity object
    const final = {
      details: self.activity.details || (isDevelopment ? `Developing ${Manager.package.productName}` : Manager.options.config.discord.details || 'Browsing'),
      state: self.activity.state || (isDevelopment ? `v${data.meta.version}` : Manager.options.config.discord.state || `v${data.meta.version}`),
      startTimestamp: new Date(self.activity.timestamp || data.meta.startTime),
      largeImageKey: Manager.options.config.discord.largeImageKey || 'logo',
      largeImageText: Manager.options.config.discord.largeImageText || `${Manager.package.productName} v${data.meta.version}`,
      smallImageKey: self.activity.smallImageKey || `status-${data.user.plan.id}`,
      smallImageText: self.activity.smallImageText || _formatPlan(data.user.plan.id),
      instance: false,
      buttons: [
        {
          label: self.activity.buttons[0].label,
          url: self.activity.buttons[0].url
        }
      ]
    }

    // Log
    Manager.log('[RPC] Setting activity:', final);

    // Set the activity
    self.connection.setActivity(final);

    return resolve(final);
  });
};

function _reconnect(self, data) {
  self.isConnected = false;

  clearTimeout(self.reconnectionTimeout);
  self.reconnectionTimeout = setTimeout(function () {
    // Reconnect
    // Don't log because it will fill up the console with errors, usually it's just because Discord is closed
    self.init().catch((e) => {});
  }, data.meta.environment === 'development' ? 10000 : 120000);
}

function _addUTMTags(name, url) {
  // Add UTM params to the URL
  url = new URL(url);

  // Add UTM params
  url.searchParams.set('utm_source', 'discord');
  url.searchParams.set('utm_medium', 'discord-presence-button');
  url.searchParams.set('utm_campaign', name);

  // Return the URL
  return url.toString();
}

function _formatPlan(id) {
  // Replace dash with space, capitalize every word
  return id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

module.exports = RPC;
