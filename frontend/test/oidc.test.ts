import { describe, it, expect, afterEach } from 'vitest';
import { isCloudRun, fetchIdToken } from '../server/utils/oidc';

const ORIGINAL_K_SERVICE = process.env.K_SERVICE;
const ORIGINAL_GCE_METADATA_HOST = process.env.GCE_METADATA_HOST;

afterEach(() => {
    if (ORIGINAL_K_SERVICE === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = ORIGINAL_K_SERVICE;
    if (ORIGINAL_GCE_METADATA_HOST === undefined) delete process.env.GCE_METADATA_HOST;
    else process.env.GCE_METADATA_HOST = ORIGINAL_GCE_METADATA_HOST;
});

describe('isCloudRun', () => {
    it('returns false when K_SERVICE is unset (local dev)', () => {
        delete process.env.K_SERVICE;
        expect(isCloudRun()).toBe(false);
    });

    it('returns false when K_SERVICE is empty', () => {
        process.env.K_SERVICE = '';
        expect(isCloudRun()).toBe(false);
    });

    it('returns true when K_SERVICE is set (Cloud Run)', () => {
        process.env.K_SERVICE = 'rag-frontend';
        expect(isCloudRun()).toBe(true);
    });
});

describe('fetchIdToken', () => {
    it('requests the identity token for the audience from the metadata server', async () => {
        const fetchMock = async (url: string, init?: RequestInit): Promise<Response> => {
            expect(url).toBe(
                'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https%3A%2F%2Frag-api.example.run.app',
            );
            expect(init?.headers).toEqual({ 'Metadata-Flavor': 'Google' });
            return new Response('the-token', { status: 200 });
        };

        const token = await fetchIdToken('https://rag-api.example.run.app', {
            fetch: fetchMock as typeof globalThis.fetch,
        });
        expect(token).toBe('the-token');
    });

    it('honours an injected metadata host', async () => {
        const fetchMock = async (url: string): Promise<Response> => {
            expect(url.startsWith('http://metadata.local/')).toBe(true);
            return new Response('tok', { status: 200 });
        };

        const token = await fetchIdToken('https://rag-api.example.run.app', {
            fetch: fetchMock as typeof globalThis.fetch,
            metadataHost: 'http://metadata.local',
        });
        expect(token).toBe('tok');
    });

    it('throws when the metadata server returns an error', async () => {
        const fetchMock = async (): Promise<Response> => new Response('nope', { status: 500 });

        await expect(
            fetchIdToken('https://rag-api.example.run.app', {
                fetch: fetchMock as typeof globalThis.fetch,
            }),
        ).rejects.toThrow('metadata token fetch failed: 500');
    });
});
