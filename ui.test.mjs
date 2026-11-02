import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

test('真实扩展脚本：界面绑定、生成前注入、切面具隔离、手动与编辑同步', async () => {
    const dom = new JSDOM('<div id="extensions_settings"></div>', { url: 'http://127.0.0.1:8000' });
    const events = new Map(); let prompt = '', calls = [], sent = [], offline = false;
    const binding = { id: 'binding', deviceId: 'phone', maskId: 'mask-a', charId: 'char-a', avatar: 'char.png', persona: 'user.png', chatId: 'date-a', limit: 40, auto: true, label: '测试' };
    const state = { token: 'secret', catalogs: [{ deviceId: 'phone', maskId: 'mask-a', maskLabel: '我', characters: [{ id: 'char-a', name: '<img src=x onerror=alert(1)>' }] }], bindings: [binding] };
    const c = { characterId: 0, characters: [{ avatar: 'char.png' }], chatId: 'date-a', name1: '我', name2: '角色', chat: [{ is_user: false, mes: '线下原文' }], getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }), setExtensionPrompt: (_key, text) => { prompt = text; }, eventSource: { on: (event, fn) => events.set(event, fn) }, eventTypes: { CHAT_CHANGED: 'chat', GENERATION_AFTER_COMMANDS: 'generate', MESSAGE_EDITED: 'edit' } };
    const sandbox = { crypto: globalThis.crypto, document: dom.window.document, navigator: { clipboard: { writeText: async () => {} } }, SillyTavern: { getContext: () => c }, user_avatar: 'user.png', extension_prompt_types: { IN_CHAT: 1 }, console, setInterval: () => 1, fetch: async (url, options) => {
        if (offline && url.endsWith('/tavern')) throw new Error('offline');
        calls.push(url); const body = options.body && JSON.parse(options.body);
        if (url.endsWith('/tavern')) sent = body.lines;
        return { ok: true, status: 200, text: async () => JSON.stringify(url.endsWith('/state') ? state : { memoryProtocol: 2, savedMemories: [{ id: 'saved', kind: '宫殿记忆', date: '2026-10-01', text: '共同的长期约定' }], bindingId: 'binding', lines: [{ id: '1', role: 'user', text: '线上约好晚上见面' }] }) };
    } };
    vm.createContext(sandbox);
    const source = (await fs.readFile(new URL('index.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
    vm.runInContext(source, sandbox);
    const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); await settle();
    assert.ok(dom.window.document.querySelector('[data-sync]'));
    assert.equal(dom.window.document.querySelector('select img'), null);
    assert.match(prompt, /线上约好晚上见面/); assert.match(prompt, /共同的长期约定/); assert.equal(sent[0].text, '线下原文');
    c.chat[0].mes = '选中的重生成版本'; await events.get('generate')('normal', {}, false); assert.equal(sent[0].text, '选中的重生成版本');
    sandbox.user_avatar = 'other.png'; await events.get('generate')('normal', {}, false); assert.equal(prompt, '');
    sandbox.user_avatar = 'user.png'; c.chatId = 'other-chat'; await events.get('generate')('normal', {}, false); assert.equal(prompt, '');
    c.chatId = 'date-a'; c.groupId = 'group'; await events.get('generate')('normal', {}, false); assert.equal(prompt, ''); c.groupId = null;
    binding.auto = false; vm.runInContext('data.bindings[0].auto = false', sandbox); const before = calls.length; await events.get('generate')('normal', {}, false); assert.equal(calls.length, before);
    dom.window.document.querySelector('[data-sync]').click(); await settle(); assert.ok(calls.length > before); assert.match(prompt, /线上约好晚上见面/);
    binding.auto = true; vm.runInContext('data.bindings[0].auto = true', sandbox); offline = true; const cached = prompt;
    await assert.doesNotReject(() => events.get('generate')('normal', {}, false));
    assert.equal(prompt, cached);
    assert.equal(dom.window.document.querySelector('#mochi-bridge-status').textContent, 'offline');
    dom.window.close();
});

