import { StorageFactory } from '../storage-adapter.js';
import { isManualNode } from './external-api-mappers.js';
import { urlToClashProxy } from '../utils/url-to-clash.js';
import { createJsonResponse, readJsonWithLimit } from './utils.js';

export const UNLOCK_PROVIDERS = ['netflix', 'youtube', 'openai', 'claude'];
export const UNLOCK_STATUSES = [
    'available',
    'partial',
    'reachable',
    'restricted',
    'unsupported',
    'unknown',
    'error',
];
const MAX_NODES = 250;
const LEASE_MS = 25 * 60 * 1000;
const DEFAULT_SETTINGS = {
    enabled: false,
    intervalHours: 12,
    providers: UNLOCK_PROVIDERS,
    groups: null,
};

export async function nodeFingerprint(node) {
    const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(String(node.url || '').split('#')[0])
    );
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeUnlockSettings(input) {
    const providers = [
        ...new Set((input.providers || []).filter((p) => UNLOCK_PROVIDERS.includes(p))),
    ];
    if (!providers.length) throw new Error('请选择至少一个检测平台');
    if (![1, 12].includes(input.intervalHours)) throw new Error('检测间隔只能为 1 或 12 小时');
    if (
        input.groups !== null &&
        (!Array.isArray(input.groups) ||
            input.groups.length > 100 ||
            input.groups.some((g) => typeof g !== 'string' || g.length > 100))
    )
        throw new Error('节点分组格式不正确');
    return {
        enabled: input.enabled === true,
        intervalHours: input.intervalHours,
        providers,
        groups: input.groups === null ? null : [...new Set(input.groups)],
    };
}

export function normalizeUnlockResult(input, providers) {
    // Only allow fixed machine-readable reasons. Never persist upstream HTML, URLs, or errors
    // that might contain credentials into a publicly readable result or log.
    const reasons = [
        'confirmed_marker',
        'entry_reachable',
        'region_restricted',
        'originals_only',
        'premium_unsupported',
        'google_cn',
        'web_only',
        'app_only',
        'challenge',
        'http_error',
        'timeout',
        'network_error',
        'marker_missing',
        'unsupported_protocol',
        'invalid_node',
        'ipv6_unavailable',
        'core_failed',
    ];
    return providers.map((provider) => {
        const raw = Array.isArray(input) ? input.find((item) => item?.provider === provider) : null;
        return {
            provider,
            status: UNLOCK_STATUSES.includes(raw?.status) ? raw.status : 'unknown',
            region: /^[A-Z]{2}$/.test(raw?.region || '') ? raw.region : '',
            regionSource:
                raw?.regionSource === 'service'
                    ? 'service'
                    : raw?.regionSource === 'exit_ip'
                      ? 'exit_ip'
                      : '',
            reason: reasons.includes(raw?.reason) ? raw.reason : 'marker_missing',
        };
    });
}

async function schema(db) {
    await db.batch([
        db.prepare(
            'CREATE TABLE IF NOT EXISTS unlock_settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)'
        ),
        db.prepare(
            'CREATE TABLE IF NOT EXISTS unlock_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER)'
        ),
        db.prepare(
            'CREATE TABLE IF NOT EXISTS unlock_results (node_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL, checked_at INTEGER NOT NULL)'
        ),
    ]);
}

async function settings(db) {
    const row = await db.prepare('SELECT data FROM unlock_settings WHERE id=1').first();
    return row ? normalizeUnlockSettings(JSON.parse(row.data)) : { ...DEFAULT_SETTINGS };
}

async function nodes(env, config) {
    const type = await StorageFactory.getStorageType(env);
    const adapter = StorageFactory.createAdapter(env, type);
    const all = await adapter.getAllSubscriptions();
    return all.filter(
        (n) =>
            isManualNode(n) &&
            n.enabled !== false &&
            (config.groups === null || config.groups.includes(n.group || ''))
    );
}

async function snapshot(list) {
    return Promise.all(
        list.map(async (node) => ({ id: node.id, fingerprint: await nodeFingerprint(node) }))
    );
}

async function enqueue(db, config, list) {
    const id = crypto.randomUUID();
    const data = { providers: config.providers, nodes: await snapshot(list.slice(0, MAX_NODES)) };
    // Serialize enqueue with a single SQLite statement, also avoiding overlapping jobs.
    const result = await db
        .prepare(
            "INSERT INTO unlock_jobs (id,state,data,created_at) SELECT ?, 'queued', ?, ? WHERE NOT EXISTS (SELECT 1 FROM unlock_jobs WHERE state IN ('queued','running'))"
        )
        .bind(id, JSON.stringify(data), Date.now())
        .run();
    return result.meta?.changes ? id : null;
}

