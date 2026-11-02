import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanStoryText, parseRemovalRules, newBinding, publishTavern, exchange, acknowledgeTavern, updateBindingSettings, resyncTavern } from './core.mjs';
const rules = '<think></think>\n<thinking></thinking>\n<details></details>\n<disclaimer></disclaimer>';
test('自定义标签清理：嵌套/属性/大小写/残缺边界，未指定格式与正文保留，重复清理稳定', () => {
 const original = '</think><thinking>analysis</thinking>正文<br>对话<details class="x"><summary>行动选项</summary><details>嵌套</details></details><>CONTENT AUTHORIZATION PROTOCOL MAINTAINED:声明</disclaimer>';
 // Only the explicitly recognized disclaimer marker is used for its malformed opener.
 assert.equal(cleanStoryText('正文<THINK data-x="a">分析<think>细节</think></THINK>结尾', rules), '正文结尾');
 assert.equal(cleanStoryText('</think><thinking>分析</thinking>正文', rules), '正文');
 assert.equal(cleanStoryText('正文<think>分析',rules), '正文');
 assert.equal(cleanStoryText('正文<details><details>选项</details></details>结尾',rules), '正文结尾');
 assert.equal(cleanStoryText('正文<br>对话<unknown>保留</unknown>',rules), '正文<br>对话<unknown>保留</unknown>');
 const out=cleanStoryText(original,rules); assert.equal(out, '正文<br>对话'); assert.equal(cleanStoryText('正文</think>结尾',rules),'正文结尾'); assert.equal(cleanStoryText(out,rules),out);
 assert.throws(()=>parseRemovalRules('.*')); assert.throws(()=>parseRemovalRules('<a></b>'));
});
function fixture() { const state={catalogs:[{deviceId:'d',maskId:'m',characters:[{id:'c'}]}],bindings:[],memories:{}}; const b=newBinding(state,{deviceId:'d',maskId:'m',charId:'c',avatar:'a',persona:'p',chatId:'chat',limit:40,auto:false});return {state,b,input:{...b,bindingId:b.id}}; }
test('重新同步清理已回执副本，空正文也发替换标记；不改ID、不改Mochi长期记忆',()=>{
 const {state,b,input}=fixture(); const raw=[{id:'one',role:'assistant',text:'<think>分析</think>正文'},{id:'empty',role:'assistant',text:'<think>分析</think>'}];
 publishTavern(state,{...input,lines:raw}); const first=exchange(state,{...input,lines:[],savedMemories:[{id:'s',kind:'记忆',date:'2026-11-01',text:'长期约定'}]}); acknowledgeTavern(state,{...input,receipts:first.pending});
 assert.equal(exchange(state,{...input,lines:[]}).pending.length,0);
 updateBindingSettings(state,{...input,limit:40,auto:false,removalRules:rules,timeMode:'reality'});
 assert.equal(resyncTavern(state,input).count,2); const next=exchange(state,{...input,lines:[]});
 assert.equal(next.pending[0].text,'正文');assert.equal(next.pending[1].text,'');assert.ok(next.pending.every(l=>l.repair));assert.equal(next.lines.length,1);
 assert.notEqual(next.pending[0].revision,first.pending[0].revision);assert.equal(state.memories[b.id].savedMemories[0].text,'长期约定');
 resyncTavern(state,input); assert.equal(exchange(state,{...input,lines:[]}).pending[0].revision,next.pending[0].revision);
 assert.throws(()=>resyncTavern(state,{...input,persona:'other'}));assert.throws(()=>resyncTavern(state,{...input,maskId:'other'},true));
});
test('同步时间只传绝对时间与角色时区，缺少字段兼容旧客户端',()=>{
 const {state,b,input}=fixture(); const last=Date.now()-60000;
 exchange(state,{...input,lines:[],timeContext:{enabled:true,timeZone:'America/New_York',lastOnlineAt:last}});
 let result=publishTavern(state,{...input,lines:[]});assert.equal(result.timeContext.lastOnlineAt,last);assert.equal(result.timeContext.timeZone,'America/New_York');
 exchange(state,{...input,lines:[]});assert.equal(state.memories[b.id].timeContext.lastOnlineAt,last);
 assert.throws(()=>exchange(state,{...input,lines:[],timeContext:{enabled:true,timeZone:'bad-zone'}}));
});
