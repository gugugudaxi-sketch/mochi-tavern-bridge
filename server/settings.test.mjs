import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBindingSettings } from './core.mjs';
test('设置原地更新，绑定身份、ID、历史和回执保持原样', () => {
    const binding = { id: 'binding', deviceId: 'phone', maskId: 'mask', charId: 'char', avatar: 'a', persona: 'p', chatId: 'chat', limit: 40, auto: true };
    const memory = { tavernLog: { m: { id: 'm', revision: 'r', acknowledged: true } }, savedMemories: [{ text: '长期记忆' }] };
    const state = { bindings: [binding], memories: { binding: memory } };
    const saved = updateBindingSettings(state, { bindingId: 'binding', avatar: 'a', persona: 'p', chatId: 'chat', limit: 100, auto: false, charId: 'ignored' });
    assert.equal(saved.id, 'binding'); assert.equal(saved.charId, 'char'); assert.equal(saved.limit, 100); assert.equal(saved.auto, false);
    assert.equal(state.bindings.length, 1); assert.equal(state.memories.binding, memory); assert.equal(memory.tavernLog.m.acknowledged, true);
    for (const input of [{ limit: 101, auto: false }, { limit: 1.5, auto: false }, { limit: 40, auto: 'false' }, { limit: 40, auto: true, persona: 'other' }]) {
        assert.throws(() => updateBindingSettings(state, { bindingId: 'binding', avatar: 'a', persona: 'p', chatId: 'chat', ...input }));
        assert.equal(binding.limit, 100); assert.equal(binding.auto, false);
    }
});
