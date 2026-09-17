function normalizeIds(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter(Boolean))];
}

export function isManualNodeItem(item) {
    return (
        item &&
        typeof item.id === 'string' &&
        typeof item.url === 'string' &&
        !/^https?:\/\//i.test(item.url)
    );
}

/**
 * Resolve the manual-node IDs used by a profile.
 *
 * Existing profiles remain manual by default. When autoIncludeManualNodes is
 * enabled, the live manual-node collection becomes the source of truth so new
 * nodes are included without rewriting every profile.
 */
export function resolveProfileManualNodeIds(profile, allItems = []) {
    if (profile?.autoIncludeManualNodes === true) {
        return normalizeIds(allItems.filter(isManualNodeItem).map((item) => item.id));
    }

    return normalizeIds(profile?.manualNodes);
}
