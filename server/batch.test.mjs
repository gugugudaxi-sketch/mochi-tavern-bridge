import test from 'node:test';
import assert from 'node:assert/strict';
import { newBinding, acceptTavernBatch, exchange } from './core.mjs';
let sequence = 0;
function setup() {
    const state = { catalogs: [{ deviceId: 'd', maskId: 'm', characters: [{ id: 'c' }] }], bindings: [], memories: {} };
    const binding = newBinding(state, { deviceId: 'd', maskId: 'm', charId: 'c', avatar: 'a', persona: 'p', chatId: 'chat', limit: 100, auto: false });
    return { state, base: { ...binding, bindingId: binding.id, uploadId: `upload-${sequence++}` } };
}
test('超6万字符单条分段收齐后完整提交，重复片与提交不重复新增', () => {
    const { state, base } = setup(); const text = '文'.repeat(47999) + '😀' + '段'.repeat(72000);
    const parts = [text.slice(0, 47999), text.slice(47999, 95999), text.slice(95999)];
    acceptTavernBatch(state, { ...base, action: 'start', messages: [{ id: 'long', role: 'assistant', length: text.length, parts: parts.length }] });
    for (let i = 0; i < parts.length; i++) {
        const input = { ...base, action: 'part', pieces: [{ id: 'long', part: i, text: parts[i] }] };
        acceptTavernBatch(state, input); acceptTavernBatch(state, input);
    }
    assert.equal(state.memories[base.bindingId], undefined);
    const result = acceptTavernBatch(state, { ...base, action: 'commit' }); assert.equal(result.memoryProtocol, 2);
    assert.equal(state.memories[base.bindingId].tavern[0].text, text);
    acceptTavernBatch(state, { ...base, action: 'commit' });
    assert.equal(exchange(state, { ...base, lines: [] }).pending.length, 1);
});
test('缺片、乱角色、冲突重复片不会提交；补齐后仍可成功', () => {
    const { state, base } = setup();
    acceptTavernBatch(state, { ...base, action: 'start', messages: [{ id: 'x', role: 'user', length: 4, parts: 2 }] });
    assert.throws(() => acceptTavernBatch(state, { ...base, action: 'part', persona: 'other', pieces: [] }));
    acceptTavernBatch(state, { ...base, action: 'part', pieces: [{ id: 'x', part: 0, text: 'ab' }] });
    assert.throws(() => acceptTavernBatch(state, { ...base, action: 'part', pieces: [{ id: 'x', part: 0, text: 'cd' }] }));
    assert.throws(() => acceptTavernBatch(state, { ...base, action: 'commit' })); assert.equal(state.memories[base.bindingId], undefined);
    acceptTavernBatch(state, { ...base, action: 'part', pieces: [{ id: 'x', part: 1, text: 'cd' }] });
    acceptTavernBatch(state, { ...base, action: 'commit' }); assert.equal(state.memories[base.bindingId].tavern[0].text, 'abcd');
});
test('磁盘提交失败后重试不能只返回内存缓存，必须重新应用完整提交', () => {
    const { state, base } = setup(); const command = { ...base, action: 'commit' };
    acceptTavernBatch(state, { ...base, action: 'start', messages: [{ id: 'x', role: 'user', length: 2, parts: 1 }] });
    acceptTavernBatch(state, { ...base, action: 'part', pieces: [{ id: 'x', part: 0, text: 'ab' }] });
    acceptTavernBatch(structuredClone(state), command); // Simulate an uncommitted clone after disk failure.
    assert.equal(state.memories[base.bindingId], undefined);
    acceptTavernBatch(state, command); assert.equal(state.memories[base.bindingId].tavern[0].text, 'ab');
});
