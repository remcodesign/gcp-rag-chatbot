/**
 * Manifest gate + finalizer.
 *
 * Domain 4, Steps 4.2 & 4.5. `corpus/manifest` is a single Firestore document
 * that records which corpus version is already embedded. If the stored version
 * matches `CURRENT_VERSION`, the seeder exits fast ("already seeded"); if it is
 * missing or differs, it proceeds. At the end it rewrites the manifest with the
 * final chunk count, model and dims.
 */

/**
 * Reads the stored manifest, or null when absent.
 * @param {object} firestore
 * @returns {Promise<object|null>}
 */
export async function readManifest(firestore) {
  const ref = firestore.collection('corpus').doc('manifest');
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

/**
 * Decides whether a re-seed is needed.
 * @param {object|null} manifest
 * @param {string} currentVersion
 * @returns {{ needsSeed: boolean, reason: string }}
 */
export function checkSeedNeeded(manifest, currentVersion) {
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
 * @param {object} firestore
 * @param {object} summary  `{ version, chunkCount, model, dims, createdAt }`.
 */
export async function writeManifest(firestore, summary) {
  await firestore.collection('corpus').doc('manifest').set(summary, { merge: true });
}