test('服务端未启动返回HTML：显示安装指引，复制不崩溃，启动后可刷新配对码', async () => {
    const dom = new JSDOM('<div id="extensions_settings"></div>'); let available = false;
    const c = { characterId: null, getRequestHeaders: () => ({}), setExtensionPrompt() {}, eventSource: { on() {} }, eventTypes: { CHAT_CHANGED: 'chat', GENERATION_AFTER_COMMANDS: 'gen' } };
    const sandbox = { crypto: globalThis.crypto, document: dom.window.document, navigator: {}, SillyTavern: { getContext: () => c }, user_avatar: 'me.png', extension_prompt_types: { IN_CHAT: 1 }, console, setInterval: () => 1, fetch: async () => ({ ok: available, status: available ? 200 : 404, text: async () => available ? JSON.stringify({ token: 'test-pairing', catalogs: [], bindings: [] }) : '<!DOCTYPE html><html>Not found</html>' }) };
    vm.createContext(sandbox);
    vm.runInContext((await fs.readFile(new URL('index.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, ''), sandbox);
    const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); await settle();
    const root = dom.window.document;
    assert.match(root.querySelector('#mochi-bridge-status').textContent, /安装服务端/);
    assert.ok(root.querySelector('.mochi-install-command').textContent.includes('install-server.mjs'));
    root.querySelector('[data-copy]').click(); await settle(); assert.match(root.querySelector('#mochi-bridge-status').textContent, /尚未加载/);
    available = true; root.querySelector('[data-refresh]').click(); await settle(); assert.equal(root.querySelector('[data-pair]').value, 'test-pairing');
    dom.window.close();
});


test('直接保存100条与关闭自动同步，不解绑；非法数值不发送，刷新仍显示生效值', async () => {
    const dom = new JSDOM('<div id="extensions_settings"></div>');
    let binding = { id: 'keep-id', deviceId: 'd', maskId: 'm', charId: 'c', avatar: 'a', persona: 'p', chatId: 'chat', limit: 40, auto: true, label: '绑定' };
    let writes = 0, exchanges = 0;
    const extensionSettings = {};
    const context = { groupId: null, characterId: 0, characters: [{ avatar: 'a' }], chatId: 'chat', name1: '我', name2: '角色', chat: [], getRequestHeaders: () => ({}), setExtensionPrompt() {}, extensionSettings, saveSettingsDebounced() {}, eventSource: { on() {} }, eventTypes: { CHAT_CHANGED: 'chat', GENERATION_AFTER_COMMANDS: 'gen' } };
    const sandbox = { document: dom.window.document, navigator: {}, crypto: globalThis.crypto, console, setInterval: () => 1, user_avatar: 'p', extension_prompt_types: { IN_CHAT: 1 }, SillyTavern: { getContext: () => context }, fetch: async (url, options) => {
        let value;
        if (url.endsWith('/state')) value = { token: 'token', catalogs: [], bindings: [binding] };
        else if (url.endsWith('/binding-settings')) { writes++; const body = JSON.parse(options.body); assert.equal(body.bindingId, 'keep-id'); binding = { ...binding, limit: body.limit, auto: body.auto }; value = { binding }; }
        else if (url.endsWith('/tavern')) { exchanges++; value = { memoryProtocol: 2, lines: [], savedMemories: [] }; }
        else throw new Error('不应调用解绑或重绑接口');
        return { ok: true, status: 200, text: async () => JSON.stringify(value) };
    } };
    vm.createContext(sandbox); vm.runInContext((await fs.readFile(new URL('index.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, ''), sandbox);
    const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); await settle();
    const root = dom.window.document, limit = root.querySelector('[data-limit]'), automatic = root.querySelector('[data-auto]'), budget = root.querySelector('[data-memory-budget]');
    assert.equal(limit.value, '40'); limit.value = '100'; limit.dispatchEvent(new dom.window.Event('input'));
    automatic.checked = false; automatic.dispatchEvent(new dom.window.Event('change')); budget.value = '30000000';
    assert.match(root.querySelector('[data-settings-state]').textContent, /未保存/);
    root.querySelector('[data-save-settings]').click(); await settle(); assert.equal(writes, 0); assert.equal(binding.limit, 40);
    budget.value = '50000'; root.querySelector('[data-save-settings]').click(); await settle();
    assert.equal(writes, 1); assert.equal(binding.limit, 100); assert.equal(binding.auto, false); assert.equal(binding.id, 'keep-id');
    assert.equal(extensionSettings['mochi-memory-bridge'].memoryBudget, 50000); assert.match(root.querySelector('[data-binding]').textContent, /100/);
    assert.equal(automatic.checked, false); root.querySelector('[data-refresh]').click(); await settle(); assert.equal(limit.value, '100');
    const before = exchanges; await vm.runInContext('sync()', sandbox); assert.equal(exchanges, before); await vm.runInContext('sync(true)', sandbox); assert.equal(exchanges, before + 1);
    dom.window.close();
});
