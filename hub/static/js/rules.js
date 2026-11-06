// Automations. Preview describes decisions; only real household events execute automations. A7 P1: the faceplate says
// how many are on and whether a run needs a look; the list, the builder (a form), the history and the events are sections.
import { api, askFirst, empty, ensure, h, post, toast, when } from './core.js';
import { faceplate, faceplateLoading, section } from './page-parts.js';
import { firstFew } from './section-links.js';
export const every=30;
const STATUS={succeeded:['Completed','ok'],failed:['Failed','bad'],blocked:['Blocked','warn'],skipped:['Skipped','warn'],running:['No completion recorded','warn'],would_run:['Would run','ok']};

export function mount(state) {
  state.filter='all';
  state.rules=h('div',{});state.builder=h('div',{});state.preview=h('div',{class:'rule-preview',role:'status'});
  state.history=h('div',{});state.events=h('div',{});
  state.plate=h('div',{},faceplateLoading('Automations'));
  state.root.append(state.plate,state.rules,
    section('Build an automation',[state.builder,state.preview],{note:'Preview a rule against recent events before enabling it. Real runs leave a trail of what happened and why.'}),
    state.history,state.events);
}
function select(name,label,items,value) {
  return h('label',{class:'field',for:`rule-${name}`},h('span',{},label),
    h('select',{name,id:`rule-${name}`},items.map(item=>h('option',{value:item.key,selected:item.key===value},item.label))));
}
function builder(state,d) {
  const form=h('form',{class:'rule-form'});
  const target=select('target','Which light or plug',d.accessories.map(a=>({key:a.id,label:a.name})),d.accessories[0]?.id);
  if(!d.accessories.length)target.append(h('span',{class:'meta'},'Connect Homebridge in Settings to choose a light or plug.'));
  const action=select('action','Then',d.actions,'notify');
  const button=h('button',{type:'button',class:'primary',onclick:()=>preview(state,Object.fromEntries(new FormData(form)))},'Preview safely');
  form.append(select('trigger','When',d.triggers,'print_finished'),action,target,
    h('div',{class:'feature-actions'},button,h('button',{type:'submit',class:'ghost'},'Add & enable')));
  const sync=()=>{target.hidden=!d.actions.find(a=>a.key===form.elements.action.value)?.needs_target;};
  form.addEventListener('change',()=>{sync();state.previewVersion=(state.previewVersion||0)+1;state.preview.replaceChildren();});sync();
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!(await ensure('household')))return;
    const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try{await post('/api/rules',Object.fromEntries(new FormData(form)));toast('Automation added and enabled.');await load(state);}
    catch(x){toast(x.message,'bad');}finally{submit.disabled=false;}
  });
  return form;
}
async function preview(state,rule) {
  if(state.previewBusy || !(await ensure('household')))return;
  state.previewBusy=true;
  const version=state.previewVersion||0;
  state.preview.replaceChildren(h('p',{},'Replaying recent events without running any actions…'));
  try{
    const d=await post('/api/rules/preview',rule);if(!state.root.isConnected || version!==(state.previewVersion||0))return;
    state.preview.replaceChildren(h('p',{class:'ui-chip ui-chip--unknown'},'Preview: no actions run'),h('h3',{},d.text),
      h('div',{class:'feature-metrics'},...[[d.matches,`matching events${d.capped?' (latest 100)':''}`],[d.would_run,'would run'],[d.would_skip+d.blocked,'would skip or block']].map(([n,label])=>h('div',{},h('strong',{},String(n)),h('span',{},label)))),
      h('p',{class:'match-reason'},`If this happened now: ${d.now.message}`),
      d.matches?h('ul',{class:'log'},d.samples.map(item=>h('li',{class:'log-row'},h('span',{class:'dot',dataset:{tone:STATUS[item.status]?.[1]||'warn'}}),
        h('span',{class:'log-main'},h('strong',{},item.message),item.detail?h('span',{class:'meta'},item.detail):null),h('span',{class:'log-side'},when(item.ts)))))
        :h('p',{class:'feature-empty'},'No matching events in the last 30 days. The “if it happened now” check is hypothetical.'),
      h('p',{class:'meta'},d.note));
    state.preview.scrollIntoView({block:'nearest'});
  }catch(e){state.preview.replaceChildren(h('p',{class:'note'},e.message));}
  finally{state.previewBusy=false;}
}
function renderHistory(state) {
  const runs=state.data.runs||[];
  const attention=runs.filter(r=>['failed','blocked','running'].includes(r.status));
  const shown=state.filter==='attention'?attention:runs;
  state.history.replaceChildren(section('Automation history',[
    h('div',{class:'ui-chips','role':'group','aria-label':'Show'},...[['all',`All · ${runs.length}`],['attention',`Needs a look · ${attention.length}`]].map(([key,label])=>h('button',{
      type:'button','aria-pressed':String(state.filter===key),onclick:()=>{state.filter=key;renderHistory(state);}},label))),
    ...(shown.length?firstFew(shown.map(run=>{
      const [label,tone]=STATUS[run.status]||[run.status,'warn'];
      return h('li',{},h('div',{class:'run-outcome'},h('span',{class:'feature-tag',dataset:{tone}},label),h('time',{},when(run.ts))),
        h('strong',{},run.rule_text),h('p',{},run.message),h('span',{class:'meta'},run.elapsed_ms?`${(run.elapsed_ms/1000).toFixed(1)} seconds`:['skipped','blocked'].includes(run.status)?'No device action was run.':'Recorded by the hub.'));
    }),{n:6,cls:'automation-history',noun:'runs'}):[empty(state.filter==='attention'?'No failed or blocked runs in this history.':'The next matching household event will leave its outcome here. Previewing a rule never adds a real run.')])],
    {note:'The latest 60 outcomes from the last 30 days. Removing a rule keeps its recorded outcomes.'}));
}
export async function load(state) {
  const d=await api('/api/rules');if(!state.root.isConnected)return;
  state.data=d;
  if(!state.builder.childElementCount)state.builder.append(builder(state,d));
  state.plate.replaceChildren(automationsPlate(d));
  state.rules.replaceChildren(section('Your automations',[
    d.rules.length?h('ul',{class:'rules'},d.rules.map(r=>h('li',{class:'rule',dataset:{on:String(!!r.enabled)}},
      h('label',{class:'switch'},h('input',{type:'checkbox',role:'switch',checked:!!r.enabled,'aria-label':r.text,onchange:async e=>{
        if(!(await ensure('household'))){e.target.checked=!e.target.checked;return;}
        try{await post(`/api/rules/${r.id}/toggle`);await load(state);}catch(x){e.target.checked=!e.target.checked;toast(x.message,'bad');}
      }}),h('span',{class:'switch-track','aria-hidden':'true'})),
      h('span',{class:'rule-main'},h('strong',{},r.text),h('span',{class:'meta'},r.last_run?`${when(r.last_run)} · ${r.last_result}`:'Waiting for its first matching event.')),
      ...ruleActions(state,r)))):empty('No automations yet. Build and preview one below.'),
    d.alerts_ready?null:h('p',{class:'ui-notice ui-notice--warn'},'Phone alerts need an alert topic in Settings. Preview will explain which alerts would be blocked.')]));
  renderHistory(state);
  state.events.replaceChildren(section('What the hub noticed',
    d.events.length?h('ul',{class:'log'},d.events.slice(0,12).map(e=>h('li',{class:'log-row'},h('span',{class:'dot',dataset:{tone:/dropped|failed|down|stopped|hot/.test(e.kind)?'warn':'ok'}}),h('span',{class:'log-main'},h('strong',{},e.text.charAt(0).toUpperCase()+e.text.slice(1)),e.detail?h('span',{class:'meta'},e.detail):null),h('span',{class:'log-side'},when(e.ts)))))
      :empty('Household events appear here as the hub observes them.')));
}

