/**
 * In-memory Firestore-shaped test double for the seed job.
 *
 * Minimal surface used by `lib/*.ts` in rag-ingest: `collection().doc().get()`,
 * `doc().set(data, {merge})`, `firestore.batch()` (with `.set/.commit`), and a
 * `store` Map for assertions. Self-contained so the package has no cross-package
 * dependency on rag-api's test fake. Typed against the `Firestore` boundary in
 * `lib/types/firestore.ts`.
 */

import type {
    Firestore,
    FirestoreCollectionRef,
    FirestoreDocumentData,
    FirestoreDocumentRef,
    FirestoreDocumentSnapshot,
    FirestoreWriteBatch,
} from '../../lib/types/firestore.js';

type DocPath = string[];
type StoredDoc = { [key: string]: unknown };

function createKey(path: DocPath): string {
    return path.join('\u0000');
}

/**
 * Owns the read/write logic over a shared in-memory Map so document refs and
 * batches both address the same store.
 */
class FakeWriteEngine {
    readonly store: Map<string, StoredDoc>;

    constructor(store: Map<string, StoredDoc> = new Map<string, StoredDoc>()) {
        this.store = store;
    }

    get(path: DocPath): StoredDoc | null {
        return this.store.get(createKey(path)) ?? null;
    }

    set(path: DocPath, data: FirestoreDocumentData, opts: { merge?: boolean } = {}): void {
        const k = createKey(path);
        const existing = this.store.get(k);
        if (opts.merge && existing) this.store.set(k, { ...existing, ...data });
        else this.store.set(k, { ...data });
    }
}

class FakeDocumentRef implements FirestoreDocumentRef {
    private readonly _path: DocPath;
    private readonly _owner: FakeWriteEngine;

    constructor(path: DocPath, owner: FakeWriteEngine) {
        this._path = path;
        this._owner = owner;
    }

    get id(): string {
        return this._path[this._path.length - 1] ?? '';
    }

    path(): DocPath {
        return [...this._path];
    }

    collection(id: string): FirestoreCollectionRef {
        return new FakeCollectionRef(this._path.concat([id]), this._owner);
    }

    async get(): Promise<FirestoreDocumentSnapshot> {
        const doc = this._owner.get(this._path);
        return { exists: !!doc, data: () => doc ?? undefined };
    }

    async set(data: FirestoreDocumentData, opts: { merge?: boolean } = {}): Promise<void> {
        this._owner.set(this._path, data, opts);
    }
}

class FakeCollectionRef implements FirestoreCollectionRef {
    private readonly _path: DocPath;
    private readonly _owner: FakeWriteEngine;

    constructor(path: DocPath, owner: FakeWriteEngine) {
        this._path = path;
        this._owner = owner;
    }

    doc(id?: string): FakeDocumentRef {
        const docId = id ?? `doc_${this._owner.store.size}`;
        return new FakeDocumentRef([...this._path, docId], this._owner);
    }
}

class FakeWriteBatch implements FirestoreWriteBatch {
    private readonly _owner: FakeWriteEngine;
    private readonly ops: Array<{ path: DocPath; data: FirestoreDocumentData; merge: boolean }> =
        [];

    constructor(owner: FakeWriteEngine) {
        this._owner = owner;
    }

    set(
        ref: FirestoreDocumentRef,
        data: FirestoreDocumentData,
        opts: { merge?: boolean } = {},
    ): FirestoreWriteBatch {
        const path = ref instanceof FakeDocumentRef ? ref.path() : [];
        this.ops.push({ path, data, merge: !!opts.merge });
        return this;
    }

    async commit(): Promise<void> {
        for (const op of this.ops) this._owner.set(op.path, op.data, { merge: op.merge });
        this.ops.length = 0;
    }
}

export interface FakeFirestore extends Firestore {
    readonly store: Map<string, StoredDoc>;
    get(path: DocPath): StoredDoc | null;
    set(path: DocPath, data: FirestoreDocumentData, opts?: { merge?: boolean }): void;
}

/**
 * Creates an in-memory, Firestore-shaped fake.
 */
export function createFakeFirestore(): FakeFirestore {
    const engine = new FakeWriteEngine();

    return {
        store: engine.store,
        get: (path: DocPath) => engine.get(path),
        set: (path: DocPath, data: FirestoreDocumentData, opts?: { merge?: boolean }) =>
            engine.set(path, data, opts),

        collection(path: string | string[]): FirestoreCollectionRef {
            return new FakeCollectionRef(Array.isArray(path) ? path : [path], engine);
        },

        batch(): FirestoreWriteBatch {
            return new FakeWriteBatch(engine);
        },
    };
}
