import { parseIniTemplate } from './template-parsers/ini-template-parser.js';
import { applySmartModelOptimizations } from './template-processor.js';
import { renderClashFromTemplateModel } from './template-renderers/render-clash.js';
import {
    renderSingboxFromTemplateModel,
    buildOutbound as buildSingboxOutbound,
} from './template-renderers/render-singbox.js';
import { renderSurgeFromTemplateModel } from './template-renderers/render-surge.js';
import { renderLoonFromTemplateModel } from './template-renderers/render-loon.js';
import { renderQuanxFromTemplateModel } from './template-renderers/render-quanx.js';
import { renderEgernFromTemplateModel } from './template-renderers/render-egern.js';
import { urlsToClashProxies } from '../../utils/url-to-clash.js';
import { getUniqueName } from './name-utils.js';

/**
 * 处理重名节点，确保每个节点名称唯一
 * @param {Object[]} proxies - 代理对象数组
 */
function deduplicateNames(proxies) {
    if (!Array.isArray(proxies)) return;
    const usedNames = new Map();
    proxies.forEach((proxy) => {
        if (proxy && proxy.name) {
            proxy.name = getUniqueName(proxy.name, usedNames);
        }
    });
}

export function renderClashFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });

    // 智能注入地区分组逻辑
    model = applySmartModelOptimizations(model);

    return renderClashFromTemplateModel(model);
}

export function renderSingboxFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });
    model = applySmartModelOptimizations(model);
    return renderSingboxFromTemplateModel(model, options);
}

export function isSingboxJsonTemplate(templateText) {
    if (typeof templateText !== 'string') return false;
    const trimmed = templateText.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
        const parsed = JSON.parse(trimmed);
        return Boolean(parsed && typeof parsed === 'object' && Array.isArray(parsed.outbounds));
    } catch {
        return false;
    }
}

/**
 * 使用用户提供的 sing-box JSON 骨架，注入真实节点。
 * 约定：
 * - selector/urltest 的 outbounds 为 [] 或含 "*" 时自动填节点
 * - 分组名含 香港/HK → 只填香港节点；台湾/TW → 只填台湾；去广告/广告/AdGuard → 只填广告类
 * - 其余空分组（手动选择/自动选择等）填入全部节点
 * - 其余分组引用（如 "🚀 节点选择"、"DIRECT"）原样保留
 * - 节点 outbound 追加到 outbounds 末尾；缺失 DIRECT/REJECT 时自动补齐
 */
function pickNodesForGroupTag(groupTag, nodeOutbounds) {
    const tag = String(groupTag || '');
    if (/香港|港|HK|Hong Kong|HKG/i.test(tag)) {
        return nodeOutbounds.filter((o) => /香港|港|HK|Hong Kong|HKG/i.test(o.tag));
    }
    if (/台湾|臺|TW|Taiwan|TPE/i.test(tag)) {
        return nodeOutbounds.filter((o) => /台湾|臺|TW|Taiwan|TPE/i.test(o.tag));
    }
    if (/去广告|广告|AdGuard|Ads?/i.test(tag)) {
        return nodeOutbounds.filter((o) => /去广告|广告|AdGuard|Ads?/i.test(o.tag));
    }
    return nodeOutbounds;
}

export function renderSingboxFromJsonTemplate(templateText, options = {}) {
    const template = JSON.parse(templateText);
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
        throw new Error('Sing-box JSON template must be an object');
    }

    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    const nodeOutbounds = proxies.map(buildSingboxOutbound).filter(Boolean);
    const nodeTags = nodeOutbounds.map((outbound) => outbound.tag);
    const nodeTagSet = new Set(nodeTags);

    const existingOutbounds = Array.isArray(template.outbounds) ? template.outbounds : [];
    const filledOutbounds = existingOutbounds.map((outbound) => {
        if (!outbound || (outbound.type !== 'selector' && outbound.type !== 'urltest')) {
            return outbound;
        }
        const members = Array.isArray(outbound.outbounds) ? outbound.outbounds : [];
        const needsFill = members.length === 0 || members.includes('*');
        if (!needsFill) return outbound;
        const picked = pickNodesForGroupTag(outbound.tag, nodeOutbounds);
        // 地区分组若无匹配节点则退回全部，避免空 urltest 无法启动
        const fillNodes = picked.length > 0 ? picked : nodeOutbounds;
        const fillTags = fillNodes.map((o) => o.tag);
        const kept = members.filter((tag) => tag && tag !== '*' && !nodeTagSet.has(tag));
        return { ...outbound, outbounds: [...kept, ...fillTags] };
    });

    const existingTags = new Set(
        existingOutbounds.map((outbound) => outbound?.tag).filter(Boolean)
    );
    const appendedNodes = nodeOutbounds.filter((outbound) => !existingTags.has(outbound.tag));

    const resultOutbounds = [...filledOutbounds, ...appendedNodes];
    const resultTags = new Set(resultOutbounds.map((outbound) => outbound?.tag).filter(Boolean));
    if (!resultTags.has('DIRECT')) {
        resultOutbounds.push({ tag: 'DIRECT', type: 'direct' });
    }
    if (!resultTags.has('REJECT')) {
        resultOutbounds.push({ tag: 'REJECT', type: 'block' });
    }

    return JSON.stringify({ ...template, outbounds: resultOutbounds }, null, 2) + '\n';
}

export function renderSurgeFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });
    model = applySmartModelOptimizations(model);
    return renderSurgeFromTemplateModel(model, options);
}

export function renderLoonFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });
    model = applySmartModelOptimizations(model);
    return renderLoonFromTemplateModel(model, options);
}

export function renderQuanxFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });
    model = applySmartModelOptimizations(model);
    return renderQuanxFromTemplateModel(model, options);
}

export function renderEgernFromIniTemplate(templateText, options = {}) {
    const nodeList = typeof options.nodeList === 'string' ? options.nodeList : '';
    const proxyUrls = nodeList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    const proxies = Array.isArray(options.proxies)
        ? options.proxies
        : urlsToClashProxies(proxyUrls, options);
    deduplicateNames(proxies);

    let model = parseIniTemplate(templateText, {
        ...options,
        proxies,
    });
    model = applySmartModelOptimizations(model);
    return renderEgernFromTemplateModel(model);
}
