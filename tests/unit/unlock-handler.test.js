// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { webcrypto } from 'node:crypto';
import { StorageFactory } from '../../functions/storage-adapter.js';
import {
    handleUnlockRequest,
    normalizeUnlockResult,
    normalizeUnlockSettings,
    nodeFingerprint,
} from '../../functions/modules/unlock-handler.js';

const key = 'test-only-runner-key-01234567890123456789';
const node = {
    id: 'n1',
    name: 'Private node',
    enabled: true,
    group: 'test',
    url: 'trojan://private-password@proxy.example.com:443#Private',
};
let mf, db, env;
const req = (path, body, token) =>
    new Request(`https://misub.example.com/api/unlock${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

beforeAll(async () => {
    vi.stubGlobal('crypto', webcrypto);
    mf = new Miniflare({
        modules: true,
        script: 'export default { fetch() { return new Response("ok"); } }',
        d1Databases: ['MISUB_DB'],
    });
    db = await mf.getD1Database('MISUB_DB');
    env = { MISUB_DB: db, UNLOCK_RUNNER_TOKEN: key };
});
afterAll(async () => {
    vi.restoreAllMocks();
    await mf.dispose();
    vi.unstubAllGlobals();
});
beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(StorageFactory, 'getStorageType').mockResolvedValue('d1');
    vi.spyOn(StorageFactory, 'createAdapter').mockReturnValue({
        getAllSubscriptions: vi.fn().mockResolvedValue([node]),
    });
    await handleUnlockRequest(req('/settings'), env);
    await db.batch(
        ['unlock_settings', 'unlock_jobs', 'unlock_results'].map((name) =>
            db.prepare(`DELETE FROM ${name}`)
        )
    );
});

describe('unlock validation and least privilege', () => {
    it('has an opt-in default and no raw runner secret in settings', async () => {
        const data = await (await handleUnlockRequest(req('/settings'), env)).json();
        expect(data.settings.enabled).toBe(false);
        expect(JSON.stringify(data)).not.toContain(key);
    });
    it('rejects unauthenticated runner requests before DB access', async () => {
        const response = await handleUnlockRequest(req('/runner/claim', {}, 'bad-token'), env, {
            runner: true,
        });
        expect(response.status).toBe(401);
    });
    it('runner credential cannot access admin settings or delete nodes', async () => {
        const response = await handleUnlockRequest(req('/settings', {}, key), env, {
            runner: true,
        });
        expect(response.status).toBe(404);
    });
    it('cannot export disabled checks or disabled nodes', async () => {
        expect(
            (
                await (
                    await handleUnlockRequest(req('/runner/claim', {}, key), env, { runner: true })
                ).json()
            ).job
        ).toBeNull();
    });
    it('validates provider selection, interval and groups', () => {
        expect(() =>
            normalizeUnlockSettings({ providers: ['bogus'], intervalHours: 12, groups: null })
        ).toThrow();
        expect(() =>
            normalizeUnlockSettings({ providers: ['youtube'], intervalHours: 5, groups: null })
        ).toThrow();
    });
    it('never persists arbitrary error messages containing node passwords', () => {
        const result = normalizeUnlockResult(
            [
                {
                    provider: 'youtube',
                    status: 'available',
                    region: 'not-a-region',
                    reason: node.url,
                },
            ],
            ['youtube', 'claude']
        );
        expect(JSON.stringify(result)).not.toContain('private-password');
        expect(result[0].region).toBe('');
        expect(result[1].status).toBe('unknown');
    });
    it('name-only change preserves fingerprint but password change invalidates it', async () => {
        expect(await nodeFingerprint(node)).toBe(
            await nodeFingerprint({ ...node, url: node.url.replace('#Private', '#renamed') })
        );
        expect(await nodeFingerprint(node)).not.toBe(
            await nodeFingerprint({ ...node, url: node.url.replace('private-password', 'changed') })
        );
    });
});

describe('unlock job lifecycle with real SQLite', () => {
    async function enable() {
        await handleUnlockRequest(
            req('/settings', {
                enabled: true,
                intervalHours: 12,
                providers: ['youtube', 'claude'],
                groups: null,
            }),
            env
        );
    }
    async function claim() {
        return (
            await (
                await handleUnlockRequest(req('/runner/claim', {}, key), env, { runner: true })
            ).json()
        ).job;
    }
    it('claims once, accepts sanitized results, and respects the 12-hour interval', async () => {
        await enable();
        const job = await claim();
        expect(job.nodes[0].proxy.password).toBe('private-password');
        expect(job.nodes[0]).not.toHaveProperty('url');
        expect(job.nodes[0].proxy.name).toBe('CHECK_NODE');
        expect(await claim()).toBeNull();
        const submitted = await handleUnlockRequest(
            req(
                '/runner/results',
                {
                    jobId: job.id,
                    results: [
                        {
                            id: 'n1',
                            fingerprint: job.nodes[0].fingerprint,
                            providers: [
                                {
                                    provider: 'youtube',
                                    status: 'available',
                                    region: 'HK',
                                    regionSource: 'service',
                                    reason: 'confirmed_marker',
                                },
                            ],
                        },
                    ],
                },
                key
            ),
            env,
            { runner: true }
        );
        expect((await submitted.json()).accepted).toBe(1);
        const result = await (await handleUnlockRequest(req('/results'), env)).json();
        expect(result.results.n1.providers[0].region).toBe('HK');
        expect(JSON.stringify(result)).not.toContain('private-password');
        expect(result.job.state).toBe('completed');
        expect(await claim()).toBeNull();
    });
    it('does not overwrite results if connection parameters changed during the job', async () => {
        await enable();
        const job = await claim();
        StorageFactory.createAdapter.mockReturnValue({
            getAllSubscriptions: vi
                .fn()
                .mockResolvedValue([
                    { ...node, url: node.url.replace('private-password', 'changed') },
                ]),
        });
        const response = await handleUnlockRequest(
            req(
                '/runner/results',
                {
                    jobId: job.id,
                    results: [{ id: 'n1', fingerprint: job.nodes[0].fingerprint, providers: [] }],
                },
                key
            ),
            env,
            { runner: true }
        );
        expect((await response.json()).accepted).toBe(0);
    });
    it('restricts scheduled exports to selected groups', async () => {
        await handleUnlockRequest(
            req('/settings', {
                enabled: true,
                intervalHours: 12,
                providers: ['youtube'],
                groups: ['different'],
            }),
            env
        );
        expect(await claim()).toBeNull();
    });
    it('manual requests cannot enqueue unselected/unsaved node IDs', async () => {
        await enable();
        const response = await handleUnlockRequest(req('/queue', { nodeIds: ['not-saved'] }), env);
        expect(response.status).toBe(400);
    });
});
