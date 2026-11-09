import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const script = (await fs.readFile(new URL('./index.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+\n/, '')
    .replace("await import('../../../../scripts/personas.js')", 'personaApi');

function setup(chats) {
    const binding = { id: 'bound', avatar: 'target.png', chatId: 'target', persona: 'persona.png' };
    const c = { characterId: 0, characters: [{ avatar: 'old.png' }, { avatar: 'target.png' }], chatId: 'old', getRequestHeaders: () => ({}) };
    const calls = [];
    const sandbox = {
        document: { readyState: 'loading', addEventListener() {} },
        SillyTavern: { getContext: () => c },
        user_avatar: 'old.png',
        fetch: async url => {
            assert.equal(url, '/api/plugins/mochi-bridge/state');
            return { ok: true, text: async () => JSON.stringify({ bindings: [binding], catalogs: [], token: 'test' }) };
        },
        getPastCharacterChats: async id => { assert.equal(id, 1); return chats; },
        selectCharacterById: async id => { calls.push('character'); c.characterId = id; c.chatId = 'other'; },
        openCharacterChat: async id => { calls.push('chat'); c.chatId = id; },
        personaApi: {
            getUserAvatars: async () => ['persona.png'],
            setUserAvatar: async persona => { calls.push('persona'); sandbox.user_avatar = persona; },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    return { c, sandbox, calls, open: id => vm.runInContext('openBoundChat(' + JSON.stringify(id) + ')', sandbox) };
}

test('opens the precise existing character, chat and persona without pushing messages', async () => {
    const { open, c, sandbox, calls } = setup([{ file_name: 'target.jsonl' }]);
    await open('bound');
    assert.deepEqual(calls, ['character', 'chat', 'persona']);
    assert.equal(c.chatId, 'target');
    assert.equal(sandbox.user_avatar, 'persona.png');
    await open('bound');
    assert.deepEqual(calls, ['character', 'chat', 'persona']);
});

test('missing or stale binding does not open another chat', async () => {
    const { open, c, calls } = setup([{ file_name: 'different.jsonl' }]);
    await assert.rejects(open('bound'), /存档已找不到/);
    await assert.rejects(open('unbound'), /找不到这个绑定/);
    assert.equal(c.chatId, 'old');
    assert.deepEqual(calls, []);
});
