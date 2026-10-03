<script setup>
    import { computed } from 'vue';
    const props = defineProps({ result: Object, disabled: Boolean });
    defineEmits(['check']);
    const names = { netflix: 'Netflix', youtube: 'YouTube', openai: 'OpenAI', claude: 'Claude' };
    const states = {
        available: '检测通过',
        partial: '部分支持',
        reachable: '入口可达',
        restricted: '受限',
        unsupported: '不支持',
        unknown: '未知',
        error: '无法检测',
    };
    const reasons = {
        google_cn: '疑似送中，不保证无广告',
        challenge: '遇到验证或反爬页面',
        ipv6_unavailable: '检测运行器没有可用 IPv6',
        timeout: '请求超时',
        network_error: '连接失败',
        unsupported_protocol: '检测核心暂不支持此协议',
        marker_missing: '未找到可靠判断标记',
        core_failed: '检测核心无法启动',
        originals_only: '疑似仅自制内容',
    };
    const dateLabel = computed(() =>
        props.result?.checkedAt ? new Date(props.result.checkedAt).toLocaleString() : ''
    );
</script>

<template>
    <div
        class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]"
        data-testid="node-unlock-summary"
        @click.stop
    >
        <span v-if="!result" class="text-gray-400">解锁：未检测</span>
        <template v-else>
            <span
                v-for="item in result.providers"
                :key="item.provider"
                class="rounded px-1.5 py-0.5"
                :class="
                    !result.stale && item.status === 'available'
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : !result.stale && ['restricted', 'unsupported'].includes(item.status)
                          ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                "
                :title="`${reasons[item.reason] || item.reason || ''}；${item.regionSource === 'service' ? '服务识别地区' : item.regionSource === 'exit_ip' ? '出口 IP 地区（不是服务识别地区）' : '未获取地区'}；${dateLabel}`"
            >
                {{ names[item.provider] || item.provider }} {{ item.region || '' }} ·
                {{
                    result.stale
                        ? '参数已变更'
                        : item.reason === 'google_cn'
                          ? '疑似送中'
                          : states[item.status] || '未知'
                }}
            </span>
            <span class="text-gray-400" :title="dateLabel">{{
                result.stale ? '需重新检测' : dateLabel
            }}</span>
        </template>
        <button
            type="button"
            :disabled="disabled"
            class="rounded px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-500/10 disabled:opacity-40 dark:text-indigo-400"
            @click="$emit('check')"
        >
            检查解锁
        </button>
    </div>
</template>
