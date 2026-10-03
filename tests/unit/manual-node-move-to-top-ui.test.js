import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import ManualNodeCard from '../../src/components/nodes/ManualNodeCard.vue';
import ManualNodeList from '../../src/components/nodes/ManualNodeList.vue';
import { createI18n } from '../../src/i18n/index.js';

const node = {
    id: 'node-1',
    name: 'Test node',
    url: 'ss://test',
    enabled: true,
};

const mountOptions = {
    global: {
        plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
    },
};

describe('manual node move-to-top controls', () => {
    it('emits move-to-top from card view', async () => {
        const wrapper = mount(ManualNodeCard, {
            props: { node },
            ...mountOptions,
        });

        await wrapper.get('button[aria-label="移动到顶部"]').trigger('click');
        expect(wrapper.emitted('move-to-top')).toHaveLength(1);
    });

    it('emits move-to-top from list view', async () => {
        const wrapper = mount(ManualNodeList, {
            props: { node, index: 1 },
            ...mountOptions,
        });

        await wrapper.findAll('button[aria-label="移动到顶部"]')[0].trigger('click');
        expect(wrapper.emitted('move-to-top')).toHaveLength(1);
    });
});
