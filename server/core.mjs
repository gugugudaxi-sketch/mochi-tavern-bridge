import { createHash, randomUUID } from 'node:crypto';

export function cleanLines(value, limit = 100, maxChars = 60000) {
    if (!Array.isArray(value) || value.length > 100) throw new Error('消息范围无效');
    let size = 0;
    const ids = new Set();
    return value.map(line => {
        if (!line || typeof line.id !== 'string' || line.id.length > 200 || ids.has(line.id) || !['user', 'assistant'].includes(line.role) || typeof line.text !== 'string') throw new Error('消息格式无效');
        ids.add(line.id); size += line.text.length;
        if (size > maxChars) throw new Error(`文字超过本次传输上限（${maxChars}字符），请分批上传`);
        return { id: line.id, role: line.role, text: line.text };
    }).slice(-limit);
}
export function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value); }
export function tupleMatches(binding, request) {
    return binding.deviceId === request.deviceId && binding.maskId === request.maskId && binding.charId === request.charId;
}
export function tavernMatches(binding, request) {
    return binding.avatar === request.avatar && binding.persona === request.persona && binding.chatId === request.chatId;
}
export function newBinding(state, input) {
    for (const key of ['deviceId', 'maskId', 'charId', 'avatar', 'persona', 'chatId']) if (!validId(input[key])) throw new Error(`缺少绑定标识：${key}`);
    const catalog = state.catalogs.find(c => c.deviceId === input.deviceId && c.maskId === input.maskId);
    if (!catalog?.characters.some(c => c.id === input.charId)) throw new Error('请先从 Mochi 连接并刷新角色列表');
    if (state.bindings.some(b => tupleMatches(b, input) || tavernMatches(b, input))) throw new Error('这组身份已绑定，请先解除原绑定');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('同步范围须为 1～100 条');
    const binding = { id: randomUUID(), deviceId: input.deviceId, maskId: input.maskId, charId: input.charId, avatar: input.avatar, persona: input.persona, chatId: input.chatId, label: String(input.label || input.chatId).slice(0, 200), auto: input.auto === true, limit: input.limit };
    state.bindings.push(binding); return binding;
}
export function exchange(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tupleMatches(b, input));
    if (!binding) throw new Error('绑定已变化，请重新绑定或同步');
    const lines = cleanLines(input.lines, binding.limit);
    const memory = state.memories[binding.id] ||= { mochi: [], tavern: [] };
    const saved = input.savedMemories === undefined ? memory.savedMemories || [] : cleanSavedMemories(input.savedMemories);
    memory.mochi = lines; memory.savedMemories = saved;
    return { memoryProtocol: 2, bindingId: binding.id, lines: memory.tavern, pending: Object.values(memory.tavernLog || {}).filter(l => !l.acknowledged).map(({ acknowledged, ...line }) => line) };
}
export function publishTavern(state, input, largeBatch = false) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tavernMatches(b, input));
    if (!binding) throw new Error('当前面具、角色或聊天记录与绑定不符');
    const memory = state.memories[binding.id] ||= { mochi: [], tavern: [] };
    const lines = cleanLines(input.lines, binding.limit, largeBatch ? 2000000 : 60000);
    const log = { ...(memory.tavernLog || {}) };
    for (const line of lines) {
        const revision = createHash('sha256').update(JSON.stringify([line.role, line.text])).digest('hex');
        if (log[line.id]?.revision !== revision) log[line.id] = { ...line, revision, acknowledged: false };
    }
    const currentIds = new Set(lines.map(l => l.id));
    for (const [id, item] of Object.entries(log)) if (Object.keys(log).length > 10000 && item.acknowledged && !currentIds.has(id)) delete log[id];
    if (Object.values(log).filter(l => !l.acknowledged).reduce((n, l) => n + l.text.length, 0) > 2000000) throw new Error('待接收原文超过200万字符，请先打开 Mochi 接收');
    if (Object.keys(log).length > 10000) throw new Error('酒馆待存档记录已达上限，请先在 Mochi 接收处理');
    memory.tavern = lines; memory.tavernLog = log;
    return { memoryProtocol: 2, bindingId: binding.id, lines: memory.mochi, savedMemories: memory.savedMemories || [] };
}


export function cleanSavedMemories(value) {
    if (!Array.isArray(value) || value.length > 10000) throw new Error('保存记忆数量超过测试版上限（10000项）');
    let size = 0;
    return value.map(m => {
        if (!m || !validId(m.id) || typeof m.text !== 'string' || typeof m.kind !== 'string' || typeof m.date !== 'string') throw new Error('已保存记忆格式无效');
        size += m.text.length;
        if (size > 500000) throw new Error('已保存记忆超过50万字符，请关闭记忆同步或整理后重试');
        return { id: m.id, text: m.text, kind: m.kind.slice(0, 40), date: m.date.slice(0, 40), ...(typeof m.room === 'string' ? { room: m.room.slice(0, 40) } : {}) };
    });
}
export function acknowledgeTavern(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tupleMatches(b, input));
    if (!binding || !Array.isArray(input.receipts) || input.receipts.length > 10000) throw new Error('接收回执或绑定无效');
    const log = state.memories[binding.id]?.tavernLog || {};
    for (const receipt of input.receipts) if (log[receipt.id]?.revision === receipt.revision) log[receipt.id].acknowledged = true;
    return { ok: true };
}


