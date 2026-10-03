<script setup>
    import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
    import { api } from '@/lib/http.js';
    import { useToastStore } from '@/stores/toast.js';
    const props = defineProps({
        nodes: { type: Array, default: () => [] },
        scopeNodes: { type: Array, default: () => [] },
        selectedNodeIds: Object,
    });
    const emit = defineEmits(['results']);
    const { showToast } = useToastStore();
    const settings = ref({
        enabled: false,
        intervalHours: 12,
        providers: ['netflix', 'youtube', 'openai', 'claude'],
        groups: null,
    });
    const providers = {
        netflix: 'Netflix',
        youtube: 'YouTube Premium',
        openai: 'OpenAI',
        claude: 'Claude',
    };
    const groups = computed(() => [...new Set(props.nodes.map((n) => n.group || ''))]);
    const allGroups = computed({
        get: () => settings.value.groups === null,
        set: (value) => {
            settings.value.groups = value ? null : [];
        },
    });
    const showSettings = ref(false);
    const ready = ref(false);
    const runnerRepo = ref('');
    const busy = ref(false);
    const message = ref('');
    const job = ref(null);
    const activeJob = computed(() => ['queued', 'running'].includes(job.value?.state));
    const repoURL = computed(() =>
        /^[\w.-]+\/[\w.-]+$/.test(runnerRepo.value)
            ? `https://github.com/${runnerRepo.value}/actions/workflows/unlock.yml`
            : ''
    );
    let timer;
    let alive = true;
    async function refresh() {
        try {
            const data = await api.get('/api/unlock/results');
            if (!alive) return;
            emit('results', data.results || {});
            job.value = data.job;
        } catch {
            /* initial errors are surfaced by load, not repetitive polling */
        }
    }
    async function load() {
        try {
            const data = await api.get('/api/unlock/settings');
            if (!alive) return;
            settings.value = data.settings;
            ready.value = data.runnerConfigured;
            runnerRepo.value = data.runnerRepo;
            if (!ready.value) message.value = '私有检测运行器尚未配置，当前不会导出节点。';
            await refresh();
        } catch (error) {
            message.value = error.message || '无法读取检测设置';
        }
    }
    async function save() {
        busy.value = true;
        try {
            await api.post('/api/unlock/settings', settings.value);
            showToast('检测设置已保存（不会修改订阅输出）', 'success');
            await load();
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            busy.value = false;
        }
    }
    async function queueNodes(ids) {
        if (busy.value) return;
        busy.value = true;
        try {
            const data = await api.post('/api/unlock/queue', { nodeIds: ids });
            message.value = data.message;
            showToast(data.message, 'info');
            await refresh();
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            busy.value = false;
        }
    }
    function queueNode(id) {
        return queueNodes([id]);
    }
    function queueScope() {
        const selected = props.selectedNodeIds;
        const ids = props.scopeNodes
            .filter((n) => n.enabled !== false && (!selected?.size || selected.has(n.id)))
            .map((n) => n.id);
        return queueNodes(ids);
    }
    defineExpose({ queueNode });
    onMounted(async () => {
        await load();
        if (alive)
            timer = setInterval(() => {
                if (activeJob.value && !document.hidden) refresh();
            }, 30000);
    });
    onBeforeUnmount(() => {
        alive = false;
        clearInterval(timer);
    });
</script>

<template>
    <section
        class="mb-4 rounded-xl border border-gray-100 bg-white p-3 text-xs dark:border-white/10 dark:bg-gray-900/70"
        aria-label="解锁检测"
    >
        <div class="flex flex-wrap items-center gap-3">
            <span class="font-medium text-gray-700 dark:text-gray-200">解锁检测</span>
            <button
                type="button"
                :disabled="busy || !ready || !settings.enabled || activeJob"
                class="rounded-lg bg-indigo-500/10 px-3 py-1.5 text-indigo-600 disabled:opacity-40 dark:text-indigo-400"
                @click="queueScope"
            >
                {{ selectedNodeIds?.size ? '检查选中节点' : '检查当前分组／搜索结果' }}
            </button>
            <button
                type="button"
                class="text-gray-500 hover:text-indigo-600"
                @click="showSettings = !showSettings"
            >
                检测设置
            </button>
            <button type="button" class="text-gray-500 hover:text-indigo-600" @click="refresh">
                刷新结果
            </button>
            <span v-if="job" class="text-gray-500">{{
                {
                    queued: '等待私有运行器',
                    running: '检测中',
                    completed: '检测完成',
                    expired: '任务超时',
                }[job.state] || job.state
            }}</span>
            <a
                v-if="repoURL"
                :href="repoURL"
                target="_blank"
                rel="noopener noreferrer"
                class="text-indigo-600"
                >私有运行器／手动运行 ↗</a
            >
        </div>
        <p v-if="message" class="mt-2 text-gray-500">{{ message }}</p>
        <div
            v-if="showSettings"
            class="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800"
        >
            <label class="flex items-center gap-2"
                ><input
                    type="checkbox"
                    v-model="settings.enabled"
                />启用解锁检测（允许私有运行器临时读取检测范围内的节点密码）</label
            >
            <label class="flex items-center gap-2"
                >自动检测间隔<select
                    v-model.number="settings.intervalHours"
                    class="rounded border p-1 dark:bg-gray-800"
                >
                    <option :value="12">12 小时（推荐）</option>
                    <option :value="1">1 小时（用量更高）</option>
                </select></label
            >
            <div class="flex flex-wrap gap-3">
                <label v-for="(label, key) in providers" :key="key" class="flex items-center gap-1"
                    ><input type="checkbox" v-model="settings.providers" :value="key" />{{
                        label
                    }}</label
                >
            </div>
            <label class="flex items-center gap-2"
                ><input type="checkbox" v-model="allGroups" />检测所有启用的手动节点（每次最多 250
                个）</label
            >
            <div v-if="!allGroups" class="flex flex-wrap gap-3">
                <label v-for="group in groups" :key="group" class="flex items-center gap-1"
                    ><input type="checkbox" v-model="settings.groups" :value="group" />{{
                        group || '未分组'
                    }}</label
                >
            </div>
            <p class="text-gray-500">
                免费 GitHub
                运行器每小时轮询，按上述间隔执行；手动请求也先排队。可在私有运行器页面点击 Run
                workflow 提前执行。检测不等于账号登录／播放保证，Premium 不等于无广告。
            </p>
            <button
                type="button"
                :disabled="busy"
                class="rounded-lg bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-40"
                @click="save"
            >
                保存检测设置
            </button>
        </div>
    </section>
</template>
