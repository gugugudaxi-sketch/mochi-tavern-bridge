import { createHash, randomUUID } from 'node:crypto';

export function cleanLines(value, limit = 100) {
    if (!Array.isArray(value) || value.length > 100) throw new Error('消息范围无效');
    let size = 0;
    const ids = new Set();
    return value.map(line => {
        if (!line || typeof line.id !== 'string' || line.id.length > 200 || ids.has(line.id) || !['user', 'assistant'].includes(line.role) || typeof line.text !== 'string') throw new Error('消息格式无效');
        ids.add(line.id); size += line.text.length;
        if (size > 60000) throw new Error('文字超过六万字符，请缩小同步范围');
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
export function publishTavern(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tavernMatches(b, input));
    if (!binding) throw new Error('当前面具、角色或聊天记录与绑定不符');
    const memory = state.memories[binding.id] ||= { mochi: [], tavern: [] };
    const lines = cleanLines(input.lines, binding.limit);
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
