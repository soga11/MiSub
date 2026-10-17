import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useManualNodes } from '../../src/composables/useManualNodes.js';
import { t } from '../../src/i18n/index.js';

// 副本命名走 i18n，测试不绑定具体语言
const copyOf = (name) => t('manualNodes.copySuffix', { name });
const copyOfN = (name, n) => t('manualNodes.copySuffixN', { name, n });

describe('手动节点克隆', () => {
    let dataStore;
    let manualNodes;

    beforeEach(() => {
        setActivePinia(createPinia());
        dataStore = useDataStore();

        dataStore.subscriptions = [
            { id: 'n1', url: 'ss://test1', name: '节点A', group: 'HK', enabled: true },
            { id: 'n2', url: 'ss://test2', name: '节点B', group: '', enabled: false },
            { id: 'sub1', url: 'https://example.com/sub', name: '订阅源', enabled: true },
        ];

        manualNodes = useManualNodes(() => {});
    });

    it('副本紧跟在原节点之后，序号顺延', () => {
        manualNodes.duplicateNode('n1');

        const names = manualNodes.manualNodes.value.map((n) => n.name);
        expect(names).toEqual(['节点A', copyOf('节点A'), '节点B']);
    });

    it('连续克隆时副本序号递增且不插队', () => {
        manualNodes.duplicateNode('n1');
        manualNodes.duplicateNode('n1');
        manualNodes.duplicateNode('n1');

        const names = manualNodes.manualNodes.value.map((n) => n.name);
        expect(names).toEqual([
            '节点A',
            copyOf('节点A'),
            copyOfN('节点A', 2),
            copyOfN('节点A', 3),
            '节点B',
        ]);
    });

    it('副本内容与原节点一致，但 id 唯一', () => {
        const before = { ...dataStore.subscriptions[0] };
        const newId = manualNodes.duplicateNode('n1');

        const copy = dataStore.subscriptions.find((n) => n.id === newId);
        expect(copy).toBeTruthy();
        expect(copy.url).toBe(before.url);
        expect(copy.group).toBe(before.group);
        expect(copy.enabled).toBe(before.enabled);

        const ids = dataStore.subscriptions.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('不修改原节点', () => {
        manualNodes.duplicateNode('n1');

        const original = dataStore.subscriptions.find((n) => n.id === 'n1');
        expect(original.name).toBe('节点A');
        expect(original.url).toBe('ss://test1');
    });

    it('远程订阅不会被克隆', () => {
        const result = manualNodes.duplicateNode('sub1');

        expect(result).toBeNull();
        expect(dataStore.subscriptions.filter((n) => n.id === 'sub1').length).toBe(1);
    });

    it('对不存在的 id 安全返回', () => {
        expect(manualNodes.duplicateNode('not-exist')).toBeNull();
    });
});
