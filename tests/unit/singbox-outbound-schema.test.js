import { describe, it, expect } from 'vitest';
import { buildOutbound } from '../../functions/modules/subscription/template-renderers/render-singbox.js';

/**
 * 回归护栏：这些字段曾导致官方 sing-box 内核在解码阶段直接拒绝整份配置
 * （unknown field），一次踩中就是「整份订阅不可用」。
 * 详见官方 schema：https://sing-box.sagernet.org/schema.json
 */
describe('sing-box outbound 字段合法性', () => {
    const U = '11111111-1111-1111-1111-111111111111';

    it('VMess 不输出 udp_relay_mode / congestion_control', () => {
        const outbound = buildOutbound({
            name: 'vmess',
            type: 'vmess',
            server: '1.1.1.1',
            port: 443,
            uuid: U,
            cipher: 'auto',
            'udp-relay-mode': 'native',
            'congestion-control': 'bbr',
        });

        expect(outbound).toBeTruthy();
        expect(outbound).not.toHaveProperty('udp_relay_mode');
        expect(outbound).not.toHaveProperty('congestion_control');
    });

    it('REALITY 不输出 Xray 专有的 spider_x', () => {
        const outbound = buildOutbound({
            name: 'vless',
            type: 'vless',
            server: '1.1.1.1',
            port: 443,
            uuid: U,
            tls: true,
            servername: 'a.com',
            'reality-opts': {
                'public-key': 'jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0',
                'short-id': 'ab',
                'spider-x': '/',
            },
        });

        expect(outbound.tls.reality).toBeTruthy();
        expect(outbound.tls.reality).not.toHaveProperty('spider_x');
    });

    it('TUIC 保留 udp_relay_mode（sing-box 支持该字段）', () => {
        const outbound = buildOutbound({
            name: 'tuic',
            type: 'tuic',
            server: '1.1.1.1',
            port: 443,
            uuid: U,
            password: 'p',
            sni: 'a.com',
            'udp-relay-mode': 'native',
        });

        expect(outbound.type).toBe('tuic');
        expect(outbound.udp_relay_mode).toBe('native');
    });

    it.each([
        ['ss', { type: 'ss', cipher: 'aes-128-gcm', password: 'p' }],
        ['vmess', { type: 'vmess', uuid: U, cipher: 'auto' }],
        ['vless', { type: 'vless', uuid: U }],
        ['trojan', { type: 'trojan', password: 'p' }],
        ['hysteria2', { type: 'hysteria2', password: 'p' }],
        ['tuic', { type: 'tuic', uuid: U, password: 'p' }],
        ['socks5', { type: 'socks5', username: 'u', password: 'p' }],
        ['anytls', { type: 'anytls', password: 'p' }],
        ['http', { type: 'http', username: 'u', password: 'p' }],
        ['https', { type: 'https', username: 'u', password: 'p' }],
    ])('%s 节点能渲染出 outbound（不会被静默丢弃）', (name, extra) => {
        const outbound = buildOutbound({
            name,
            server: '1.1.1.1',
            port: 8443,
            ...extra,
        });

        expect(outbound).toBeTruthy();
        expect(outbound.tag).toBe(name);
        expect(outbound.server).toBe('1.1.1.1');
        expect(outbound.server_port).toBe(8443);
    });
});
