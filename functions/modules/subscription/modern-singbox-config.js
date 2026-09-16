const MAIN_GROUP = '🚀 节点选择';
const MANUAL_GROUP = '👋 手动选择';
const AUTO_GROUP = '♻️ 自动选择';
const YOUTUBE_GROUP = '📹 油管视频';
const CHATGPT_GROUP = '💬 ChatGPT';
const TIKTOK_GROUP = '🎵 TikTok';
const TELEGRAM_GROUP = '📲 电报消息';
const APPLE_GROUP = '🍎 苹果服务';
const LAN_GROUP = '🏠 局域网';
const HK_GROUP = '🇭🇰 香港负载';
const TW_GROUP = '🇨🇳 台湾负载';
const ADS_GROUP = '🛡️ 去广告';
const FINAL_GROUP = '🐟 漏网之鱼';

const TEST_URL = 'http://cp.cloudflare.com/generate_204';

const RULE_SETS = [
    {
        tag: 'geoip-cn',
        type: 'remote',
        format: 'binary',
        url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs',
    },
    {
        tag: 'geosite-cn',
        type: 'remote',
        format: 'binary',
        url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-geolocation-cn.srs',
    },
    {
        tag: 'ext-cn-domain',
        type: 'remote',
        format: 'binary',
        url: 'https://raw.githubusercontent.com/xmdhs/cn-domain-list/rule-set/ext-cn-list.srs',
    },
    {
        tag: 'geosite-category-ads-all',
        type: 'remote',
        format: 'binary',
        url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs',
    },
];

function uniqueTags(outbounds) {
    const seen = new Set();
    return outbounds
        .map((outbound) => String(outbound?.tag || '').trim())
        .filter((tag) => {
            if (!tag || seen.has(tag)) return false;
            seen.add(tag);
            return true;
        });
}

function matchTags(tags, pattern) {
    const matched = tags.filter((tag) => pattern.test(tag));
    return matched.length > 0 ? matched : tags;
}

function selector(tag, outbounds) {
    return {
        tag,
        type: 'selector',
        outbounds: outbounds.filter(Boolean),
    };
}

function urltest(tag, outbounds) {
    return {
        tag,
        type: 'urltest',
        outbounds: outbounds.filter(Boolean),
        url: TEST_URL,
        interval: '15m',
        tolerance: 100,
    };
}

function buildModernDnsConfig() {
    return {
        servers: [
            { tag: 'remote', type: 'https', server: '8.8.8.8', detour: MAIN_GROUP },
            { tag: 'local', type: 'https', server: '223.5.5.5' },
            {
                tag: 'fakeip',
                type: 'fakeip',
                inet4_range: '198.18.0.0/15',
                inet6_range: '2001:0470:f9da:fdfa::1/64',
            },
        ],
        rules: [
            { query_type: ['A', 'AAAA'], rewrite_ttl: 1, server: 'fakeip' },
            { clash_mode: 'global', server: 'remote' },
            { clash_mode: 'direct', server: 'local' },
            { rule_set: 'geosite-cn', server: 'local' },
            { rule_set: 'ext-cn-domain', server: 'local' },
        ],
        strategy: 'prefer_ipv4',
        final: 'remote',
    };
}