async function runnerAuth(request, env) {
    const key = env.UNLOCK_RUNNER_TOKEN;
    if (typeof key !== 'string' || key.length < 32) return false;
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (token.length > 256) return false;
    const hash = async (s) =>
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    const [a, b] = await Promise.all([hash(key), hash(token)]);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

const json = (data, status = 200) => {
    const response = createJsonResponse(data, status);
    response.headers.set('Cache-Control', 'no-store');
    return response;
};

export async function handleUnlockRequest(request, env, { runner = false } = {}) {
    if (runner && !(await runnerAuth(request, env))) return json({ error: 'Unauthorized' }, 401);
    if (!env.MISUB_DB) return json({ error: '解锁检测需要绑定 D1 数据库' }, 503);
    const path = new URL(request.url).pathname.replace(/^\/api\/unlock/, '');
    if (runner && !['/runner/claim', '/runner/results'].includes(path))
        return json({ error: 'Not Found' }, 404);
    try {
        const db = env.MISUB_DB;
        await schema(db);
        const config = await settings(db);
        if (!runner && path === '/settings') {
            if (request.method === 'GET')
                return json({
                    settings: config,
                    runnerConfigured:
                        typeof env.UNLOCK_RUNNER_TOKEN === 'string' &&
                        env.UNLOCK_RUNNER_TOKEN.length >= 32,
                    runnerRepo: env.UNLOCK_RUNNER_REPO || '',
                });
            if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
            const next = normalizeUnlockSettings(await readJsonWithLimit(request, 16384));
            await db
                .prepare(
                    'INSERT INTO unlock_settings (id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data'
                )
                .bind(JSON.stringify(next))
                .run();
            return json({ success: true, settings: next });
        }
        const list = await nodes(env, config);
        if (!runner && path === '/results' && request.method === 'GET') {
            const { results } = await db.prepare('SELECT * FROM unlock_results').all();
            const current = new Map((await snapshot(list)).map((n) => [n.id, n.fingerprint]));
            const mapped = {};
            for (const row of results || []) {
                if (!current.has(row.node_id)) continue;
                mapped[row.node_id] = {
                    ...JSON.parse(row.data),
                    checkedAt: row.checked_at,
                    stale: current.get(row.node_id) !== row.fingerprint,
                };
            }
            const job = await db
                .prepare(
                    'SELECT id,state,created_at,started_at,completed_at FROM unlock_jobs ORDER BY created_at DESC LIMIT 1'
                )
                .first();
            return json({ results: mapped, job });
        }
        if (!runner && path === '/queue' && request.method === 'POST') {
            if (!config.enabled) return json({ error: '请先在检测设置中启用解锁检测' }, 400);
            if (!env.UNLOCK_RUNNER_TOKEN || env.UNLOCK_RUNNER_TOKEN.length < 32)
                return json({ error: '尚未配置私有检测运行器密钥' }, 503);
            const payload = await readJsonWithLimit(request, 32768);
            if (
                !Array.isArray(payload.nodeIds) ||
                payload.nodeIds.length > MAX_NODES ||
                !payload.nodeIds.every((id) => typeof id === 'string')
            )
                return json({ error: '节点范围格式不正确' }, 400);
            const selected = list.filter((n) => payload.nodeIds.includes(n.id));
            if (!selected.length)
                return json({ error: '没有已保存、启用且处于检测范围的节点' }, 400);
            const id = await enqueue(db, config, selected);
            return json({
                success: true,
                queued: !!id,
                message: id
                    ? '已加入检测队列，等待私有运行器执行（通常下一次小时轮询）'
                    : '已有任务等待或正在执行，请稍后再试',
            });
        }
        if (runner && path === '/runner/claim' && request.method === 'POST') {
            if (!config.enabled) return json({ job: null });
            const now = Date.now();
            await db
                .prepare(
                    "UPDATE unlock_jobs SET state='expired',completed_at=? WHERE state='running' AND started_at < ?"
                )
                .bind(now, now - LEASE_MS)
                .run();
            if (
                await db.prepare("SELECT id FROM unlock_jobs WHERE state='running' LIMIT 1").first()
            )
                return json({ job: null });
            let job = await db
                .prepare(
                    "SELECT * FROM unlock_jobs WHERE state='queued' ORDER BY created_at LIMIT 1"
                )
                .first();
            if (!job) {
                const last = await db
                    .prepare('SELECT created_at FROM unlock_jobs ORDER BY created_at DESC LIMIT 1')
                    .first();
                if (last && now - last.created_at < config.intervalHours * 3600000)
                    return json({ job: null });
                if (!list.length) return json({ job: null });
                await enqueue(db, config, list);
                job = await db
                    .prepare(
                        "SELECT * FROM unlock_jobs WHERE state='queued' ORDER BY created_at LIMIT 1"
                    )
                    .first();
            }
            if (!job) return json({ job: null });
            const update = await db
                .prepare(
                    "UPDATE unlock_jobs SET state='running',started_at=? WHERE id=? AND state='queued'"
                )
                .bind(now, job.id)
                .run();
            if (!update.meta?.changes) return json({ job: null });
            const data = JSON.parse(job.data);
            const expected = new Map(data.nodes.map((n) => [n.id, n.fingerprint]));
            const exports = [];
            for (const node of list) {
                if (expected.get(node.id) !== (await nodeFingerprint(node))) continue;
                let proxy = null;
                try {
                    proxy = urlToClashProxy(node.url);
                } catch {
                    /* never log node URLs */
                }
                if (proxy) {
                    proxy.name = 'CHECK_NODE';
                    delete proxy['dialer-proxy'];
                }
                exports.push({ id: node.id, fingerprint: expected.get(node.id), proxy });
            }
            return json({ job: { id: job.id, providers: data.providers, nodes: exports } });
        }
        if (runner && path === '/runner/results' && request.method === 'POST') {
            const body = await readJsonWithLimit(request, 512 * 1024);
            const job =
                typeof body.jobId === 'string'
                    ? await db
                          .prepare("SELECT * FROM unlock_jobs WHERE id=? AND state='running'")
                          .bind(body.jobId)
                          .first()
                    : null;
            if (!job || Date.now() - job.started_at > LEASE_MS)
                return json({ error: '任务不存在或已过期' }, 409);
            if (!Array.isArray(body.results) || body.results.length > MAX_NODES)
                return json({ error: '检测结果格式不正确' }, 400);
            const data = JSON.parse(job.data);
            const expected = new Map(data.nodes.map((n) => [n.id, n.fingerprint]));
            const current = new Map((await snapshot(list)).map((n) => [n.id, n.fingerprint]));
            const statements = [];
            const seen = new Set();
            for (const item of body.results) {
                if (
                    seen.has(item.id) ||
                    !expected.has(item.id) ||
                    item.fingerprint !== expected.get(item.id) ||
                    current.get(item.id) !== item.fingerprint
                )
                    continue;
                seen.add(item.id);
                const result = { providers: normalizeUnlockResult(item.providers, data.providers) };
                statements.push(
                    db
                        .prepare(
                            'INSERT INTO unlock_results (node_id,fingerprint,data,checked_at) VALUES(?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET fingerprint=excluded.fingerprint,data=excluded.data,checked_at=excluded.checked_at'
                        )
                        .bind(item.id, item.fingerprint, JSON.stringify(result), Date.now())
                );
            }
            // D1 batches stay small and results never modify the subscription/node tables.
            for (let i = 0; i < statements.length; i += 40)
                await db.batch(statements.slice(i, i + 40));
            await db
                .prepare(
                    "UPDATE unlock_jobs SET state='completed',completed_at=? WHERE id=? AND state='running'"
                )
                .bind(Date.now(), job.id)
                .run();
            await db
                .prepare(
                    "DELETE FROM unlock_jobs WHERE created_at < ? AND state NOT IN ('queued','running')"
                )
                .bind(Date.now() - 30 * 86400000)
                .run();
            await db
                .prepare('DELETE FROM unlock_results WHERE checked_at < ?')
                .bind(Date.now() - 30 * 86400000)
                .run();
            return json({ success: true, accepted: seen.size });
        }
        return json({ error: 'Not Found' }, 404);
    } catch (error) {
        // Deliberately do not expose DB errors or upstream parser exceptions.
        return json(
            {
                error:
                    error?.message?.startsWith('请选择') ||
                    error?.message?.startsWith('检测间隔') ||
                    error?.message === '节点分组格式不正确'
                        ? error.message
                        : '解锁检测请求失败，请检查服务配置',
            },
            400
        );
    }
}
