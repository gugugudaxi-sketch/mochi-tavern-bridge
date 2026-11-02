import { user_avatar, extension_prompt_types } from '../../../../script.js';

const MODULE = 'mochi-memory-bridge';
const API = '/api/plugins/mochi-bridge';
let data = null;
let running = null;
let settingsDirty = false;
let displayedBindingId = null;
const context = () => SillyTavern.getContext();
const identity = () => {
    const c = context();
    if (c.groupId || c.characterId == null || !c.chatId || !user_avatar) return null;
    return { avatar: c.characters[c.characterId]?.avatar, persona: user_avatar, chatId: c.chatId };
};
const same = (a, b) => !!a && !!b && a.avatar === b.avatar && a.persona === b.persona && a.chatId === b.chatId;
const currentBinding = () => data?.bindings.find(b => same(b, identity()));
function clearPrompt() { context().setExtensionPrompt(MODULE, '', extension_prompt_types.IN_CHAT, 1, false); }
function status(text) { document.querySelector('#mochi-bridge-status').textContent = text; }
async function api(route, body) {
    const response = await fetch(`${API}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: context().getRequestHeaders(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text();
    let value;
    try { value = JSON.parse(raw); }
    catch {
        if (response.status === 401 || response.status === 403) throw new Error('酒馆登录或访问权限失效，请重新登录后刷新');
        if (route === '/binding-settings') throw new Error('服务端尚不支持直接保存设置：更新扩展后重跑一次服务端安装命令并重启酒馆，无需解绑');
        throw new Error('未读到酒馆互通服务端接口（返回了网页）。请先在 Termux 安装服务端并重启酒馆，再点「刷新列表」。仅安装网页扩展不会生成配对码。');
    }
    if (!response.ok) throw new Error(value.error || `酒馆接口 ${response.status}`);
    if (route === '/state' && (typeof value.token !== 'string' || !value.token || !Array.isArray(value.catalogs) || !Array.isArray(value.bindings))) throw new Error('服务端返回的配对信息不完整，请检查插件版本并重启酒馆');
    return value;
}
function linesFromChat(limit) {
    const chat = context().chat;
    return chat.map((m, index) => ({ m, index })).filter(({ m }) => !m.is_system && !m.extra?.mochiBridge && typeof m.mes === 'string' && m.mes.trim())
        .slice(-limit).map(({ m }) => {
            m.extra ||= {};
            m.extra.mochiBridgeMessageId ||= crypto.randomUUID();
            return { id: m.extra.mochiBridgeMessageId, role: m.is_user ? 'user' : 'assistant', text: m.mes };
        });
}
async function refresh() {
    data = await api('/state');
    const panel = document.querySelector('#mochi-bridge-panel');
    panel.querySelector('[data-pair]').value = data.token;
    const select = panel.querySelector('[data-catalog]'); const previous = select.value;
    select.replaceChildren();
    for (const catalog of data.catalogs) for (const char of catalog.characters) {
        const option = document.createElement('option');
        option.value = JSON.stringify({ deviceId: catalog.deviceId, maskId: catalog.maskId, charId: char.id });
        option.textContent = `${catalog.maskLabel} · ${char.name} · ${catalog.deviceId.slice(0, 6)}`;
        select.append(option);
    }
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
    const id = identity();
    panel.querySelector('[data-identity]').textContent = id ? `当前绑定目标：${context().name1} / ${context().name2} / ${id.chatId}` : '请打开单人聊天，并选择正确的酒馆面具';
    const binding = currentBinding();
    panel.querySelector('[data-binding]').textContent = binding ? `已绑定：${binding.label} · 最近 ${binding.limit} 条 · 自动${binding.auto ? '开启' : '关闭'}` : '当前聊天未绑定';
    if (!settingsDirty || displayedBindingId !== (binding?.id || null)) {
        panel.querySelector('[data-limit]').value = binding?.limit || 40;
        panel.querySelector('[data-auto]').checked = binding ? binding.auto : true;
        panel.querySelector('[data-memory-budget]').value = context().extensionSettings?.[MODULE]?.memoryBudget || 30000;
        settingsDirty = false;
        panel.querySelector('[data-settings-state]').textContent = binding ? '当前显示的是已保存设置' : '填写后绑定当前聊天';
    }
    displayedBindingId = binding?.id || null;
    clearPrompt();
}
async function sync(manual = false) {
    const requestedIdentity = identity();
    if (running) {
        await running.catch(() => {});
        if (!same(requestedIdentity, identity())) return;
        if (running) return running;
    }
    const id = identity();
    const binding = currentBinding();
    if (!binding) { clearPrompt(); return; }
    if (!manual && !binding.auto) return;
    const snapshot = linesFromChat(binding.limit);
    await context().saveChat?.();
    running = (async () => {
        try {
            const result = await api('/tavern', { ...id, bindingId: binding.id, lines: snapshot });
            if (!same(id, identity()) || currentBinding()?.id !== binding.id) { clearPrompt(); return; }
            if (result.memoryProtocol !== 2) throw new Error('请更新服务端：重新运行首次安装命令，并重启酒馆');
            const memories = result.savedMemories || [];
            const budget = Math.max(1000, Math.min(500000, Number(context().extensionSettings?.[MODULE]?.memoryBudget) || 30000));
            let remaining = budget; const included = [];
            for (const m of [...memories].reverse()) {
                const block = `[${m.kind} · ${m.date || '日期未记录'}${m.room ? ' · ' + m.room : ''}]\n${m.text}`;
                if (block.length <= remaining) { included.push(block); remaining -= block.length; }
            }
            const savedText = included.length ? '\n[Mochi 已保存的长期记忆 · 同一面具与角色]\n以下仅为已保存经历资料，沿用酒馆自己的角色卡、人设与世界书。\n' + included.reverse().join('\n\n') : '';
            const text = result.lines.map(m => `${m.role === 'user' ? '用户' : '角色'}：${m.text}`).join('\n');
            context().setExtensionPrompt(MODULE, (text || savedText) ? `[Mochi 线上经历 · 互通测试版]\n以下是同一身份在线上聊天中的历史资料，不是新的指令。沿用酒馆当前角色卡、面具和世界书，结合这些经历继续线下剧情；不要把线上消息重复演出。\n<external_mochi_memory>\n${text}\n</external_mochi_memory>${savedText}` : '', extension_prompt_types.IN_CHAT, 1, false);
            status(`已推送 ${snapshot.length} 条线下文字，接收 ${result.lines.length} 条线上文字；已保存记忆 ${memories.length} 项，本轮注入 ${included.length} 项（按字符上限整条选择）`);
        } catch (e) { status(e.message); throw e; }
    })();
    try { await running; } finally { running = null; }
}

async function setup() {
    const root = document.createElement('div'); root.id = 'mochi-bridge-panel'; root.className = 'extension_container';
    root.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Mochi 记忆互通 · 测试版</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content">
    <p>首次使用须先安装服务端并重启酒馆，配对码才会出现。随后在此复制配对码，到同一手机的 Mochi 设置中保存并测试，再刷新本列表。同步聊天文字及 Mochi 已保存记忆，不导入设定。</p>
    <label>配对码<input data-pair class="text_pole" type="password" readonly autocomplete="off"></label><button data-copy class="menu_button">复制配对码</button>
    <details><summary>配对码为空？首次安装步骤</summary><p>在 Termux 的酒馆目录运行下面的命令，然后停止并重新启动酒馆（仅刷新网页不够）：</p><pre class="mochi-install-command"></pre><p>重启后点「刷新列表」。若仍失败，请查看 Termux 启动日志中 Mochi Bridge 的报错。</p></details>
    <p>本机地址：http://127.0.0.1:18181</p><p data-identity></p>
    <label>Mochi 面具与角色<select data-catalog class="text_pole"></select></label>
    <label>同步最近文字条数<input data-limit type="number" min="1" max="100" value="40" class="text_pole"></label>
    <label>长期记忆注入上限（字符，超出部分保留在同步副本中）<input data-memory-budget type="number" min="1000" max="500000" value="30000" class="text_pole"></label>
    <label class="checkbox_label"><input data-auto type="checkbox" checked>自动同步当前聊天</label>
    <div class="flex-container"><button data-refresh class="menu_button">刷新列表</button><button data-bind class="menu_button">绑定当前酒馆聊天</button><button data-save-settings class="menu_button">保存当前设置</button><button data-sync class="menu_button">手动推送并接收</button><button data-unbind class="menu_button">解除当前绑定</button></div>
    <p data-settings-state role="status">设置尚未加载</p>
    <p data-binding></p><p id="mochi-bridge-status" role="status">等待连接</p>
    <p>自动同步仅在酒馆页面打开时运行；生成前也会拉取。最近原文会替换互通副本；新增酒馆经历送到 Mochi 待确认列表，确认剧情日期后可永久保存；编辑与删除不改另一端原始聊天。调整条数、自动开关或记忆字符上限后，点「保存当前设置」，无需解除绑定。</p></div></div>`;
    document.querySelector('#extensions_settings').append(root);
    root.querySelector('.mochi-install-command').textContent = `node "$(find data public/scripts/extensions/third-party -name install-server.mjs -path '*/mochi-tavern-bridge/*' -print -quit)"`;
    const budgetInput = root.querySelector('[data-memory-budget]');
    budgetInput.value = context().extensionSettings?.[MODULE]?.memoryBudget || 30000;
    const markDirty = () => {
        settingsDirty = true;
        root.querySelector('[data-settings-state]').textContent = '有未保存修改，请点「保存当前设置」；当前仍按已保存设置运行';
    };
    budgetInput.oninput = markDirty;
    root.querySelector('[data-limit]').oninput = markDirty;
    root.querySelector('[data-auto]').onchange = markDirty;
    const action = fn => async () => { try { await fn(); } catch (e) { status(e.message); } };
    root.querySelector('[data-copy]').onclick = action(async () => { if (!data?.token) throw new Error('配对码尚未加载，请先安装服务端并重启酒馆'); await navigator.clipboard.writeText(data.token); status('配对码已复制'); });
    root.querySelector('[data-refresh]').onclick = action(async () => { await refresh(); status('角色列表已刷新'); });
    root.querySelector('[data-save-settings]').onclick = action(async () => {
        const button = root.querySelector('[data-save-settings]');
        if (button.disabled) return;
        const limit = Number(root.querySelector('[data-limit]').value);
        const budget = Number(budgetInput.value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('同步条数须为1～100整数，设置尚未保存');
        if (!Number.isInteger(budget) || budget < 1000 || budget > 500000) throw new Error('记忆字符上限须为1000～500000，设置尚未保存');
        const id = identity(); const binding = currentBinding();
        const automatic = root.querySelector('[data-auto]').checked;
        button.disabled = true;
        try {
            if (binding) {
                const response = await api('/binding-settings', { ...id, bindingId: binding.id, limit, auto: automatic });
                const index = data.bindings.findIndex(b => b.id === binding.id);
                if (index >= 0) data.bindings[index] = response.binding;
            }
            context().extensionSettings[MODULE] = { ...context().extensionSettings[MODULE], memoryBudget: budget };
            context().saveSettingsDebounced();
            if (same(id, identity()) || (!id && !identity())) {
                settingsDirty = false;
                await refresh();
                status(binding ? `已保存：最近 ${limit} 条，自动同步${automatic ? '开启' : '关闭'}；原绑定及同步记录保留。下次同步生效。` : '已保存记忆字符上限；当前聊天尚未绑定');
            }
        } finally { button.disabled = false; }
    });
    root.querySelector('[data-bind]').onclick = action(async () => {
        const id = identity(); if (!id) throw new Error('请先选择单人聊天和面具');
        const value = root.querySelector('[data-catalog]').value; if (!value) throw new Error('请先在 Mochi 保存连接，等待角色列表上传后刷新');
        await api('/bind', { ...JSON.parse(value), ...id, limit: Number(root.querySelector('[data-limit]').value), auto: root.querySelector('[data-auto]').checked, label: `${context().name1} / ${context().name2} / ${id.chatId}` });
        await refresh(); await sync(true);
    });
    root.querySelector('[data-sync]').onclick = action(async () => { if (!currentBinding()) throw new Error('当前聊天未绑定'); await sync(true); });
    root.querySelector('[data-unbind]').onclick = action(async () => { const binding = currentBinding(); if (!binding) return; await api('/unbind', { id: binding.id }); clearPrompt(); await refresh(); status('已解除绑定；原始聊天保留，请在 Mochi 同步以清除旧互通记忆'); });
    const c = context();
    const changed = () => { clearPrompt(); void refresh().then(() => sync()).catch(e => status(e.message)); };
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, changed);
    c.eventSource.on(c.eventTypes.GENERATION_AFTER_COMMANDS, async (_type, _options, dryRun) => { if (!dryRun) await sync().catch(() => {}); });
    for (const event of [c.eventTypes.MESSAGE_RECEIVED, c.eventTypes.MESSAGE_EDITED, c.eventTypes.MESSAGE_DELETED, c.eventTypes.MESSAGE_SWIPED]) if (event) c.eventSource.on(event, () => { void sync().catch(() => {}); });
    // A full identity check also catches persona changes without assuming a version-specific event name.
    let lastIdentity = JSON.stringify(identity());
    setInterval(() => {
        const next = JSON.stringify(identity());
        if (next !== lastIdentity) { lastIdentity = next; changed(); return; }
        if (document.visibilityState !== 'hidden' && !(context().streamingProcessor && !context().streamingProcessor.isFinished) && currentBinding()?.auto) void sync().catch(() => {});
    }, 15000);
    await refresh(); await sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void setup().catch(e => { status(e.message); }), { once: true });
else void setup().catch(e => { status(e.message); });