function buildModernRouteRules() {
    return [
        { action: 'sniff' },
        { action: 'hijack-dns', protocol: 'dns' },
        { action: 'resolve', strategy: 'prefer_ipv4' },
        { clash_mode: 'direct', outbound: 'DIRECT' },
        { clash_mode: 'global', outbound: MAIN_GROUP },
        { ip_is_private: true, outbound: 'DIRECT' },
        { rule_set: 'geosite-category-ads-all', outbound: 'REJECT' },
        {
            domain_suffix: [
                '.youtube.com',
                '.ytimg.com',
                '.googlevideo.com',
                '.yt.be',
                '.youtube-nocookie.com',
            ],
            outbound: YOUTUBE_GROUP,
        },
        {
            domain_suffix: [
                '.openai.com',
                '.chatgpt.com',
                '.ai.com',
                '.anthropic.com',
                '.claude.ai',
                '.gemini.google.com',
                '.copilot.microsoft.com',
                '.perplexity.ai',
                '.deepseek.com',
                '.moonshot.cn',
            ],
            outbound: CHATGPT_GROUP,
        },
        {
            domain_suffix: [
                '.tiktok.com',
                '.tiktokv.com',
                '.byteoversea.com',
                '.bytedance.com',
                '.douyin.com',
            ],
            outbound: TIKTOK_GROUP,
        },
        {
            domain_suffix: ['.telegram.org', '.telegram.me', '.t.me', '.tdlib.org', '.telegra.ph'],
            outbound: TELEGRAM_GROUP,
        },
        {
            domain_suffix: [
                '.apple.com',
                '.icloud.com',
                '.mzstatic.com',
                '.cdn-apple.com',
                '.appstoreconnect.apple.com',
            ],
            outbound: APPLE_GROUP,
        },
        { rule_set: 'geosite-cn', outbound: 'DIRECT' },
        { rule_set: 'ext-cn-domain', outbound: 'DIRECT' },
        { rule_set: 'geoip-cn', outbound: 'DIRECT' },
    ];
}

export function buildModernSingboxConfig(proxyOutbounds) {
    const nodeOutbounds = Array.isArray(proxyOutbounds) ? proxyOutbounds : [];
    const proxyTags = uniqueTags(nodeOutbounds);
    const selectableTags = proxyTags.length > 0 ? proxyTags : ['DIRECT'];
    const hkTags = matchTags(selectableTags, /香港|港|HK|Hong Kong|HKG/i);
    const twTags = matchTags(selectableTags, /台湾|台|TW|Taiwan|TPE/i);
    const adsTags = matchTags(selectableTags, /去广告|广告|AdGuard|Ads?/i);

    return {
        $schema: 'https://sing-box.sagernet.org/schema.json',
        log: { level: 'info', timestamp: true },
        dns: buildModernDnsConfig(),
        experimental: {
            cache_file: { enabled: true },
            clash_api: { external_controller: '127.0.0.1:9090', secret: '' },
        },
        inbounds: [
            {
                type: 'tun',
                tag: 'tun-in',
                address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
                auto_route: true,
                strict_route: true,
                mtu: 9000,
            },
            {
                type: 'mixed',
                tag: 'mixed-in',
                listen: '127.0.0.1',
                listen_port: 2334,
            },
        ],
        outbounds: [
            selector(MAIN_GROUP, [AUTO_GROUP, MANUAL_GROUP, HK_GROUP, TW_GROUP, ADS_GROUP, 'DIRECT']),
            selector(MANUAL_GROUP, selectableTags),
            urltest(AUTO_GROUP, selectableTags),
            selector(YOUTUBE_GROUP, [ADS_GROUP, MANUAL_GROUP, AUTO_GROUP, TW_GROUP, HK_GROUP, MAIN_GROUP, 'DIRECT']),
            selector(CHATGPT_GROUP, [TW_GROUP, MANUAL_GROUP, AUTO_GROUP, HK_GROUP, MAIN_GROUP, 'DIRECT']),
            selector(TIKTOK_GROUP, [TW_GROUP, HK_GROUP, MAIN_GROUP]),
            selector(TELEGRAM_GROUP, [HK_GROUP, ADS_GROUP, MAIN_GROUP]),
            selector(APPLE_GROUP, ['DIRECT', MAIN_GROUP]),
            selector(LAN_GROUP, ['DIRECT', MAIN_GROUP]),
            urltest(HK_GROUP, hkTags),
            urltest(TW_GROUP, twTags),
            urltest(ADS_GROUP, adsTags),
            selector(FINAL_GROUP, [MAIN_GROUP, 'DIRECT']),
            ...nodeOutbounds,
            { tag: 'DIRECT', type: 'direct' },
            { tag: 'REJECT', type: 'block' },
        ],
        route: {
            auto_detect_interface: true,
            default_domain_resolver: { server: 'local' },
            final: FINAL_GROUP,
            rule_set: RULE_SETS,
            rules: buildModernRouteRules(),
        },
    };
}
