/**
 * OIDC helpers for the Nitro BFF.
 *
 * On Cloud Run the Nitro service proxies to the PRIVATE rag-api using its own
 * service identity (IAM): it mints an OIDC token for the rag-api audience from
 * the instance metadata server and sends it as a Bearer token. Locally
 * (`nuxt dev`) there is no metadata server and a locally-run rag-api is not
 * IAM-protected, so no token is minted.
 *
 * `isCloudRun()` is the switch: Cloud Run always sets `K_SERVICE`, so the
 * token is only minted when the Nitro server actually runs on Cloud Run.
 */

/** Injectable fetch + metadata host so tests need no cloud credentials. */
export interface OidcDeps {
    fetch: typeof globalThis.fetch;
    /** Metadata server base URL (defaults to the GCE metadata server). */
    metadataHost?: string;
}

/**
 * Whether the Nitro server is running on Cloud Run. Cloud Run sets `K_SERVICE`
 * for every revision; it is unset locally, so this cleanly separates the
 * IAM-token path (Cloud Run) from the no-auth local path.
 */
export function isCloudRun(): boolean {
    const service = process.env.K_SERVICE;
    return service !== undefined && service !== '';
}

/**
 * Fetches an OIDC token for the Nitro service's identity, targeting the
 * rag-api audience. On Cloud Run the metadata server is reachable at
 * `http://metadata.google.internal`.
 */
export async function fetchIdToken(
    audience: string,
    deps: OidcDeps = { fetch: globalThis.fetch },
): Promise<string> {
    const base =
        deps.metadataHost ?? process.env.GCE_METADATA_HOST ?? 'http://metadata.google.internal';
    const url = `${base}/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
    const res = await deps.fetch(url, {
        headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!res.ok) {
        throw new Error(`metadata token fetch failed: ${res.status}`);
    }
    return res.text();
}
