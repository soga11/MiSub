/**
 * Hysteria/Hysteria2 配置转换为URL
 * 支持完整参数：ports、obfs、ALPN、SNI、up/down等
 */
export function convertHysteriaToUrl(proxy) {
    try {
        if (!proxy.server || !proxy.port) {
            return null;
        }

        const isHysteria2 = proxy.type === 'hysteria2' || proxy.type === 'hy2';
        const protocol = isHysteria2 ? 'hysteria2' : 'hysteria';

        // ✅ 密码解码（如果包含 URL 编码）
        const auth = proxy.password || proxy.auth || proxy['auth-str'] || '';
        const decodedAuth = typeof auth === 'string' && auth.includes('%')
            ? decodeURIComponent(auth)
            : auth;

        if (!decodedAuth) {
            return null;
        }

        // 处理端口（支持端口跳跃）
        let portStr = String(proxy.port);
        if (proxy.ports) {
            // 端口跳跃: "1000-2000" 或 "1000,2000,3000"
            portStr = proxy.ports;
        }

        const params = new URLSearchParams();

        // SNI
        if (proxy.sni || proxy.servername) {
            params.set('sni', proxy.sni || proxy.servername);
        }

        // 跳过证书验证
        if (proxy['skip-cert-verify']) {
            params.set('insecure', '1');
            params.set('allowInsecure', '1');
        }

        // ALPN
        if (proxy.alpn) {
            const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.join(',') : proxy.alpn;
            params.set('alpn', alpn);
        }

        // Fingerprint
        if (proxy.fingerprint || proxy['client-fingerprint']) {
            params.set('pinSHA256', proxy.fingerprint || proxy['client-fingerprint']);
        }

        // Hysteria2 特有参数
        if (isHysteria2) {
            // 混淆
            if (proxy.obfs) {
                params.set('obfs', proxy.obfs);
            }
            // ✅ 混淆密码解码
            if (proxy['obfs-password']) {
                const obfsPassword = typeof proxy['obfs-password'] === 'string' && proxy['obfs-password'].includes('%')
                    ? decodeURIComponent(proxy['obfs-password'])
                    : proxy['obfs-password'];
                params.set('obfs-password', obfsPassword);
            }

            // 上传/下载速度
            if (proxy.up) {
                params.set('up', proxy.up);
            }
            if (proxy.down) {
                params.set('down', proxy.down);
            }
        } else {
            // Hysteria1 混淆
            if (proxy.obfs) {
                if (typeof proxy.obfs === 'string') {
                    params.set('obfs', proxy.obfs);
                } else if (proxy.obfs.type) {
                    params.set('obfs', proxy.obfs.type);
                    if (proxy.obfs.host) {
                        params.set('obfsParam', proxy.obfs.host);
                    }
                }
            }

            // Hysteria1 上传/下载
            if (proxy.up) {
                params.set('upmbps', proxy.up);
            }
            if (proxy.down) {
                params.set('downmbps', proxy.down);
            }

            // Hysteria1 auth_str
            if (proxy['auth_str'] || proxy['auth-str']) {
                params.set('auth', proxy['auth_str'] || proxy['auth-str']);
            }
        }

        // 协议参数
        if (proxy.protocol) {
            params.set('protocol', proxy.protocol);
        }

        // 构建 URL
        const url = `${protocol}://${encodeURIComponent(decodedAuth)}@${proxy.server}:${portStr}?${params.toString()}`;

        // Fragment (节点名称)
        if (proxy.name) {
            return `${url}#${encodeURIComponent(proxy.name)}`;
        }

        return url;
    } catch (e) {
        console.error('Hysteria转换失败:', e);
        return null;
    }
}
