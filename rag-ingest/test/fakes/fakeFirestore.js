/**
 * In-memory Firestore-shaped test double for the seed job.
 *
 * Minimal surface used by `lib/*.js` in rag-ingest: `collection().doc().get()`,
 * `doc().set(data, {merge})`, `firestore.batch()` (with `.set/.commit`), and a
 * `store` Map for assertions. Self-contained so the package has no cross-package
 * dependency on rag-api's test fake.
 */

export function createFakeFirestore() {
  const store = new Map(); // NUL-joined path -> data object
  const key = (path) => path.join('\u0000');

  function set(path, data, opts = {}) {
    const k = key(path);
    const existing = store.get(k);
    if (opts.merge && existing) {
      store.set(k, { ...existing, ...data });
    } else {
      store.set(k, { ...data });
    }
  }

  function ref(path) {
    return {
      path, // expose full path so the batch can commit
      get id() {
        return path[path.length - 1];
      },
      collection(sub) {
        return new CollectionRef([...path, sub]);
      },
      async get() {
        const doc = store.get(key(path));
        return { exists: !!doc, data: () => doc };
      },
      async set(data, opts = {}) {
        set(path, data, opts);
      },
    };
  }

  class CollectionRef {
    constructor(path) {
      this._path = path;
    }
    doc(id) {
      return ref([...this._path, id]);
    }
  }

  return {
    store,
    collection(path) {
      return new CollectionRef(Array.isArray(path) ? path : [path]);
    },
    batch() {
      const ops = [];
      return {
        set(r, data, opts = {}) {
          ops.push({ path: r.path, data, merge: opts.merge });
          return this;
        },
        async commit() {
          for (const op of ops) set(op.path, op.data, { merge: op.merge });
          ops.length = 0;
        },
      };
    },
    // Expose a helper for tests to read raw doc data.
    get: (path) => store.get(key(path)) ?? null,
  };
}