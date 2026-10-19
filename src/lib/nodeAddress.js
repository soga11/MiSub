/**
 * nodeAddress.js —— 节点地址解析与 URI 重写
 *
 * 解决的问题：
 *   1. 原 extractHostAndPort 无法识别「裸 IPv6 + 端口」（会把 :52016 当成地址的一部分）
 *   2. 就地修改 IP / 端口时，需要把新值写回原始 URI，且 IPv6 必须补方括号
 *
 * 约定：
 *   - 对外展示 / 存储裸地址（不带方括号）
 *   - 写回 URI 时自动补 [ ]，格式 [addr]:port
 */

/* ---------------- 基础判定 ---------------- */

export function stripBrackets(s) {
    const t = String(s ?? '').trim();
    return t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
}

export function isIPv4(s) {
    const m = String(s).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    return m.slice(1).every((p) => {
        const n = Number(p);
        return n >= 0 && n <= 255 && String(n) === p;
    });
}

export function isIPv6(s) {
    const t = String(s);
    if (!t.includes(':') || !/^[0-9a-fA-F:]+$/.test(t)) return false;
    if ((t.match(/::/g) || []).length > 1) return false;
    const groups = t.split(':').filter(Boolean);
    if (groups.length > 8) return false;
    if (!groups.every((g) => g.length <= 4)) return false;
    if (t.includes('::')) return groups.length < 8;
    return groups.length === 8;
}

export function isValidPort(p) {
    const s = String(p ?? '').trim();
    if (!/^\d+$/.test(s)) return false;
    const n = Number(s);
    return n >= 1 && n <= 65535;
}

/* ---------------- host[:port] 解析（宽松） ---------------- */

/**
 * 解析 host[:port]，允许 IPv6 不带方括号。
 * 歧义规则：若整体是合法 IPv6，则视为「只有地址、没有端口」。
 */
export function parseHostPort(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return { host: '', port: null, isV6: false, ambiguous: false };

    if (raw.startsWith('[')) {
        const close = raw.indexOf(']');
        if (close > 0) {
            const host = raw.slice(1, close);
            const after = raw.slice(close + 1);
            const p = after.startsWith(':') ? after.slice(1) : null;
            return {
                host,
                port: p !== null && isValidPort(p) ? Number(p) : null,
                isV6: true,
                ambiguous: false,
            };
        }
    }

    const colonCount = (raw.match(/:/g) || []).length;

    if (colonCount <= 1) {
        const i = raw.lastIndexOf(':');
        if (i === -1) return { host: raw, port: null, isV6: false, ambiguous: false };
        const host = raw.slice(0, i);
        const p = raw.slice(i + 1);
        return {
            host,
            port: isValidPort(p) ? Number(p) : null,
            isV6: isIPv6(host),
            ambiguous: false,
        };
    }

    if (isIPv6(raw)) {
        return { host: raw, port: null, isV6: true, ambiguous: true };
    }

    const i = raw.lastIndexOf(':');
    const host = raw.slice(0, i);
    const p = raw.slice(i + 1);
    if (isIPv6(host) && isValidPort(p)) {
        return { host, port: Number(p), isV6: true, ambiguous: false };
    }

    return { host: raw, port: null, isV6: false, ambiguous: false };
}

/** 生成 [v6]:port / v4:port / host:port */
export function formatHostPort(host, port) {
    const h = stripBrackets(host);
    const base = isIPv6(h) ? `[${h}]` : h;
    if (port === null || port === undefined || port === '') return base;
    return `${base}:${port}`;
}

/* ---------------- URI 拆解 ---------------- */

/** 把 URI 拆成 scheme / userinfo / hostport / tail 四段 */
function splitUri(url) {
    const raw = String(url ?? '');
    const idx = raw.indexOf('://');
    if (idx === -1) return null;

    const scheme = raw.slice(0, idx);
    const rest = raw.slice(idx + 3);

    let end = rest.length;
    for (const ch of ['/', '?', '#']) {
        const i = rest.indexOf(ch);
        if (i !== -1 && i < end) end = i;
    }

    const authority = rest.slice(0, end);
    const tail = rest.slice(end);

    // 密码里可能含 @，用最后一个
    const at = authority.lastIndexOf('@');
    const userinfo = at >= 0 ? authority.slice(0, at) : '';
    const hostport = at >= 0 ? authority.slice(at + 1) : authority;

    return { scheme, userinfo, hasAt: at >= 0, hostport, tail };
}

