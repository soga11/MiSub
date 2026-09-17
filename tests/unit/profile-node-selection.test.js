import { describe, expect, it } from 'vitest';
import {
    isManualNodeItem,
    resolveProfileManualNodeIds,
} from '../../functions/modules/utils/profile-node-selection.js';

const items = [
    { id: 'sub-1', url: 'https://example.com/sub' },
    { id: 'node-1', url: 'vless://one' },
    { id: 'node-2', url: 'hysteria2://two' },
    { id: 'node-3', url: 'ss://three', enabled: false },
];

describe('profile manual-node selection', () => {
    it('keeps the explicit selection for existing and opt-out profiles', () => {
        expect(
            resolveProfileManualNodeIds({ manualNodes: ['node-2', 'node-2', 'node-1'] }, items)
        ).toEqual(['node-2', 'node-1']);
    });

    it('uses every current manual node when auto inclusion is enabled', () => {
        expect(
            resolveProfileManualNodeIds(
                {
                    manualNodes: ['node-1'],
                    autoIncludeManualNodes: true,
                },
                items
            )
        ).toEqual(['node-1', 'node-2', 'node-3']);
    });

    it('distinguishes remote subscriptions from manual nodes', () => {
        expect(isManualNodeItem(items[0])).toBe(false);
        expect(isManualNodeItem(items[1])).toBe(true);
    });
});
