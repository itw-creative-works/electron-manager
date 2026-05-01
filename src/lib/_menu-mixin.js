// Shared id-path helpers used by tray, menu, and context-menu. All three deal with the same
// data shape — an array of MenuItemConstructorOptions descriptors with optional `submenu`
// arrays — so the find/insert/update/remove logic lives here once.
//
// "Id paths" are slash-separated strings: `main/check-for-updates`, `view/developer/toggle-devtools`.
// They map onto the descriptor tree by following each segment as a child id (via id field, NOT
// label). Single-segment ids (`copy`, `tray-quit`) are also valid — they just match top-level.
//
// All functions are pure-ish: they mutate the items array (or a sub-array) in place and return
// a boolean indicating whether anything was found/changed. Callers are expected to call their
// own re-render after a mutation.

// Find the descriptor at `idPath` within `items`. Returns the live descriptor or null.
//
// We match items by their **full id field**, not by walking segments. So an item with
// `id: 'main/check-for-updates'` is found via lookup of 'main/check-for-updates' regardless
// of whether the consumer thinks of it as a path. This keeps the API "id-as-path" without
// forcing the data structure to have segmented ids at every nesting level.
//
// As a fallback, when a search by full-id misses, we walk the path segments treating
// each segment as the item's **last** path component (so `main/check-for-updates` also
// matches an item with id `'check-for-updates'` nested under one with id `'main'`). This
// handles consumers who write short ids without baking the parent prefix in.
function findItem(items, idPath) {
  if (!Array.isArray(items) || !idPath) return null;

  // Fast path: full-id match anywhere in the tree.
  const direct = findById(items, idPath);
  if (direct) return direct;

  // Fallback: walk segments, matching each by id ===  segment OR id ending in `/${segment}`.
  const segments = String(idPath).split('/').filter(Boolean);
  if (segments.length <= 1) return null; // no useful fallback for single-segment

  let current = items;
  let match = null;
  for (const seg of segments) {
    match = (current || []).find((item) => item && idMatchesSegment(item.id, seg)) || null;
    if (!match) return null;
    current = match.submenu || [];
  }
  return match;
}

// Same as findItem, but also returns the parent array + index — used by remove + insert.
function findItemWithLocation(items, idPath) {
  if (!Array.isArray(items) || !idPath) return null;

  // Fast path: full-id match anywhere in the tree.
  const direct = findByIdWithLocation(items, idPath);
  if (direct) return direct;

  const segments = String(idPath).split('/').filter(Boolean);
  if (segments.length <= 1) return null;

  let parent = items;
  let item = null;
  let index = -1;
  for (const seg of segments) {
    index = (parent || []).findIndex((it) => it && idMatchesSegment(it.id, seg));
    if (index < 0) return null;
    item = parent[index];
    if (seg === segments[segments.length - 1]) break;
    parent = item.submenu || [];
  }
  return { parent, index, item };
}

// Treat `id` as matching `seg` when:
//   - id === seg                                   (exact)
//   - id ends with '/' + seg                       (id is a path, last component is seg)
function idMatchesSegment(id, seg) {
  if (!id) return false;
  if (id === seg) return true;
  return id.endsWith(`/${seg}`);
}

function findById(items, id) {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.id === id) return item;
    if (Array.isArray(item.submenu)) {
      const nested = findById(item.submenu, id);
      if (nested) return nested;
    }
  }
  return null;
}

function findByIdWithLocation(items, id) {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    if (item.id === id) return { parent: items, index: i, item };
    if (Array.isArray(item.submenu)) {
      const nested = findByIdWithLocation(item.submenu, id);
      if (nested) return nested;
    }
  }
  return null;
}

// Splice newItem into the parent array, before or after the item at idPath.
// Returns true if the target was found and the splice happened, false otherwise.
function insertRelative(items, idPath, newItem, position /* 'before' | 'after' */) {
  const loc = findItemWithLocation(items, idPath);
  if (!loc) return false;
  const offset = position === 'before' ? 0 : 1;
  loc.parent.splice(loc.index + offset, 0, newItem);
  return true;
}

// Push newItem into the submenu of the descriptor at idPath. Creates submenu if absent.
// Returns true if the parent was found, false otherwise.
function appendInside(items, idPath, newItem) {
  const target = findItem(items, idPath);
  if (!target) return false;
  if (!Array.isArray(target.submenu)) target.submenu = [];
  target.submenu.push(newItem);
  return true;
}

// Patch the descriptor at idPath in place. Returns true if found.
function updateItem(items, idPath, patch) {
  const item = findItem(items, idPath);
  if (!item) return false;
  Object.assign(item, patch || {});
  return true;
}

// Remove the descriptor at idPath. Returns true if removed.
function removeItem(items, idPath) {
  const loc = findItemWithLocation(items, idPath);
  if (!loc) return false;
  loc.parent.splice(loc.index, 1);
  return true;
}

// Build a unified id-path API for a host lib. The host provides:
//   - getItems()       → returns the underlying items array (live reference)
//   - render()         → re-renders the menu/tray after a mutation
//   - logger           → for warnings on missing ids
// Returns an object with find/has/update/remove/enable/show/hide/insertBefore/insertAfter/appendTo.
function buildIdApi({ getItems, render, logger }) {
  const warnMissing = (op, idPath) => {
    if (logger?.warn) logger.warn(`${op}: no item at id path "${idPath}"`);
  };

  return {
    find(idPath)        { return findItem(getItems(), idPath); },
    has(idPath)         { return Boolean(findItem(getItems(), idPath)); },
    update(idPath, patch) {
      const ok = updateItem(getItems(), idPath, patch);
      if (ok) render(); else warnMissing('update', idPath);
      return ok;
    },
    remove(idPath) {
      const ok = removeItem(getItems(), idPath);
      if (ok) render(); else warnMissing('remove', idPath);
      return ok;
    },
    enable(idPath, value = true) {
      return this.update(idPath, { enabled: Boolean(value) });
    },
    show(idPath, value = true) {
      return this.update(idPath, { visible: Boolean(value) });
    },
    hide(idPath) {
      return this.update(idPath, { visible: false });
    },
    insertBefore(idPath, item) {
      const ok = insertRelative(getItems(), idPath, item, 'before');
      if (ok) render(); else warnMissing('insertBefore', idPath);
      return ok;
    },
    insertAfter(idPath, item) {
      const ok = insertRelative(getItems(), idPath, item, 'after');
      if (ok) render(); else warnMissing('insertAfter', idPath);
      return ok;
    },
    appendTo(idPath, item) {
      const ok = appendInside(getItems(), idPath, item);
      if (ok) render(); else warnMissing('appendTo', idPath);
      return ok;
    },
  };
}

module.exports = {
  findItem,
  findItemWithLocation,
  insertRelative,
  appendInside,
  updateItem,
  removeItem,
  buildIdApi,
};
