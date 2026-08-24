/**
 * Manifest gate + finalizer.
 *
 * Domain 4, Steps 4.2 & 4.5. `corpus/manifest` is a single Firestore document
 * that records which corpus version is already embedded. If the stored version
 * matches `CURRENT_VERSION`, the seeder exits fast ("already seeded"); if it is
 * missing or differs, it proceeds. At the end it rewrites the manifest with the
 * final chunk count, model and dims.
 */

import type { Firestore } from './types/firestore.js';
import type { ManifestSummary, SeedGate } from './types/corpus.js';

const MANIFEST_DOC_PATH = ['corpus', 'manifest'] as const;

/**
 * Reads the stored manifest, or null when absent.
 * @param firestore Firestore-shaped backend.
 * @returns the stored manifest summary, or `null`.
 */
export async function readManifest(firestore: Firestore): Promise<ManifestSummary | null> {
  const ref = firestore.collection('corpus').doc('manifest');
  const snap = await ref.get();
  return snap.exists ? (snap.data() as ManifestSummary | undefined) ?? null : null;
}

/**
 * Decides whether a re-seed is needed.
 * @param manifest       stored manifest, or `null`.
 * @param currentVersion the version being seeded now.
 * @returns `{ needsSeed, reason }`.
 */
export function checkSeedNeeded(manifest: ManifestSummary | null, currentVersion: string): SeedGate {
  if (!manifest) {
    return { needsSeed: true, reason: 'manifest missing; seeding' };
  }
  if (manifest.version !== currentVersion) {
    return {
      needsSeed: true,
      reason: `manifest version ${manifest.version} != current ${currentVersion}; re-seeding`,
    };
  }
  return { needsSeed: false, reason: 'manifest version matches; already seeded' };
}

/**
 * Writes (overwrites) the manifest with the run summary.
 * @param firestore Firestore-shaped backend.
 * @param summary   `{ version, chunkCount, model, dims, createdAt }`.
 */
export async function writeManifest(firestore: Firestore, summary: ManifestSummary): Promise<void> {
  await firestore
    .collection(MANIFEST_DOC_PATH[0])
    .doc(MANIFEST_DOC_PATH[1])
    .set({
      version: summary.version,
      chunkCount: summary.chunkCount,
      model: summary.model,
      dims: summary.dims,
      createdAt: summary.createdAt,
    }, { merge: true });
}