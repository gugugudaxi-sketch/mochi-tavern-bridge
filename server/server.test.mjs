import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('实际本机HTTP：认证、配对、双向同步、持久化、解除绑定', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mochi-bridge-test-'));
    for (const file of ['index.mjs', 'core.mjs']) await fs.copyFile(new URL(file, import.meta.url), path.join(temporary, file));
    const plugin = await import(pathToFileURL(path.join(temporary, 'index.mjs')));
    const routes = new Map(); let middleware;
    const router = { use(fn) { middleware = fn; }, get(route, fn) { routes.set(`GET ${route}`, fn); }, post(route, fn) { routes.set(`POST ${route}`, fn); } };
    const admin = async (method, route, body, owner = 'default-user') => {
        let response, code = 200, allowed = false;
        const req = { body, user: { profile: { handle: owner } } };
        const res = { set() { return res; }, status(value) { code = value; return res; }, json(value) { response = value; return res; } };
        middleware(req, res, () => { allowed = true; });
        if (allowed) await routes.get(`${method} ${route}`)(req, res);
        return { code, data: response };
    };
    try {
        await plugin.init(router);
        const state = await admin('GET', '/state'); const token = state.data.token;
        const call = async (route, body, credential = token) => {
            const res = await fetch(`http://127.0.0.1:18181${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mochi-Token': credential }, body: JSON.stringify(body) });
            return { code: res.status, cors: res.headers.get('access-control-allow-origin'), data: await res.json() };
        };
        assert.equal((await call('/health', {}, 'wrong')).code, 401);
        assert.equal((await call('/health', {})).cors, null);
        assert.equal((await call('/health', {})).data.protocol, 1);
        assert.equal((await admin('GET', '/state', null, 'other-user')).code, 403);
        const identity = { deviceId: 'phone', maskId: 'mask-a', charId: 'char-a' };
        await call('/catalog', { ...identity, characters: [{ id: 'char-a', name: '角色' }], maskLabel: '我' });
        const binding = (await admin('POST', '/bind', { ...identity, avatar: 'char.png', persona: 'user.png', chatId: 'date-a', limit: 40, auto: true })).data.binding;
        assert.ok(binding.id);
        const lines = [{ id: '1', role: 'user', text: '晚上见' }];
        assert.equal((await call('/exchange', { ...identity, bindingId: binding.id, lines })).code, 200);
        const response = await admin('POST', '/tavern', { ...binding, bindingId: binding.id, lines: [{ id: '0', role: 'assistant', text: '我来接你了' }] });
        assert.deepEqual(response.data.lines, lines);
        const back = await call('/exchange', { ...identity, bindingId: binding.id, lines }); assert.equal(back.data.lines[0].text, '我来接你了');
        const disk = JSON.parse(await fs.readFile(path.join(temporary, 'bridge-state.json'), 'utf8')); assert.deepEqual(disk.memories[binding.id].mochi, lines);
        assert.equal((await call('/exchange', { ...identity, maskId: 'wrong', bindingId: binding.id, lines })).code, 400);
        await admin('POST', '/unbind', { id: binding.id });
        assert.equal((await call('/binding', identity)).data.binding, null);
        assert.equal((await call('/exchange', { ...identity, bindingId: binding.id, lines })).code, 400);
    } finally { await plugin.exit(); await fs.rm(temporary, { recursive: true, force: true }); }
});
