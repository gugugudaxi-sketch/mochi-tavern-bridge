import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLines, newBinding, exchange, publishTavern } from './core.mjs';
const line = (id, text = 'hello') => ({ id, role: 'user', text });
const target = { deviceId: 'phone', maskId: 'mask-a', charId: 'char-a', avatar: 'char.png', persona: 'user.png', chatId: 'date-a', label: '绑定', auto: true, limit: 2 };
function setup() { const state = { catalogs: [{ deviceId: 'phone', maskId: 'mask-a', characters: [{ id: 'char-a' }] }], bindings: [], memories: {} }; return { state, binding: newBinding(state, target) }; }
test('双向交换，原文编辑与删除替换副本，重试无重复', () => {
    const { state, binding } = setup(); const input = { ...target, bindingId: binding.id };
    exchange(state, { ...input, lines: [line('1')] });
    assert.deepEqual(publishTavern(state, { ...input, lines: [line('st-1', '线下')] }).lines, [line('1')]);
    assert.deepEqual(exchange(state, { ...input, lines: [line('1', 'edited')] }).lines, [line('st-1', '线下')]);
    exchange(state, { ...input, lines: [line('1', 'edited')] }); assert.equal(state.memories[binding.id].mochi.length, 1);
    exchange(state, { ...input, lines: [] }); assert.deepEqual(state.memories[binding.id].mochi, []);
});
test('不同设备、面具、角色、酒馆面具、角色卡、聊天不能串记忆', () => {
    const { state, binding } = setup();
    for (const key of ['deviceId', 'maskId', 'charId']) assert.throws(() => exchange(state, { ...target, [key]: 'other', bindingId: binding.id, lines: [] }));
    for (const key of ['avatar', 'persona', 'chatId']) assert.throws(() => publishTavern(state, { ...target, [key]: 'other', bindingId: binding.id, lines: [] }));
    assert.throws(() => newBinding(state, target));
});
test('范围、格式、重复ID、超长文字校验；失败不替换已收记忆', () => {
    const { state, binding } = setup(); const input = { ...target, bindingId: binding.id };
    exchange(state, { ...input, lines: [line('1')] });
    for (const lines of [[line('1'), line('1')], [{ id: '1', role: 'system', text: 'bad' }], [line('x', 'x'.repeat(60001))]]) assert.throws(() => exchange(state, { ...input, lines }));
    assert.deepEqual(state.memories[binding.id].mochi, [line('1')]);
    assert.deepEqual(cleanLines([line('1'), line('2'), line('3')], 2), [line('2'), line('3')]);
    for (const limit of [0, 101, 1.5]) assert.throws(() => newBinding(setup().state, { ...target, maskId: 'other', limit }));
});
