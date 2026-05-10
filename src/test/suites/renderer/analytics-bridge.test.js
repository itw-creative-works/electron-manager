// Renderer-layer round-trip tests for window.em.{analytics,context,usage,remoteConfig}.
// Verifies the contextBridge surfaces actually round-trip through IPC into main.

module.exports = {
  type: 'suite',
  layer: 'renderer',
  description: 'analytics + context + usage + remote-config bridges (renderer)',
  tests: [
    {
      name: 'window.em.analytics has event / pageview / screenview / setUserProperties / getStatus',
      run: (ctx) => {
        ctx.expect(typeof window.em.analytics.event).toBe('function');
        ctx.expect(typeof window.em.analytics.pageview).toBe('function');
        ctx.expect(typeof window.em.analytics.screenview).toBe('function');
        ctx.expect(typeof window.em.analytics.setUserProperties).toBe('function');
        ctx.expect(typeof window.em.analytics.getStatus).toBe('function');
      },
    },
    {
      name: 'window.em.analytics.getStatus round-trips main state',
      run: async (ctx) => {
        const status = await window.em.analytics.getStatus();
        ctx.expect(status).toBeDefined();
        // Should always have the enabled boolean — even when analytics is off.
        ctx.expect(typeof status.enabled).toBe('boolean');
      },
    },
    {
      name: 'window.em.analytics.event is fire-and-forget (no throw)',
      run: (ctx) => {
        // No await — send is one-way. Just verify it doesn't throw.
        window.em.analytics.event('renderer_test_event', { from: 'renderer' });
        window.em.analytics.pageview('/test/path');
        window.em.analytics.screenview('TestScreen');
        ctx.expect(true).toBe(true);
      },
    },
    {
      name: 'window.em.context.get returns the context snapshot',
      run: async (ctx) => {
        const snap = await window.em.context.get();
        ctx.expect(snap).toBeDefined();
        ctx.expect(snap.session).toBeDefined();
        ctx.expect(snap.client).toBeDefined();
        ctx.expect(typeof snap.session.id).toBe('string');
        ctx.expect(snap.session.id.length).toBe(36);   // uuid
        ctx.expect(typeof snap.client.platform).toBe('string');
      },
    },
    {
      name: 'window.em.usage.get returns the usage snapshot',
      run: async (ctx) => {
        const snap = await window.em.usage.get();
        ctx.expect(snap).toBeDefined();
        ctx.expect(typeof snap.opens).toBe('number');
        ctx.expect(typeof snap.hoursTotal).toBe('number');
        ctx.expect(typeof snap.hoursThisSession).toBe('number');
      },
    },
    {
      name: 'window.em.remoteConfig.get / refreshNow / onUpdate are functions',
      run: (ctx) => {
        ctx.expect(typeof window.em.remoteConfig.get).toBe('function');
        ctx.expect(typeof window.em.remoteConfig.refreshNow).toBe('function');
        ctx.expect(typeof window.em.remoteConfig.onUpdate).toBe('function');
      },
    },
    {
      name: 'window.em.remoteConfig.onUpdate returns an unsub function',
      run: (ctx) => {
        const off = window.em.remoteConfig.onUpdate(() => {});
        ctx.expect(typeof off).toBe('function');
        off();
      },
    },
  ],
};
