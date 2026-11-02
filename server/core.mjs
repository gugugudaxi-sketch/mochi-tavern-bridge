import { randomUUID } from 'node:crypto';

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
    memory.mochi = lines;
    return { bindingId: binding.id, lines: memory.tavern };
}
export function publishTavern(state, input) {
    const binding = state.bindings.find(b => b.id === input.bindingId && tavernMatches(b, input));
    if (!binding) throw new Error('当前面具、角色或聊天记录与绑定不符');
    const memory = state.memories[binding.id] ||= { mochi: [], tavern: [] };
    memory.tavern = cleanLines(input.lines, binding.limit);
    return { bindingId: binding.id, lines: memory.mochi };
}
