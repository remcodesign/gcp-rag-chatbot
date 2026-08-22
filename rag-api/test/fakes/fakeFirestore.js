/**
 * In-memory Firestore-shaped test double.
 *
 * Implements just enough of the `@google-cloud/firestore` surface that
 * `sessionStore.js` uses, so Domain 2 unit tests run with zero cloud deps:
 *
 *   - `firestore.collection(path)` and nested sub-collections via
 *     `collectionRef.doc(id).collection(name)`
 *   - Document reads `ref.get()` and writes `ref.set(data, {merge})`,
 *     `ref.update(patch)`
 *   - `firestore.runTransaction(fn)` with a `Transaction` supporting
 *     `get(ref)`, `set(ref, data)`, `update(ref, patch)` (applied atomically)
 *   - Query building: `col.orderBy(field).startAfter(value).limit(n).get()`,
 *     which returns snapshot docs shaped as `{ data: () => obj }`
 *
 * Intentionally minimal — no auth, no composite indexes, no `batch()`, no
 * `.where()`, no vector search. Those belong to later domains.
 */

class FakeDocumentRef {
  constructor(path, owner) {
    this._path = path; // full doc path: ['sessions', id, 'events', eid]
    this._owner = owner;
  }

  get id() {
    return this._path[this._path.length - 1];
  }

  collection(sub) {
    return new FakeCollectionRef(this._path.concat([sub]), this._owner);
  }

  async get() {
    const doc = this._owner.get(this._path);
    return { exists: !!doc, data: () => doc };
  }

  async set(data, opts = {}) {
    this._owner.set(this._path, data, opts);
  }

  async update(patch) {
    this._owner.update(this._path, patch);
  }
}

class FakeCollectionRef {
  constructor(path, owner) {
    this._path = path; // collection path: ['sessions'] or ['sessions', id, 'events']
    this._owner = owner;
  }

  doc(id) {
    const docId = id ?? `doc_${this._owner.autoId()}`;
    return new FakeDocumentRef([...this._path, docId], this._owner);
  }

  orderBy(field, dir = 'asc') {
    this._orderField = field;
    this._dir = dir;
    return this;
  }

  startAfter(value) {
    this._startAfter = value;
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    const docs = this._owner.list(this._path, this._orderField, this._dir, this._startAfter);
    return {
      docs: docs.map((d) => ({
        data: () => d,
      })),
    };
  }
}

class FakeTransaction {
  constructor(owner) {
    this._owner = owner;
    this.pending = [];
  }

  async get(ref) {
    const doc = this._owner.get(ref._path);
    return { exists: !!doc, data: () => doc };
  }

  set(ref, data) {
    this.pending.push({ kind: 'set', path: ref._path, data });
  }

  update(ref, patch) {
    this.pending.push({ kind: 'update', path: ref._path, patch });
  }
}

/**
 * Creates an in-memory Firestore fake.
 *
 * @returns {{ collection: Function, runTransaction: Function, store: Map, autoId: Function }}
 */
export function createFakeFirestore() {
  const store = new Map(); // NUL-joined path -> data object
  let autoIdCounter = 0;

  const key = (path) => path.join('\u0000');

  return {
    store,

    autoId() {
      autoIdCounter += 1;
      return String(autoIdCounter);
    },

    get(path) {
      return store.get(key(path)) ?? null;
    },

    set(path, data, opts = {}) {
      const k = key(path);
      const existing = store.get(k);
      if (opts.merge && existing) {
        store.set(k, { ...existing, ...data });
      } else {
        store.set(k, { ...data });
      }
    },

    update(path, patch) {
      const k = key(path);
      const existing = store.get(k);
      if (!existing) return;
      const next = { ...existing };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined || value === null) delete next[field];
        else next[field] = value;
      }
      store.set(k, next);
    },

    list(path, orderField, dir, startAfter) {
      const prefix = key(path) + '\u0000';
      const matching = [];
      for (const [k, data] of store.entries()) {
        if (k.startsWith(prefix)) matching.push(data);
      }
      if (orderField) {
        matching.sort((a, b) => {
          const av = a[orderField];
          const bv = b[orderField];
          if (av === bv) return 0;
          return av < bv ? -1 : 1;
        });
      }
      if (dir === 'desc') matching.reverse();
      if (startAfter !== undefined) {
        return matching.filter((d) => d[orderField] > startAfter);
      }
      return matching;
    },

    collection(path) {
      const segments = Array.isArray(path) ? path : [path];
      return new FakeCollectionRef(segments, this);
    },

    async runTransaction(fn) {
      const txn = new FakeTransaction(this);
      const result = await fn(txn);
      for (const op of txn.pending) {
        if (op.kind === 'set') this.set(op.path, op.data);
        else if (op.kind === 'update') this.update(op.path, op.patch);
      }
      return result;
    },
  };
}