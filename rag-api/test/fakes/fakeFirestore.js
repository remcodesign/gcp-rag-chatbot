/**
 * In-memory Firestore-shaped test double.
 *
 * Implements just enough of the `@google-cloud/firestore` surface that the
 * state store (Domain 2) and the RAG pipeline (Domain 3) use, so unit tests run
 * with zero cloud deps:
 *
 *   - `firestore.collection(path)` and nested sub-collections via
 *     `collectionRef.doc(id).collection(name)`
 *   - Document reads `ref.get()` and writes `ref.set(data, {merge})`,
 *     `ref.update(patch)`
 *   - `firestore.runTransaction(fn)` with a `Transaction` supporting
 *     `get(ref)`, `set(ref, data)`, `update(ref, patch)` (applied atomically)
 *   - Query building: `col.orderBy(field).startAfter(value).limit(n).get()`,
 *     which returns snapshot docs shaped as `{ data: () => obj }`
 *   - Vector search: `col.findNearest({...})` returning a query whose `get()`
 *     computes the configured distance measure, adds `distanceResultField`, and
 *     returns docs sorted nearest-first.
 *
 * Intentionally minimal — no auth, no composite indexes, no `batch()`, no
 * `.where()` filtering. Documents store their vector under a plain array field
 * (the real client uses `FieldValue.vector`; the elements are what matter here).
 */

/** Returns the cosine distance (1 - cosine similarity) between two vectors. */
function cosineDistance(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) {
    return Infinity;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1; // zero vectors are orthogonal-ish
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

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
    this._path = path; // collection path: ['sessions'] or ['chunks']
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

  findNearest(opts) {
    this._vectorQuery = opts;
    return this;
  }

  async get() {
    if (this._vectorQuery) {
      return this._vectorGetter();
    }
    const docs = this._owner.list(this._path, this._orderField, this._dir, this._startAfter);
    return {
      docs: docs.map((d) => ({
        data: () => d,
      })),
    };
  }

  _vectorGetter() {
    const { vectorField, queryVector, limit, distanceMeasure, distanceResultField, distanceThreshold } =
      this._vectorQuery;
    const distanceFn =
      distanceMeasure === 'EUCLIDEAN'
        ? (a, b) => {
            let s = 0;
            for (let i = 0; i < a.length; i += 1) s += (a[i] - b[i]) ** 2;
            return Math.sqrt(s);
          }
        : cosineDistance;

    const all = this._owner.list(this._path, null, 'asc', undefined);
    const scored = all
      .map((doc) => ({ doc, distance: distanceFn(doc[vectorField], queryVector) }))
      .filter((s) => distanceThreshold === undefined || s.distance <= distanceThreshold)
      .sort((x, y) => x.distance - y.distance)
      .slice(0, limit);

    return {
      docs: scored.map(({ doc, distance }) => ({
        data: () => {
          const { __id, ...copy } = doc;
          if (distanceResultField) copy[distanceResultField] = distance;
          return copy;
        },
        id: doc.__id,
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
 * A batched write object (used by the seed job in Domain 4). Mirrors the real
 * `WriteBatch` surface: `.set(ref, data, { merge })` accumulates, `.commit()`
 * applies atomically.
 */
class FakeWriteBatch {
  constructor(owner) {
    this._owner = owner;
    this.ops = [];
  }

  set(ref, data, opts = {}) {
    this.ops.push({ kind: 'set', path: ref._path, data, merge: !!opts.merge });
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      this._owner.set(op.path, op.data, { merge: op.merge });
    }
    this.ops = [];
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
      const docId = path[path.length - 1];
      const existing = store.get(k);
      if (opts.merge && existing) {
        const { __id, ...prev } = existing;
        const { __id: _incomingId, ...incoming } = data;
        store.set(k, { ...prev, ...incoming, __id: __id ?? docId });
      } else {
        const { __id, ...clean } = data;
        store.set(k, { ...clean, __id: docId });
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

    batch() {
      return new FakeWriteBatch(this);
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