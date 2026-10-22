import { api, card, ensure, h, post, toast } from './core.js';

function field(label, input) {
  return h('label',{class:'field'},h('span',{},label),input);
}
function options(values, value) {
  return values.map(([key,label])=>h('option',{value:key,selected:String(key)===String(value??'')},label));
}
function editor(state, item={}) {
  const ui=state.projectUI, d=ui.data;
  const draftKey=item.id||"new";
  item={...item,...ui.drafts?.[draftKey]};
  const form=h('form',{class:'project-form'});
  const name=h('input',{name:'title',required:true,maxlength:100,value:item.title||'',placeholder:'A new idea for the workshop'});
  const notes=h('textarea',{name:'notes',maxlength:2000,rows:3,placeholder:'Print settings, next steps, things to remember'},item.notes||'');
  const material=h('select',{name:'material'},options([['','Not decided'],...d.materials.map(m=>[m,m])],item.material));
  const spool=h('select',{name:'spool_id'},options([['','Choose later'],...d.spools.map(s=>[s.id,`${s.colour} ${s.material} · ${s.grams_left} g left`])],item.spool_id));
  const grams=h('input',{name:'grams',type:'number',min:1,max:5000,step:1,inputmode:'numeric',value:item.grams||'',placeholder:'e.g. 120'});
  const minutes=h('input',{name:'minutes',type:'number',min:1,max:10080,step:1,inputmode:'numeric',value:item.minutes||'',placeholder:'e.g. 180'});
  const link=h('input',{name:'link',type:'url',maxlength:1000,value:item.link||'',placeholder:'https://…'});
  const error=h('p',{role:'status',class:'feature-message'});
  form.append(field('Project name',name),field('Notes',notes),h('div',{class:'project-form-grid'},
    field('Material',material),field('Spool',spool),field('Estimated filament · grams',grams),field('Estimated time · minutes',minutes)),
    field('Model or reference link',link),error,h('button',{type:'submit',class:'primary'},item.id?'Save project':'Add project'));
  form.addEventListener('input',()=>{ui.drafts ||= {};ui.drafts[draftKey]=Object.fromEntries(new FormData(form));});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!(await ensure('household'))) return;
    const body=Object.fromEntries(new FormData(form));
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try {
      await post(item.id?`/api/projects/${item.id}`:'/api/projects',body);
      if(ui.drafts)delete ui.drafts[draftKey];
      if(!item.id){form.reset();ui.add.open=false;}
      ui.editing=null;
      await refreshProjects(state,true);
      toast(item.id?'Project saved.':'Project added to Ideas.');
    } catch(x){error.textContent=x.message;}
    finally {button.disabled=false;}
  });
  return form;
}

export function mountProjects(state) {
  const ui=state.projectUI={editing:null};
  ui.message=h('p',{class:'feature-message',role:'status'},'Loading your project board…');
  ui.board=h('div',{class:'project-board'});
  ui.add=h('details',{class:'project-add'},h('summary',{},'＋ Add a project'));
  ui.formHost=h('div',{});ui.add.append(ui.formHost);
  ui.root=card('Workshop projects',{cls:'wide feature project-feature'},
    h('div',{class:'feature-intro'},h('p',{class:'feature-kicker'},'FROM FIRST IDEA TO FINISHED PRINT'),
      h('p',{class:'feature-lead'},'Make room for the next thing you’ll make.'),
      h('p',{class:'meta'},'A planning board, not printer control. Moving a project never starts a print or deducts filament.')),
    ui.message,ui.add,ui.board);
  return ui.root;
}

async function change(state, work) {
  if(!(await ensure('household'))) return;
  try {await work();await refreshProjects(state,true);}
  catch(e){state.projectUI.message.textContent=e.message;toast(e.message,'bad');}
}

