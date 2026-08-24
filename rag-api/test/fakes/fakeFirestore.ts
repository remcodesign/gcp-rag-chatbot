/**
 * In-memory Firestore-shaped test double.
 *
 * Implements the subset of the `@google-cloud/firestore` API that `lib/` uses
 * (collection/doc refs, `findNearest` vector queries, `runTransaction`, batches)
 * against an in-memory `Map`, so unit tests need zero cloud credentials. It is
 * typed against the `Firestore` interface in `lib/types.ts` so the same code
 * paths are exercised as with the real client.
 */

import type { FirestoreDocumentData } from '../../lib/types/firestore.js';
import type {
  Firestore,
  FirestoreCollectionRef,
  FirestoreDocumentRef,
  FirestoreDocumentSnapshot,
  FirestoreQuerySnapshot,
  FirestoreTransaction,
  FirestoreVectorQueryOptions,
} from '../../lib/types/firestore.js';

type DocId = string;

type StoredDoc = {
  __id: DocId;
  [key: string]: unknown;
};

function cosineDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return Infinity;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function euclideanDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(s);
}

type CollectionGetter = () => Promise<FirestoreQuerySnapshot>;

class FakeDocumentRef implements FirestoreDocumentRef {
  private readonly _path: string[];
  private readonly _owner: FakeFirestoreOwner;

  constructor(path: string[], owner: FakeFirestoreOwner) {
    this._path = path;
    this._owner = owner;
  }

  get id(): string {
    return this._path[this._path.length - 1] ?? '';
  }

  /** Expose the full path so the owner/transaction can address the doc. */
  path(): string[] {
    return [...this._path];
  }

  collection(sub: string): FirestoreCollectionRef {
    return new FakeCollectionRef(this._path.concat([sub]), this._owner);
  }

  async get(): Promise<FirestoreDocumentSnapshot> {
    const doc = this._owner.get(this._path);
    return { exists: !!doc, data: () => (doc ?? undefined) };
  }

  async set(data: FirestoreDocumentData, opts: { merge?: boolean } = {}): Promise<void> {
    this._owner.set(this._path, data, opts);
  }

  async update(patch: Partial<FirestoreDocumentData>): Promise<void> {
    this._owner.update(this._path, patch);
  }
}

class FakeCollectionRef implements FirestoreCollectionRef {
  private readonly _path: string[];
  private readonly _owner: FakeFirestoreOwner;
  private _orderField: string | null = null;
  private _dir: 'asc' | 'desc' = 'asc';
  private _startAfter: number | string | undefined;
  private _vectorQuery: (FirestoreVectorQueryOptions & {
    vectorField: string;
    queryVector: number[];
  }) | null = null;

  constructor(path: string[], owner: FakeFirestoreOwner) {
    this._path = path;
    this._owner = owner;
  }

  doc(id?: string): FirestoreDocumentRef {
    const docId = id ?? `doc_${this._owner.autoId()}`;
    return new FakeDocumentRef([...this._path, docId], this._owner);
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeCollectionRef {
    this._orderField = field;
    this._dir = dir;
    return this;
  }

  startAfter(value: number | string): FakeCollectionRef {
    this._startAfter = value;
    return this;
  }

  limit(): FakeCollectionRef {
    return this;
  }

  findNearest(options: FirestoreVectorQueryOptions): FakeCollectionRef {
    this._vectorQuery = options;
    return this;
  }

  async get(): Promise<FirestoreQuerySnapshot> {
    if (this._vectorQuery) return this._vectorGetter();
    const docs = this._owner.list(this._path, this._orderField, this._dir, this._startAfter);
    return {
      docs: docs.map((d) => ({ id: d.__id, data: () => d })),
    };
  }

  private _vectorGetter(): FirestoreQuerySnapshot {
    const {
      vectorField,
      queryVector,
      limit,
      distanceMeasure,
      distanceResultField,
      distanceThreshold,
    } = this._vectorQuery!;
    const distanceFn =
      distanceMeasure === 'EUCLIDEAN' ? euclideanDistance : cosineDistance;
    const all = this._owner.list(this._path, null, 'asc', undefined);
    const scored = all
      .map((doc) => ({ doc, distance: distanceFn(doc[vectorField] as number[], queryVector) }))
      .filter((s) => distanceThreshold === undefined || s.distance <= distanceThreshold)
      .sort((x, y) => x.distance - y.distance)
      .slice(0, limit);
    return {
      docs: scored.map(({ doc, distance }) => ({
        data: () => {
          const { __id, ...copy } = doc;
          const out = { ...copy } as FirestoreDocumentData;
          if (distanceResultField) out[distanceResultField] = distance;
          return out;
        },
        id: doc.__id,
      })),
    };
  }
}

interface PendingSet {
  kind: 'set' | 'update';
  path: string[];
  data?: FirestoreDocumentData;
  patch?: Partial<FirestoreDocumentData>;
}

class FakeTransaction implements FirestoreTransaction {
  private readonly _owner: FakeFirestoreOwner;
  readonly pending: PendingSet[] = [];