// A rule's Preview and Remove: the row's buttons on a wide row, and the same two inside the row's disclosure on a narrow
// one (A10 plan decision 17; the list's own width decides, household-features.css). The hidden copy is display: none, so
// only one pair is ever in the tab order or read out.
export function ruleActions(state,r){
  const pair=()=>[h('button',{type:'button',class:'ghost small',onclick:()=>preview(state,r)},'Preview'),h('button',{type:'button',class:'ghost small','aria-label':`Remove ${r.text}`,onclick:async(e)=>{
    const btn=e.currentTarget;
    if(!(await ensure('household'))||!(await askFirst(btn,`The automation “${r.text}” stops and is removed. Its run history stays.`,{confirm:'Remove'})))return;
    try{await post(`/api/rules/${r.id}/delete`);await load(state);}catch(x){toast(x.message,'bad');}
  }},'Remove')];
  return [h('div',{class:'feature-actions'},...pair()),
    h('details',{class:'rule-more'},h('summary',{},'Preview or remove'),h('div',{class:'feature-actions'},...pair()))];
}

// The faceplate (A7 P1): how many automations are on, and whether a recent run needs a look.
export function automationsPlate(d) {
  const rules=Array.isArray(d?.rules)?d.rules:[], runs=Array.isArray(d?.runs)?d.runs:[];
  const on=rules.filter(r=>r.enabled).length;
  const attention=runs.filter(r=>['failed','blocked','running'].includes(r.status)).length;
  return faceplate({name:'Automations',
    lamp:attention?['warn',`${attention} ${attention===1?'needs':'need'} a look`]:rules.length?['ok','Running']:null,
    readout:String(on),unit:'on',
    caption:rules.length?`Of ${rules.length} automation${rules.length===1?'':'s'}. Each runs only on a real household event.`:'No automations yet. Build one below and preview it first.',
    readings:[['Last run',runs[0]?.ts?when(runs[0].ts):null],['Phone alerts',d?.alerts_ready===false?'Not set up':d?.alerts_ready?'Ready':null]]});
}
