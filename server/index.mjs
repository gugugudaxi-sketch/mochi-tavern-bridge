import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cleanLines, validId, newBinding, exchange, publishTavern, tupleMatches } from './core.mjs';

export const info = { id: 'mochi-bridge', name: 'Mochi 记忆互通（测试版）', description: '本机双向聊天记忆桥接；不修改角色卡、面具和世界书。' };
const directory = path.dirname(fileURLToPath(import.meta.url));
const stateFile = path.join(directory, 'bridge-state.json');
let server;
let state;
let serial = Promise.resolve();
const transact = action => { const next = serial.then(action); serial = next.catch(() => {}); return next; };
async function persist(next) {
    const temporary = `${stateFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, stateFile);
    state = next;
}
function authenticated(token) {
    const expected = Buffer.from(state.token), supplied = Buffer.from(String(token || ''));
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function mutate(action) { return transact(async () => { const next = structuredClone(state); const result = action(next); if (JSON.stringify(next) !== JSON.stringify(state)) await persist(next); return result; }); }
function reply(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('同步请求过大'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export async function init(router) {
    try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
    catch (e) {
        if (e.code !== 'ENOENT') throw new Error('互通存档无法读取，已停止启动，未覆盖旧数据');
        await persist({ version: 1, token: randomBytes(32).toString('hex'), owner: null, catalogs: [], bindings: [], memories: {} });
    }
    if (state.version !== 1 || typeof state.token !== 'string' || !Array.isArray(state.bindings)) throw new Error('互通存档格式不兼容');
    if (server?.listening) throw new Error('互通接口已经启动');
    // Management routes stay behind SillyTavern's session, login and CSRF middleware.
    router.use((req, res, next) => {
        const owner = req.user?.profile?.handle;
        if (!owner) return res.status(401).json({ error: '请先登录酒馆' });
        if (state.owner && state.owner !== owner) return res.status(403).json({ error: '测试版仅支持配对的酒馆账户' });
        req.mochiOwner = owner; next();
    });
    router.get('/state', async (req, res) => {
        try { await mutate(s => { s.owner ||= req.mochiOwner; }); res.set('Cache-Control', 'no-store').json({ protocol: 1, port: 18181, token: state.token, catalogs: state.catalogs, bindings: state.bindings }); }
        catch { res.status(500).json({ error: '无法保存配对信息' }); }
    });
    router.post('/bind', async (req, res) => { try { const binding = await mutate(s => { s.owner ||= req.mochiOwner; return newBinding(s, req.body); }); res.json({ binding }); } catch (e) { res.status(400).json({ error: e.message }); } });
    router.post('/unbind', async (req, res) => { try { await mutate(s => { s.bindings = s.bindings.filter(b => b.id !== req.body.id); delete s.memories[req.body.id]; }); res.json({ ok: true }); } catch { res.status(500).json({ error: '解除绑定失败' }); } });
    router.post('/tavern', async (req, res) => { try { res.json(await mutate(s => publishTavern(s, req.body))); } catch (e) { res.status(400).json({ error: e.message }); } });
    // Separate loopback-only listener: native APK does not borrow the browser's ST session or disable ST CSRF.
    server = http.createServer(async (req, res) => {
        if (req.method !== 'POST') return reply(res, 405, { error: '仅支持 POST' });
        if (!authenticated(req.headers['x-mochi-token'])) return reply(res, 401, { error: '配对码不正确' });
        if (!state.owner) return reply(res, 409, { error: '请先在酒馆打开互通扩展完成初始化' });
        // No CORS permission: use native HTTP on APK; other websites cannot read this local endpoint.
        try {
            const body = await readBody(req);
            if (req.url === '/health') return reply(res, 200, { protocol: 1 });
            for (const key of ['deviceId', 'maskId']) if (!validId(body[key])) throw new Error('设备或面具标识无效');
            if (req.url === '/catalog') {
                if (!Array.isArray(body.characters) || body.characters.length > 2000 || body.characters.some(c => !validId(c.id) || !validId(c.name))) throw new Error('角色列表无效');
                await mutate(s => {
                    const catalog = { deviceId: body.deviceId, maskId: body.maskId, maskLabel: String(body.maskLabel || body.maskId).slice(0, 200), characters: body.characters.map(c => ({ id: c.id, name: c.name })) };
                    const index = s.catalogs.findIndex(c => c.deviceId === body.deviceId && c.maskId === body.maskId);
                    if (index < 0) { if (s.catalogs.length >= 100) throw new Error('测试版档案数量已达上限'); s.catalogs.push(catalog); } else s.catalogs[index] = catalog;
                });
                return reply(res, 200, { ok: true });
            }
            if (req.url === '/binding') return reply(res, 200, { binding: state.bindings.find(b => tupleMatches(b, body)) || null });
            if (req.url === '/exchange') return reply(res, 200, await mutate(s => exchange(s, body)));
            reply(res, 404, { error: '接口不存在' });
        } catch (e) { reply(res, 400, { error: e.message || '同步失败' }); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18181, '127.0.0.1', resolve); });
    console.log('[Mochi Bridge] 测试版本机接口已启动：127.0.0.1:18181');
}
export async function exit() { if (server?.listening) await new Promise(resolve => server.close(resolve)); await serial; }
