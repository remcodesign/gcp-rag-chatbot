/**
 * Firestore-shaped boundary types for the seed job.
 *
 * The runtime uses the real `@google-cloud/firestore` client; tests use an
 * in-memory fake (`test/fakes/fakeFirestore.ts`). Both satisfy these interfaces
 * so `lib/` depends only on the shape it needs (docs + batches). Only
 * `src/cli.ts` casts the real client to this boundary.
 */

export interface FirestoreDocumentData {
    [key: string]: unknown;
}

export interface FirestoreDocumentSnapshot {
    readonly exists: boolean;
    data(): FirestoreDocumentData | undefined;
}

export interface FirestoreDocumentRef {
    readonly id: string;
    get(): Promise<FirestoreDocumentSnapshot>;
    set(data: FirestoreDocumentData, options?: { merge?: boolean }): Promise<void>;
    collection(id: string): FirestoreCollectionRef;
}

export interface FirestoreCollectionRef {
    doc(id?: string): FirestoreDocumentRef;
}

export interface FirestoreWriteBatch {
    set(
        ref: FirestoreDocumentRef,
        data: FirestoreDocumentData,
        options?: { merge?: boolean },
    ): FirestoreWriteBatch;
    commit(): Promise<void>;
}

/** The shape of a Firestore-shaped backend (real client or in-memory fake). */
export interface Firestore {
    collection(path: string | string[]): FirestoreCollectionRef;
    batch(): FirestoreWriteBatch;
}