/* ---------------- 对外接口 ---------------- */

/**
 * 从节点 URI 解析 host / port（比 lib/utils 的版本更严格，支持裸 IPv6+端口）
 * @returns {{ host: string, port: string }}
 */
export function parseNodeHostPort(url) {
    const raw = String(url ?? '');
    if (!raw) return { host: '', port: '' };

    const parts = splitUri(raw);
    if (!parts) return { host: '', port: '' };

    // vmess：base64 JSON
    if (parts.scheme.toLowerCase() === 'vmess') {
        try {
            const cfg = JSON.parse(atob(parts.hostport));
            return { host: cfg.add || '', port: String(cfg.port || '') };
        } catch {
            return { host: '', port: '' };
        }
    }

    // ss / ssr 纯 base64（无 @）：无法可靠定位 host:port，交给原逻辑
    if (['ss', 'ssr'].includes(parts.scheme.toLowerCase()) && !parts.hasAt) {
        return { host: '', port: '' };
    }

    const p = parseHostPort(parts.hostport);
    return { host: p.host, port: p.port === null ? '' : String(p.port) };
}

/**
 * 把新的 host / port 写回节点 URI
 * @returns {{ ok: boolean, url?: string, error?: string }}
 */
export function replaceHostPort(url, host, port) {
    const raw = String(url ?? '');
    const parts = splitUri(raw);
    if (!parts) return { ok: false, error: '无法解析节点链接' };

    const scheme = parts.scheme.toLowerCase();
    const cleanHost = stripBrackets(host);
    const portStr = port === null || port === undefined || port === '' ? '' : String(port);

    if (!cleanHost) return { ok: false, error: '地址不能为空' };
    if (portStr !== '' && !isValidPort(portStr)) {
        return { ok: false, error: '端口需为 1–65535 的整数' };
    }

    // vmess：改写 base64 JSON 中的 add / port
    if (scheme === 'vmess') {
        try {
            const cfg = JSON.parse(atob(parts.hostport));
            cfg.add = cleanHost;
            if (portStr !== '') cfg.port = portStr;
            const encoded = btoa(JSON.stringify(cfg));
            return { ok: true, url: `${parts.scheme}://${encoded}${parts.tail}` };
        } catch {
            return { ok: false, error: 'vmess 链接解析失败' };
        }
    }

    // ss / ssr 纯 base64：不支持就地改写
    if (['ss', 'ssr'].includes(scheme) && !parts.hasAt) {
        return { ok: false, error: '该格式（base64 编码）暂不支持就地修改地址' };
    }

    // 通用：重建 authority
    const newHostPort = formatHostPort(cleanHost, portStr === '' ? null : portStr);
    const prefix = `${parts.scheme}://${parts.userinfo}${parts.hasAt ? '@' : ''}`;
    return { ok: true, url: `${prefix}${newHostPort}${parts.tail}` };
}

/**
 * 规范化代理 URI：把 authority 中漏写方括号的 IPv6 自动补上
 * 用于「编辑手动节点」输入框的 paste / blur 处理
 */
export function normalizeProxyUri(uri) {
    const src = String(uri ?? '');
    const trimmed = src.trim();
    if (!trimmed) return { uri: src, changed: false, note: null };

    const parts = splitUri(trimmed);
    if (!parts) return { uri: src, changed: false, note: null };

    const scheme = parts.scheme.toLowerCase();
    if (scheme === 'vmess' || scheme === 'ssr') return { uri: src, changed: false, note: null };
    if (!parts.hostport) return { uri: src, changed: false, note: null };

    const parsed = parseHostPort(parts.hostport);
    if (!parsed.isV6) return { uri: src, changed: false, note: null };

    const rebuilt = formatHostPort(parsed.host, parsed.port);
    if (rebuilt === parts.hostport) return { uri: src, changed: false, note: null };

    const prefix = `${parts.scheme}://${parts.userinfo}${parts.hasAt ? '@' : ''}`;
    return {
        uri: prefix + rebuilt + parts.tail,
        changed: true,
        note:
            parsed.ambiguous && parsed.port === null
                ? '检测到合法 IPv6 但未识别出端口，已按「无端口」处理；如需指定端口请写成 [地址]:端口'
                : null,
    };
}
