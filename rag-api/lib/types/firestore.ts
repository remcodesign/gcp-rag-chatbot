/**
 * Firestore-shaped boundary types.
 *
 * The runtime uses the real `@google-cloud/firestore` client; tests use an
 * in-memory fake (`test/fakes/fakeFirestore.ts`). Both satisfy these interfaces
 * so `lib/` depends only on the shape it needs (vector `findNearest`, docs,
 * transactions, batches). Only `src/server.ts` casts the real client to this
 * boundary.
 */

export interface FirestoreVectorQueryOptions {
    vectorField: string;
    queryVector: number[];
    limit: number;
    distanceMeasure: 'COSINE' | 'EUCLIDEAN';
    distanceResultField: string;
    distanceThreshold?: number;
}

export interface FirestoreDocumentData {
    [key: string]: unknown;
}

/** A read result from a `get()` query (has `.data()` + `.id`). */
export interface FirestoreQueryResult {
    readonly id: string;
    data(): FirestoreDocumentData | undefined;
}

export interface FirestoreDocumentSnapshot {
    readonly exists: boolean;
    data(): FirestoreDocumentData | undefined;
}

export interface FirestoreDocumentRef {
    readonly id: string;
    get(): Promise<FirestoreDocumentSnapshot>;
    set(data: FirestoreDocumentData, options?: { merge?: boolean }): Promise<void>;
    update(patch: Partial<FirestoreDocumentData>): Promise<void>;
    collection(id: string): FirestoreCollectionRef;
}

export interface FirestoreQuerySnapshot {
    readonly docs: Array<FirestoreQueryResult>;
}

export interface FirestoreCollectionRef {
    doc(id?: string): FirestoreDocumentRef;
    orderBy(field: string, direction?: 'asc' | 'desc'): FirestoreCollectionRef;
    startAfter(value: number | string): FirestoreCollectionRef;
    limit(limit?: number): FirestoreCollectionRef;
    findNearest(options: FirestoreVectorQueryOptions): FirestoreCollectionRef;
    get(): Promise<FirestoreQuerySnapshot>;
}

export interface FirestoreTransaction {
    get(ref: FirestoreDocumentRef): Promise<FirestoreDocumentSnapshot>;
    set(ref: FirestoreDocumentRef, data: FirestoreDocumentData): void;
    update(ref: FirestoreDocumentRef, patch: Partial<FirestoreDocumentData>): void;
}

/** The shape of a Firestore-shaped backend (real client or in-memory fake). */
export interface Firestore {
    collection(path: string | string[]): FirestoreCollectionRef;
    runTransaction<TResult>(fn: (txn: FirestoreTransaction) => Promise<TResult>): Promise<TResult>;
    /** Used by the readiness probe to verify the datastore is reachable. */
    listCollections(): Promise<unknown>;
    batch(): {
        set(
            ref: FirestoreDocumentRef,
            data: FirestoreDocumentData,
            options?: { merge?: boolean },
        ): unknown;
        commit(): Promise<void>;
    };
}
