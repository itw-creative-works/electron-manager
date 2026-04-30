// Tiny expect() — Jest/Vitest-compatible subset.
// Each matcher throws on failure; the runner catches.

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }

  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function fail(message) {
  const err = new Error(message);
  err.name = 'AssertionError';
  throw err;
}

function buildMatchers(actual, negated) {
  const not = negated ? 'not ' : '';

  function check(cond, message) {
    if (negated) cond = !cond;
    if (!cond) fail(message);
  }

  return {
    toBe(expected) {
      check(actual === expected, `expected ${fmt(actual)} ${not}to be ${fmt(expected)}`);
    },
    toEqual(expected) {
      check(deepEqual(actual, expected), `expected ${fmt(actual)} ${not}to deeply equal ${fmt(expected)}`);
    },
    toBeTruthy() {
      check(!!actual, `expected ${fmt(actual)} ${not}to be truthy`);
    },
    toBeFalsy() {
      check(!actual, `expected ${fmt(actual)} ${not}to be falsy`);
    },
    toBeDefined() {
      check(actual !== undefined, `expected ${fmt(actual)} ${not}to be defined`);
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${fmt(actual)} ${not}to be undefined`);
    },
    toBeNull() {
      check(actual === null, `expected ${fmt(actual)} ${not}to be null`);
    },
    toContain(item) {
      const has = Array.isArray(actual)
        ? actual.includes(item)
        : (typeof actual === 'string' && actual.includes(item));
      check(has, `expected ${fmt(actual)} ${not}to contain ${fmt(item)}`);
    },
    toHaveProperty(key) {
      const has = actual != null && Object.prototype.hasOwnProperty.call(actual, key);
      check(has, `expected ${fmt(actual)} ${not}to have property "${key}"`);
    },
    toMatch(regex) {
      check(regex.test(actual), `expected ${fmt(actual)} ${not}to match ${regex}`);
    },
    toBeInstanceOf(cls) {
      check(actual instanceof cls, `expected value ${not}to be instance of ${cls.name}`);
    },
    toBeGreaterThan(n) {
      check(actual > n, `expected ${fmt(actual)} ${not}to be > ${n}`);
    },
    toBeLessThan(n) {
      check(actual < n, `expected ${fmt(actual)} ${not}to be < ${n}`);
    },
    async toThrow(matcher) {
      let threw = false;
      let thrown;
      try {
        if (typeof actual === 'function') {
          await actual();
        }
      } catch (e) {
        threw = true;
        thrown = e;
      }
      if (!threw) {
        return check(false, `expected function ${not}to throw`);
      }
      if (matcher instanceof RegExp) {
        check(matcher.test(thrown.message), `expected thrown message ${not}to match ${matcher} (got: ${thrown.message})`);
      } else if (typeof matcher === 'string') {
        check(thrown.message.includes(matcher), `expected thrown message ${not}to contain "${matcher}" (got: ${thrown.message})`);
      } else {
        check(true, '');
      }
    },
  };
}

function expect(actual) {
  const m = buildMatchers(actual, false);
  m.not = buildMatchers(actual, true);
  return m;
}

module.exports = expect;
