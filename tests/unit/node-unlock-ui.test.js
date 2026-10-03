import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import NodeUnlockBadge from '../../src/components/nodes/NodeUnlockBadge.vue';

describe('node unlock summary', () => {
    it('shows never tested and emits check', async () => {
        const wrapper = mount(NodeUnlockBadge);
        expect(wrapper.text()).toContain('未检测');
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('check')).toHaveLength(1);
    });
    it('distinguishes suspected CN from ad-free guarantee', () => {
        const wrapper = mount(NodeUnlockBadge, {
            props: {
                result: {
                    providers: [
                        {
                            provider: 'youtube',
                            status: 'restricted',
                            region: 'CN',
                            regionSource: 'service',
                            reason: 'google_cn',
                        },
                    ],
                    checkedAt: 1,
                },
            },
        });
        expect(wrapper.text()).toContain('疑似送中');
        expect(wrapper.find('span[title]').attributes('title')).toContain('不保证无广告');
    });
    it('does not keep green available status after node parameters changed', () => {
        const wrapper = mount(NodeUnlockBadge, {
            props: {
                result: { stale: true, providers: [{ provider: 'openai', status: 'available' }] },
            },
        });
        expect(wrapper.text()).toContain('参数已变更');
        expect(wrapper.html()).not.toContain('text-green-700');
    });
});
