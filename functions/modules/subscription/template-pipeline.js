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
 * - 可在分组上写 "filter": "香港|HK"（字符串正则或字符串数组），精确控制匹配哪些节点
 * - 可写 "exclude": "广告" 排除
 * - 未写 filter/include 时填入全部节点；分组名称不参与任何判断
 * - filter/exclude 为引擎扩展字段，输出 JSON 时会剔除
 * - 显式 filter 无匹配时直接报错，避免悄悄把错误地区的节点塞进分组
 * - 节点 outbound 追加到 outbounds 末尾；其余出站、DNS 和路由完全服从模板
 */
function matchesAnyPattern(text, pattern) {
    if (pattern == null || pattern === '') return false;
    const list = Array.isArray(pattern) ? pattern : [pattern];
    return list.some((p) => {
        try {
            return new RegExp(String(p), 'i').test(text);
        } catch {
            return String(text).toLowerCase().includes(String(p).toLowerCase());
        }
    });
}

function pickNodesForGroup(group, nodeOutbounds) {
    const filter = group?.filter ?? group?.include;
    const exclude = group?.exclude;

    let picked =
        filter != null && filter !== ''
            ? nodeOutbounds.filter((o) => matchesAnyPattern(o.tag, filter))
            : nodeOutbounds;

    if (exclude != null && exclude !== '') {
        picked = picked.filter((o) => !matchesAnyPattern(o.tag, exclude));
    }
    return picked;
}

function stripEngineOnlyFields(outbound) {
    if (!outbound || typeof outbound !== 'object') return outbound;
    const { filter, include, exclude, ...rest } = outbound;
    return rest;
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
            return stripEngineOnlyFields(outbound);
        }
        const members = Array.isArray(outbound.outbounds) ? outbound.outbounds : [];
        const needsFill = members.length === 0 || members.includes('*');
        if (!needsFill) return stripEngineOnlyFields(outbound);
        const picked = pickNodesForGroup(outbound, nodeOutbounds);
        const explicitFilter = outbound.filter ?? outbound.include;
        if (explicitFilter != null && explicitFilter !== '' && picked.length === 0) {
            throw new Error(
                `Sing-box template group "${String(outbound.tag || '')}" matched no nodes`
            );
        }
        const fillTags = picked.map((o) => o.tag);
        const kept = members.filter((tag) => tag && tag !== '*' && !nodeTagSet.has(tag));
        return stripEngineOnlyFields({
            ...outbound,
            outbounds: [...kept, ...fillTags],
        });
    });

    const existingTags = new Set(
        existingOutbounds.map((outbound) => outbound?.tag).filter(Boolean)
    );
    const appendedNodes = nodeOutbounds.filter((outbound) => !existingTags.has(outbound.tag));

    const resultOutbounds = [...filledOutbounds, ...appendedNodes];

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
