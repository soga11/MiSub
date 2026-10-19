<script setup>
    import { ref, nextTick } from 'vue';
    import { isIPv4, isIPv6, isValidPort, stripBrackets } from '@/lib/nodeAddress.js';

    const props = defineProps({
        value: { type: [String, Number], default: '' },
        /** text | ip | port */
        type: { type: String, default: 'text' },
        placeholder: { type: String, default: '' },
        disabled: { type: Boolean, default: false },
        /** 可选：async (newValue) => void，抛错则保持编辑态 */
        save: { type: Function, default: null },
        inputClass: { type: String, default: '' },
        title: { type: String, default: '' },
    });

    const emit = defineEmits(['save']);

    const editing = ref(false);
    const draft = ref('');
    const error = ref('');
    const saving = ref(false);
    const inputRef = ref(null);

    function validate(raw) {
        if (props.type === 'ip') {
            const s = stripBrackets(raw);
            if (!s) return { ok: false, msg: '地址不能为空' };
            if (isIPv4(s) || isIPv6(s)) return { ok: true, value: s };
            return { ok: false, msg: '不是合法的 IPv4 / IPv6' };
        }
        if (props.type === 'port') {
            const s = String(raw ?? '').trim();
            if (!isValidPort(s)) return { ok: false, msg: '端口需 1–65535' };
            return { ok: true, value: s };
        }
        const s = String(raw ?? '').trim();
        if (!s) return { ok: false, msg: '名称不能为空' };
        if (s.length > 128) return { ok: false, msg: '名称过长' };
        return { ok: true, value: s };
    }

    async function start() {
        if (props.disabled || editing.value) return;
        editing.value = true;
        error.value = '';
        draft.value = String(props.value ?? '');
        await nextTick();
        inputRef.value?.focus();
        inputRef.value?.select?.();
    }

    function cancel() {
        editing.value = false;
        error.value = '';
        draft.value = '';
    }

    async function commit() {
        if (!editing.value || saving.value) return;

        const r = validate(draft.value);
        if (!r.ok) {
            error.value = r.msg;
            return;
        }
        if (String(r.value) === String(props.value ?? '')) {
            editing.value = false;
            error.value = '';
            return;
        }

        saving.value = true;
        try {
            if (typeof props.save === 'function') await props.save(r.value);
            emit('save', r.value);
            editing.value = false;
            error.value = '';
        } catch (e) {
            error.value = e?.message || '保存失败';
        } finally {
            saving.value = false;
        }
    }

    function onKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    }
</script>

<template>
    <span class="inline-edit inline-flex max-w-full items-center gap-1.5 align-middle">
        <input
            v-if="editing"
            ref="inputRef"
            v-model="draft"
            :type="type === 'port' ? 'number' : 'text'"
            :placeholder="placeholder"
            :disabled="saving"
            :inputmode="type === 'port' ? 'numeric' : 'text'"
            spellcheck="false"
            autocomplete="off"
            class="w-full min-w-[72px] rounded-md border bg-white px-2 py-0.5 outline-none transition-colors dark:bg-gray-800 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            :class="[
                error
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-primary-500 focus:border-primary-500',
                inputClass,
            ]"
            @keydown="onKeydown"
            @blur="commit"
        />
        <span
            v-else
            class="cursor-text truncate rounded border-b border-dashed border-transparent px-1 py-0.5 transition-colors hover:border-gray-400 hover:bg-gray-500/10 dark:hover:border-gray-500"
            :class="[disabled ? 'cursor-default hover:border-transparent hover:bg-transparent' : '', inputClass]"
            :title="title || (disabled ? '' : '点击编辑')"
            @click.stop="start"
        >
            {{ value === '' || value === null || value === undefined ? placeholder : value }}
        </span>
        <span v-if="error && editing" class="shrink-0 text-[11px] text-red-500">{{ error }}</span>
    </span>
</template>