/** Change only mutable settings; identity, receipts and saved memory remain untouched. */
export function updateBindingSettings(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tavernMatches(b, input));
    if (!binding) throw new Error('当前面具、角色或聊天记录与绑定不符，请刷新列表');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('同步范围须为1～100条整数');
    if (typeof input.auto !== 'boolean') throw new Error('自动同步设置无效');
    binding.limit = input.limit;
    binding.auto = input.auto;
    return binding;
}


// Incomplete uploads never enter memories or the pending inbox. Commit verifies all pieces.
const tavernUploads = new Map();
export function acceptTavernBatch(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tavernMatches(b, input));
    if (!binding || !validId(input.uploadId)) throw new Error('分批上传绑定无效，请刷新列表');
    const now = Date.now();
    for (const [key, upload] of tavernUploads) if (now - upload.touchedAt > 600000) tavernUploads.delete(key);
    const key = `${binding.id}:${input.uploadId}`;
    if (input.action === 'start') {
        const messages = input.messages;
        if (!Array.isArray(messages) || messages.length > binding.limit || messages.length > 100) throw new Error('分批上传消息范围无效');
        let total = 0; const ids = new Set();
        for (const m of messages) {
            if (!m || !validId(m.id) || ids.has(m.id) || !['user', 'assistant'].includes(m.role) || !Number.isInteger(m.length) || m.length < 0 || !Number.isInteger(m.parts) || m.parts < 1 || m.parts > 100) throw new Error('分批消息清单无效');
            ids.add(m.id); total += m.length;
        }
        if (total > 2000000) throw new Error('本次原文超过200万字符，请缩小同步条数后重试');
        const prior = tavernUploads.get(key);
        const plan = messages.map(m => ({ id: m.id, role: m.role, length: m.length, parts: m.parts }));
        if (prior) { if (JSON.stringify(prior.plan) !== JSON.stringify(plan)) throw new Error('重复上传的消息清单不一致'); prior.touchedAt = now; return { ok: true }; }
        for (const oldKey of tavernUploads.keys()) if (oldKey.startsWith(binding.id + ':') && oldKey !== key) tavernUploads.delete(oldKey);
        if (tavernUploads.size >= 8) for (const [oldKey, item] of tavernUploads) { if (item.result) tavernUploads.delete(oldKey); if (tavernUploads.size < 8) break; }
        if (tavernUploads.size >= 8) throw new Error('分批上传任务较多，请稍后重试');
        tavernUploads.set(key, { plan, pieces: new Map(), touchedAt: now }); return { ok: true };
    }
    const upload = tavernUploads.get(key);
    if (!upload) throw new Error('分批上传已中断，请重新点手动推送，原聊天未改变');
    upload.touchedAt = now;
    if (input.action === 'part') {
        if (upload.result) return { ok: true };
        if (!Array.isArray(input.pieces) || input.pieces.length > 100 || input.pieces.reduce((n, p) => n + (typeof p?.text === 'string' ? p.text.length : 50001), 0) > 50000) throw new Error('上传分片过大或格式无效');
        // Validate the entire packet before accepting it, so retries cannot leave half a packet.
        const staged = new Map();
        for (const p of input.pieces) {
            const m = upload.plan.find(m => m.id === p.id);
            if (!m || !Number.isInteger(p.part) || p.part < 0 || p.part >= m.parts || typeof p.text !== 'string' || p.text.length > 50000 || p.text.length > m.length) throw new Error('上传分片编号无效');
            const pieceKey = JSON.stringify([p.id, p.part]);
            const previous = staged.has(pieceKey) ? staged.get(pieceKey) : upload.pieces.get(pieceKey);
            if (previous !== undefined && previous !== p.text) throw new Error('重复分片内容不一致');
            staged.set(pieceKey, p.text);
        }
        const prospective = new Map([...upload.pieces, ...staged]);
        for (const m of upload.plan) {
            let length = 0;
            for (let i = 0; i < m.parts; i++) length += prospective.get(JSON.stringify([m.id, i]))?.length || 0;
            if (length > m.length) throw new Error('分片总长度超过原文清单，未接收本批');
        }
        for (const [pieceKey, text] of staged) upload.pieces.set(pieceKey, text);
        return { ok: true };
    }
    if (input.action === 'commit') {
        if (upload.result && state.memories[binding.id]?.lastTavernUploadId === input.uploadId) return upload.result;
        const lines = upload.plan.map(m => {
            const parts = [];
            for (let i = 0; i < m.parts; i++) {
                const pieceKey = JSON.stringify([m.id, i]);
                if (!upload.pieces.has(pieceKey)) throw new Error('原文分片尚未收齐，未写入任何新经历，请重试');
                parts.push(upload.pieces.get(pieceKey));
            }
            const text = parts.join('');
            if (text.length !== m.length) throw new Error('原文长度校验失败，未写入任何新经历');
            return { id: m.id, role: m.role, text };
        });
        const result = publishTavern(state, { ...input, lines }, true);
        state.memories[binding.id].lastTavernUploadId = input.uploadId;
        upload.result = result; return result;
    }
    throw new Error('未知的分批上传操作');
}
