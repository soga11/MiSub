/**
 * 内置 Sing-Box 配置生成器
 * 将节点 URL 列表转换为基础可用的 sing-box JSON 配置。
 */

import { urlToClashProxy, urlsToClashProxies } from '../../utils/url-to-clash.js';
import { getUniqueName } from './name-utils.js';
import { groupNodeLinesByRegion } from './region-groups.js';
import {
    POLICY_GROUPS,
    getBuiltinRules,
    getRemoteProviderDefinitions,
    getSingboxDnsRuleSet,
    DEFAULT_SELECT_GROUP,
    DEFAULT_RELAY_GROUP,
    pruneProxyGroups,
} from './builtin-rules-provider.js';
import { buildSingboxDnsConfig, DNS_PROXY_GROUP, SINGBOX_CN_RULE_SET } from './safe-dns.js';
import { buildModernSingboxConfig } from './modern-singbox-config.js';

function cleanControlChars(str) {
    if (typeof str !== 'string') return str;
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function sanitizeName(name) {
    if (!name) return 'Untitled';
    let safe = cleanControlChars(name);
    safe = safe
        .replace(/\s+/g, ' ')
        .replace(/[\r\n\t]/g, ' ')
        .trim();
    return safe || 'Untitled';
}

function parsePort(port) {
    const num = Number.parseInt(String(port), 10);
    return Number.isFinite(num) ? num : undefined;
}

function buildOutbound(proxy) {
    if (!proxy || !proxy.server || !proxy.port) return null;

    const type = (proxy.type || '').toLowerCase();
    const tag = sanitizeName(proxy.name);
    const server = proxy.server;
    const port = parsePort(proxy.port);
    if (!port) return null;

    const outbound = { tag, type: 'direct' };

    if (type === 'ss' || type === 'shadowsocks') {
        outbound.type = 'shadowsocks';
        outbound.server = server;
        outbound.server_port = port;
        outbound.method = proxy.cipher || 'aes-128-gcm';
        outbound.password = proxy.password || '';
        if (proxy.udp) outbound.udp_over_tcp = false;

        // sing-box 的 Shadowsocks 出站使用 SIP003 plugin/plugin_opts；
        // `transport` 仅属于 V2Ray 传输协议，SFA 会严格拒绝它。
        const plugin = proxy.plugin || '';
        const opts = proxy['plugin-opts'] || proxy.pluginOpts || {};
        if (plugin === 'v2ray-plugin' || opts.mode === 'websocket') {
            outbound.plugin = 'v2ray-plugin';
            const pluginOptions = ['mode=websocket'];
            if (opts.host) pluginOptions.push(`host=${opts.host}`);
            if (opts.path) pluginOptions.push(`path=${opts.path}`);
            if (opts.tls || opts.mode === 'websocket-tls') pluginOptions.push('tls');
            outbound.plugin_opts = pluginOptions.join(';');
        }
    } else if (type === 'vmess') {
        outbound.type = 'vmess';
        outbound.server = server;
        outbound.server_port = port;
        outbound.uuid = proxy.uuid || '';
        outbound.security = proxy.cipher || 'auto';
        outbound.alter_id = Number.isFinite(Number(proxy.alterId)) ? Number(proxy.alterId) : 0;
        if (proxy.tls || proxy.sni || proxy.servername || proxy['skip-cert-verify']) {
            outbound.tls = {
                enabled: true,
                server_name: proxy.sni || proxy.servername || server,
            };
            if (proxy['skip-cert-verify'] === true || proxy.skipCertVerify === true) {
                outbound.tls.insecure = true;
            }
        }
        outbound.transport = {
            type: proxy.network === 'ws' ? 'ws' : 'tcp',
        };
        if (proxy['ws-opts']?.path || proxy.wsOpts?.path) {
            outbound.transport.path = proxy['ws-opts']?.path || proxy.wsOpts?.path;
        }
        const host = proxy['ws-opts']?.headers?.Host || proxy.wsOpts?.headers?.Host;
        if (host) outbound.transport.headers = { Host: host };
    } else if (type === 'vless') {
        outbound.type = 'vless';
        outbound.server = server;
        outbound.server_port = port;
        outbound.uuid = proxy.uuid || '';
        if (proxy.network) {
            outbound.transport = { type: proxy.network };
            if (proxy.network === 'ws') {
                const wsOpts = proxy['ws-opts'] || proxy.wsOpts;
                if (wsOpts?.path) outbound.transport.path = wsOpts.path;
                if (wsOpts?.headers?.Host)
                    outbound.transport.headers = { Host: wsOpts.headers.Host };
            } else if (proxy.network === 'grpc') {
                const grpcOpts = proxy['grpc-opts'] || proxy.grpcOpts;
                if (grpcOpts?.['grpc-service-name'])
                    outbound.transport.service_name = grpcOpts['grpc-service-name'];
            } else if (proxy.network === 'xhttp') {
                const xhttpOpts = proxy['xhttp-opts'] || proxy.xhttpOpts;
                if (xhttpOpts?.path) outbound.transport.path = xhttpOpts.path;
                if (xhttpOpts?.host) outbound.transport.host = xhttpOpts.host;
                if (xhttpOpts?.mode) outbound.transport.mode = xhttpOpts.mode;
            }
        }
        if (proxy.flow) outbound.flow = proxy.flow;
        if (proxy.reality_opts || proxy['reality-opts']) {
            const reality = proxy.reality_opts || proxy['reality-opts'];
            outbound.tls = {
                enabled: true,
                server_name: proxy.sni || proxy.servername || server,
                utls: { enabled: true, fingerprint: proxy['client-fingerprint'] || 'chrome' },
                reality: {
                    enabled: true,
                    public_key: reality['public-key'] || reality.public_key,
                    short_id: reality['short-id'] || reality.short_id,
                },
            };
        }
    } else if (type === 'trojan') {
        outbound.type = 'trojan';
        outbound.server = server;
        outbound.server_port = port;
        outbound.password = proxy.password || '';
        outbound.tls = {
            enabled: true,
            server_name: proxy.sni || proxy.servername || server,
        };
        if (proxy.network === 'ws') {
            const wsOpts = proxy['ws-opts'] || proxy.wsOpts;
            outbound.transport = {
                type: 'ws',
                path: wsOpts?.path || '/',
                headers: wsOpts?.headers || {},
            };
        }
    } else if (type === 'hysteria2' || type === 'hy2') {
        outbound.type = 'hysteria2';
        outbound.server = server;
        outbound.server_port = port;
        outbound.password = proxy.password || '';
        outbound.tls = {
            enabled: true,
            server_name: proxy.sni || proxy.servername || server,
        };
    } else if (type === 'tuic') {
        outbound.type = 'tuic';
        outbound.server = server;
        outbound.server_port = port;
        outbound.uuid = proxy.uuid || '';
        outbound.password = proxy.password || '';

        const congestionControl =
            proxy['congestion-controller'] || proxy['congestion-control'] || proxy.congestion;
        if (congestionControl) outbound.congestion_control = congestionControl;
        if (proxy['udp-relay-mode']) outbound.udp_relay_mode = proxy['udp-relay-mode'];
        if (proxy['udp-over-stream'] !== undefined)
            outbound.udp_over_stream = Boolean(proxy['udp-over-stream']);
        if (proxy['zero-rtt-handshake'] !== undefined || proxy['reduce-rtt'] !== undefined) {
            outbound.zero_rtt_handshake = Boolean(
                proxy['zero-rtt-handshake'] ?? proxy['reduce-rtt']
            );
        }
        if (proxy.heartbeat) outbound.heartbeat = String(proxy.heartbeat);
        if (proxy.network) outbound.network = proxy.network;

        outbound.tls = {
            enabled: true,
            server_name: proxy.sni || proxy.servername || server,
        };
        if (proxy.alpn) outbound.tls.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
    } else if (type === 'anytls') {
        outbound.type = 'anytls';
        outbound.server = server;
        outbound.server_port = port;
        outbound.password = proxy.password || '';
        outbound.tls = {
            enabled: true,
            server_name: proxy.sni || proxy.servername || server,
        };
    } else if (type === 'snell') {
        outbound.type = 'snell';
        outbound.server = server;
        outbound.server_port = port;
        outbound.psk = proxy.psk || proxy.password || '';
        if (proxy.version) outbound.version = Number(proxy.version);
    } else if (type === 'wireguard') {
        outbound.type = 'wireguard';
        outbound.server = server;
        outbound.server_port = port;
        outbound.private_key = proxy['private-key'] || '';
        outbound.local_address = Array.isArray(proxy.ip) ? proxy.ip : proxy.ip ? [proxy.ip] : [];
        outbound.peer_public_key = proxy['public-key'] || '';
        outbound.pre_shared_key = proxy['preshared-key'] || '';
        outbound.reserved = proxy.reserved;
    } else if (type === 'http' || type === 'https') {
        outbound.type = 'http';
        outbound.server = server;
        outbound.server_port = port;
        if (proxy.username) outbound.username = proxy.username;
        if (proxy.password) outbound.password = proxy.password;
        if (type === 'https') {
            outbound.tls = {
                enabled: true,
                server_name: proxy.sni || proxy.servername || server,
            };
        }
    } else if (type === 'socks5' || type === 'socks5-tls') {
        outbound.type = 'socks';
        outbound.server = server;
        outbound.server_port = port;
        if (proxy.username) outbound.username = proxy.username;
        if (proxy.password) outbound.password = proxy.password;
        if (type === 'socks5-tls') {
            outbound.tls = {
                enabled: true,
                server_name: proxy.sni || proxy.servername || server,
            };
        }
    } else {
        return null;
    }

    if (proxy['skip-cert-verify'] === true || proxy.skipCertVerify === true) {
        outbound.tls = outbound.tls || {};
        outbound.tls.enabled = true;
        outbound.tls.insecure = true;
    }
    if (
        (proxy.sni || proxy.servername) &&
        ((type !== 'ss' && type !== 'shadowsocks') || proxy.tls || outbound.tls?.enabled)
    ) {
        outbound.tls = outbound.tls || {};
        outbound.tls.server_name = proxy.sni || proxy.servername;
    }
    if (proxy['client-fingerprint']) {
        outbound.tls = outbound.tls || {};
        outbound.tls.utls = { enabled: true, fingerprint: proxy['client-fingerprint'] };
    }

    if (proxy.tfo) {
        outbound.tcp_fast_open = true;
    }

    return outbound;
}

export function generateBuiltinSingboxConfig(nodeList, options = {}) {
    const {
        managedConfigUrl = '',
        skipCertVerify = false,
        enableUdp = false,
        enableTfo = false,
        ruleLevel = 'std',
    } = options;

    const cleanedNodeList = cleanControlChars(nodeList);
    const nodeUrls = cleanedNodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

    const outbounds = [];
    const usedNames = new Map();
    const nodeEntries = [];

    const proxies = urlsToClashProxies(nodeUrls, options);

    // 应用 UDP 开关
    // (已在 urlsToClashProxies 中全局处理)

    for (const clashProxy of proxies) {
        const baseName = sanitizeName(clashProxy.name);
        clashProxy.name = getUniqueName(baseName, usedNames);

        const outbound = buildOutbound(clashProxy);
        if (outbound) {
            outbounds.push(outbound);
            nodeEntries.push({ tag: outbound.tag, outbound });
        }
    }

    if (outbounds.length === 0) {
        outbounds.push({ tag: 'DIRECT', type: 'direct' });
    }

    const config = buildModernSingboxConfig(outbounds);

    return JSON.stringify(config, null, 2) + '\n';
}