function projectCard(state,item) {
  const ui=state.projectUI;
  const files=h('div',{class:'project-files'},item.files.map(f=>h('div',{class:'project-file'},
    h('a',{href:`/api/project-files/${f.id}`,download:f.name,onclick:async e=>{e.preventDefault();if(await ensure('kid')) location.assign(`/api/project-files/${f.id}`);}},f.name),
    h('span',{class:'meta'},`${Math.max(1,Math.round(f.size/1024))} KB`),
    h('button',{type:'button',class:'ghost small','aria-label':`Remove file ${f.name}`,onclick:()=>{
      if(confirm(`Remove ${f.name}?`))change(state,()=>post(`/api/project-files/${f.id}/delete`));
    }},'Remove'))));
  const upload=h('input',{type:'file',accept:'.stl,.3mf,.step,.stp,.obj,.gcode,.bgcode,.pdf','aria-label':`Attach a file to ${item.title}`});
  const uploadStatus=h('p',{class:'meta',role:'status'});
  upload.addEventListener('change',async()=>{
    const file=upload.files[0];if(!file)return;
    if(!(await ensure('household'))){upload.value='';return;}
    if(file.size>25*1024*1024){uploadStatus.textContent='Choose a file up to 25 MB.';upload.value='';return;}
    upload.disabled=true;uploadStatus.textContent='Uploading model file…';
    try {await api(`/api/projects/${item.id}/files?filename=${encodeURIComponent(file.name)}`,{method:'POST',body:file});await refreshProjects(state,true);}
    catch(e){uploadStatus.textContent=e.message;upload.disabled=false;upload.value='';}
  });
  const stage=h('select',{'aria-label':`Stage for ${item.title}`,onchange:async e=>{const input=e.target;input.disabled=true;await change(state,()=>post(`/api/projects/${item.id}`,{stage:input.value}));input.value=item.stage;input.disabled=false;}},
    options(Object.entries(ui.data.stages),item.stage));
  const more=h('details',{class:'project-details',open:ui.openFiles?.has(item.id),ontoggle:e=>{
    ui.openFiles ||= new Set();e.currentTarget.open?ui.openFiles.add(item.id):ui.openFiles.delete(item.id);
  }},h('summary',{},`Files & notes${item.files.length?` · ${item.files.length} files`:''}`),
    item.notes?h('p',{class:'project-notes'},item.notes):h('p',{class:'meta'},'No notes yet.'),
    item.link?h('a',{class:'action',href:item.link,target:'_blank',rel:'noopener'},'Open model or reference'):null,
    files,h('label',{class:'field'},h('span',{},'Attach a model or PDF · up to 25 MB'),upload),uploadStatus);
  const edit=h('details',{class:'project-edit',open:ui.editing===item.id,ontoggle:e=>{
    if(e.currentTarget.open)ui.editing=item.id;else if(ui.editing===item.id)ui.editing=null;
  }},h('summary',{},'Edit project'),editor(state,item));
  return h('article',{class:'project-card',dataset:{warning:String(!!item.warnings.length)}},
    h('h4',{},item.title),
    h('p',{class:'project-spec'},[item.material,item.grams?`${item.grams} g`:null,item.minutes?`${Math.floor(item.minutes/60)} h ${item.minutes%60} min`:null].filter(Boolean).join(' · ')||'An idea waiting for its details'),
    item.spool_name?h('p',{class:'meta'},item.spool_name,item.estimated_cost!=null?` · about $${item.estimated_cost.toFixed(2)} in filament`:''):null,
    ...item.warnings.map(w=>h('p',{class:'project-warning'},w)),field('Stage',stage),more,edit,
    h('button',{type:'button',class:'ghost small project-delete',onclick:()=>{
      if(confirm(`Remove ${item.title} and its attached files?`))change(state,()=>post(`/api/projects/${item.id}/delete`));
    }},'Remove project'));
}

export async function refreshProjects(state,force=false) {
  const ui=state.projectUI;
  if(!ui || !state.root.isConnected || ui.loading) return;
  // Refreshes must never replace an unfinished form or interrupt file selection.
  if(!force && (ui.add.open || ui.editing || ui.root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)))return;
  ui.loading=true;
  try {
    const d=await api('/api/projects');if(!state.root.isConnected)return;
    ui.data=d;
    if(ui.editing && !d.projects.some(p=>p.id===ui.editing))ui.editing=null;
    const active=d.projects.filter(p=>p.stage!=='finished');
    ui.message.textContent=`${active.length} active ${active.length===1?'project':'projects'} · ${d.projects.filter(p=>p.stage==='finished').length} finished · ${(d.storage_used/1024/1024).toFixed(1)} of 250 MB in files`;
    if(!ui.formHost.childElementCount || force)ui.formHost.replaceChildren(editor(state));
    ui.board.replaceChildren(...Object.entries(d.stages).map(([key,label])=>{
      const projects=d.projects.filter(p=>p.stage===key);
      return h('section',{class:'project-lane','aria-label':label},h('div',{class:'project-lane-heading'},h('h3',{},label),h('span',{},String(projects.length))),
        ...projects.map(item=>projectCard(state,item)),projects.length?null:h('p',{class:'project-lane-empty'},
          {idea:'Save a spark of an idea.',ready:'Line up the next print.',printing:'Track what’s on the plate.',finished:'A little gallery of things made.'}[key]));
    }));
  } catch(e){ui.message.textContent=`Couldn’t refresh the project board. ${e.message}`;}
  finally{ui.loading=false;}
}
