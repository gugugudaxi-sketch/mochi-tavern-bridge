import test from 'node:test';
import assert from 'node:assert/strict';
import { newBinding, exchange, publishTavern, acknowledgeTavern, cleanSavedMemories } from './core.mjs';
function setup() { const state = { catalogs: [{ deviceId: 'd', maskId: 'm', characters: [{ id: 'c' }] }], bindings: [], memories: {} }; const b = newBinding(state, { deviceId: 'd', maskId: 'm', charId: 'c', avatar: 'a', persona: 'p', chatId: 'chat', limit: 40 }); return { state, input: { ...b, bindingId: b.id } }; }
const line = text => ({ id: 'stable-id', role: 'user', text });
test('已保存记忆双端读取，旧客户端不清空；显式关闭才发送空列表', () => {
    const { state, input } = setup(); const memories = [{ id: 'memory', date: '2026-01-01', kind: '宫殿记忆', text: '长期约定', privateKey: 'must-not-pass' }];
    exchange(state, { ...input, lines: [], savedMemories: memories });
    let out = publishTavern(state, { ...input, lines: [] }); assert.equal(out.savedMemories[0].text, '长期约定'); assert.equal(out.savedMemories[0].privateKey, undefined);
    exchange(state, { ...input, lines: [] }); assert.equal(publishTavern(state, { ...input, lines: [] }).savedMemories.length, 1);
    exchange(state, { ...input, lines: [], savedMemories: [] }); assert.equal(publishTavern(state, { ...input, lines: [] }).savedMemories.length, 0);
    assert.throws(() => cleanSavedMemories([{ ...memories[0], text: 'x'.repeat(500001) }]));
});
test('待保存经历跨快照保留，重复推送去重；按版本回执避免丢失后续编辑', () => {
    const { state, input } = setup();
    publishTavern(state, { ...input, lines: [line('第一版')] });
    const first = exchange(state, { ...input, lines: [] }).pending; assert.equal(first.length, 1);
    publishTavern(state, { ...input, lines: [] }); assert.equal(exchange(state, { ...input, lines: [] }).pending.length, 1);
    publishTavern(state, { ...input, lines: [line('编辑后')] });
    acknowledgeTavern(state, { ...input, receipts: first });
    const edited = exchange(state, { ...input, lines: [] }).pending; assert.equal(edited[0].text, '编辑后');
    acknowledgeTavern(state, { ...input, receipts: edited }); assert.equal(exchange(state, { ...input, lines: [] }).pending.length, 0);
    publishTavern(state, { ...input, lines: [line('编辑后')] }); assert.equal(exchange(state, { ...input, lines: [] }).pending.length, 0);
    assert.throws(() => acknowledgeTavern(state, { ...input, maskId: 'other', receipts: edited }));
});
