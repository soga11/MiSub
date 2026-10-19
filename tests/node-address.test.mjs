import {
    parseNodeHostPort,
    replaceHostPort,
    parseHostPort,
    formatHostPort,
    isIPv6,
    normalizeProxyUri,
} from '../src/lib/nodeAddress.js';

let pass = 0,
    fail = 0;
function eq(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
    if (!ok) {
        console.log('        期望: ' + JSON.stringify(expected));
        console.log('        实际: ' + JSON.stringify(actual));
        fail++;
    } else pass++;
}

console.log('=== 1. parseNodeHostPort ===');
eq('IPv4 节点', parseNodeHostPort('vless://u@159.75.236.23:20005?x=1#n'), {
    host: '159.75.236.23',
    port: '20005',
});
eq('裸 IPv6 + 端口（原实现会解析错）', parseNodeHostPort('hysteria2://p@2406:ef80:1:4a41::1ad:52016?sni=x'), {
    host: '2406:ef80:1:4a41::1ad',
    port: '52016',
});
eq('带方括号 IPv6 + 端口', parseNodeHostPort('trojan://p@[2406:ef80:1:4a41::1ad]:443#n'), {
    host: '2406:ef80:1:4a41::1ad',
    port: '443',
});
eq('裸 IPv6 无端口', parseNodeHostPort('trojan://p@2400:c620:26:74::a#n'), {
    host: '2400:c620:26:74::a',
    port: '',
});

console.log('\n=== 2. replaceHostPort ===');
eq(
    'v4 -> v6（自动补方括号）',
    replaceHostPort('vless://uuid@159.75.236.23:20005?security=reality#name', '2406:ef80:1:4a41::1ad', '52016'),
    { ok: true, url: 'vless://uuid@[2406:ef80:1:4a41::1ad]:52016?security=reality#name' }
);
eq(
    '只改端口',
    replaceHostPort('vless://uuid@159.75.236.23:20005#name', '159.75.236.23', '30000'),
    { ok: true, url: 'vless://uuid@159.75.236.23:30000#name' }
);
eq(
    'v6 -> v4（去掉方括号）',
    replaceHostPort('vless://u@[2406:ef80::1]:52016#n', '159.75.236.23', '20005'),
    { ok: true, url: 'vless://u@159.75.236.23:20005#n' }
);
eq('非法端口被拒', replaceHostPort('vless://u@1.2.3.4:80#n', '1.2.3.4', '99999').ok, false);
eq('空地址被拒', replaceHostPort('vless://u@1.2.3.4:80#n', '', '80').ok, false);

console.log('\n=== 3. vmess 往返 ===');
const vmessCfg = { v: '2', ps: '测试', add: '1.2.3.4', port: '443', id: 'abc', net: 'ws' };
const vmessUrl = 'vmess://' + Buffer.from(JSON.stringify(vmessCfg)).toString('base64');
eq('vmess 解析', parseNodeHostPort(vmessUrl), { host: '1.2.3.4', port: '443' });
const r = replaceHostPort(vmessUrl, '2406:ef80::1', '52016');
const back = JSON.parse(Buffer.from(r.url.slice(8), 'base64').toString('utf8'));
eq('vmess 改写后 add', back.add, '2406:ef80::1');
eq('vmess 改写后 port', back.port, '52016');

console.log('\n=== 4. 其他 ===');
eq('formatHostPort v6', formatHostPort('2406:ef80::1', 52016), '[2406:ef80::1]:52016');
eq('isIPv6 拒绝 5 位分组', isIPv6('2406:ef80:1:4a41::1ad:52016'), false);
eq('parseHostPort 歧义（整体是合法 v6）', parseHostPort('2001:db8::1:443'), {
    host: '2001:db8::1:443',
    port: null,
    isV6: true,
    ambiguous: true,
});
eq(
    'normalizeProxyUri 补方括号',
    normalizeProxyUri('hysteria2://p@2406:ef80:1:4a41::1ad:52016?sni=x').uri,
    'hysteria2://p@[2406:ef80:1:4a41::1ad]:52016?sni=x'
);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