  constructor(owner: FakeFirestoreOwner) {
    this._owner = owner;
  }

  async get(ref: FirestoreDocumentRef) {
    const path = ref instanceof FakeDocumentRef ? ref.path() : [];
    const doc = this._owner.get(path);
    return { exists: !!doc, data: () => (doc ?? undefined) };
  }

  set(ref: FirestoreDocumentRef, data: FirestoreDocumentData): void {
    this.pending.push({ kind: 'set', path: this.pathOf(ref), data });
  }

  update(ref: FirestoreDocumentRef, patch: Partial<FirestoreDocumentData>): void {
    this.pending.push({ kind: 'update', path: this.pathOf(ref), patch });
  }

  private pathOf(ref: FirestoreDocumentRef): string[] {
    return ref instanceof FakeDocumentRef ? ref.path() : [];
  }
}

class FakeWriteBatch {
  private readonly _owner: FakeFirestoreOwner;
  private readonly ops: Array<{ kind: 'set'; path: string[]; data: FirestoreDocumentData; merge: boolean }> = [];

  constructor(owner: FakeFirestoreOwner) {
    this._owner = owner;
  }

  set(
    ref: FirestoreDocumentRef,
    data: FirestoreDocumentData,
    opts: { merge?: boolean } = {},
  ): FakeWriteBatch {
    this.ops.push({ kind: 'set', path: this.pathOf(ref), data, merge: !!opts.merge });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) this._owner.set(op.path, op.data, { merge: op.merge });
    this.ops.length = 0;
  }

  private pathOf(ref: FirestoreDocumentRef): string[] {
    return ref instanceof FakeDocumentRef ? ref.path() : [];
  }
}

/**
 * Structural owner passed to the refs/collections/transactions so they can
 * read/write the shared in-memory map.
 */
export interface FakeFirestoreOwner {
  readonly store: Map<string, StoredDoc>;
  autoId(): string;
  get(path: string[]): StoredDoc | null;
  set(path: string[], data: FirestoreDocumentData, opts?: { merge?: boolean }): void;
  update(path: string[], patch: Partial<FirestoreDocumentData>): void;
  list(
    path: string[],
    orderField: string | null,
    dir: 'asc' | 'desc',
    startAfter: number | string | undefined,
  ): StoredDoc[];
}

export interface FakeFirestore extends Firestore {
  readonly store: Map<string, StoredDoc>;
  autoId(): string;
  get(path: string[]): StoredDoc | null;
  set(path: string[], data: FirestoreDocumentData, opts?: { merge?: boolean }): void;
  update(path: string[], patch: Partial<FirestoreDocumentData>): void;
  list(
    path: string[],
    orderField: string | null,
    dir: 'asc' | 'desc',
    startAfter: number | string | undefined,
  ): StoredDoc[];
}

export function createFakeFirestore(): FakeFirestore {
  const store = new Map<string, StoredDoc>();
  let autoIdCounter = 0;
  const key = (path: string[]) => path.join('\u0000');

  const owner: FakeFirestoreOwner = {
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
      const docId = path[path.length - 1] ?? '';
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
      const next: StoredDoc = { ...existing };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined || value === null) delete next[field];
        else next[field] = value;
      }
      store.set(k, next);
    },
    list(path, orderField, dir, startAfter) {
      const prefix = key(path) + '\u0000';
      const matching: StoredDoc[] = [];
      for (const [k, data] of store.entries()) if (k.startsWith(prefix)) matching.push(data);
      if (orderField) {
        matching.sort((a, b) => {
          const av = a[orderField] as number | string;
          const bv = b[orderField] as number | string;
          return av === bv ? 0 : av < bv ? -1 : 1;
        });
      }
      if (dir === 'desc') matching.reverse();
      if (startAfter !== undefined) {
        const base = orderField as string | null;
        return matching.filter((d) => (base ? (d[base] as number | string) > startAfter : true));
      }
      return matching;
    },
  };

  const fake: FakeFirestore = {
    ...owner,
    collection(path: string | string[]): FirestoreCollectionRef {
      const segments = Array.isArray(path) ? path : [path];
      return new FakeCollectionRef(segments, owner);
    },
    batch() {
      return new FakeWriteBatch(owner);
    },
    async listCollections(): Promise<unknown> {
      return [];
    },
    async runTransaction<TResult>(fn: (txn: FirestoreTransaction) => Promise<TResult>): Promise<TResult> {
      const txn = new FakeTransaction(owner);
      const result = await fn(txn);
      for (const op of txn.pending) {
        if (op.kind === 'set') owner.set(op.path, op.data as FirestoreDocumentData);
        else if (op.kind === 'update') owner.update(op.path, op.patch ?? {});
      }
      return result;
    },
  };

  return fake;
}