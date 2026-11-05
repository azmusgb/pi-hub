import { api, askFirst, ensure, h, post, toast } from './core.js';
import { section } from './page-parts.js';
import { plexUrl } from './sections.js';

export const watchUrl = (machine, key) => plexUrl(machine, key);
const art = item => item.thumb
  ? h('img', {src: `/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`, alt:'', loading:'lazy'})
  : h('div', {class:'night-art-placeholder', 'aria-hidden':'true'}, '▶');
const meta = item => [item.year, item.minutes ? `${item.minutes} min` : 'Runtime unknown', item.content_rating].filter(Boolean).join(' · ');

export function mountMovieNight(state) {
  const ui = state.nightUI = {busy:false};
  ui.message = h('p', {class:'feature-message', role:'status'}, 'Loading the household shortlist…');
  ui.shortlist = h('div', {class:'night-shortlist'});
  ui.suggestions = h('div', {class:'night-suggestions'});
  ui.budget = h('select', {id:'night-budget', onchange:()=>refreshMovieNight(state)},
    [0,60,90,120,150,180].map(n=>h('option',{value:n}, n ? `${n} minutes` : 'Any length')));
  ui.kids = h('input', {type:'checkbox', id:'night-family', onchange:()=>refreshMovieNight(state)});
  // A section on the page, not a card with a hero (A7 P1): the heading and one line of purpose.
  ui.root = section('Movie night', [
    ui.message, ui.shortlist,
    h('div', {class:'feature-section-heading'}, h('div',{},h('h3',{},'Find a contender'),h('p',{class:'meta'},'Unwatched films from your library, with a reason they fit.')),
      h('div',{class:'night-filters'},h('label',{class:'field',for:'night-budget'},h('span',{},'Time available'),ui.budget),
        h('label',{class:'check',for:'night-family'},ui.kids,'Family-friendly ratings'))), ui.suggestions],
    {note:'Shortlist a film, vote for anything you’d enjoy, then choose tonight’s pick.'});
  ui.root.classList.add('movie-night');
  return ui.root;
}

async function change(state, role, work) {
  const ui=state.nightUI;
  if (ui.busy || !(await ensure(role))) return;
  ui.pendingFocus = document.activeElement?.dataset.focus;
  ui.busy=true;
  ui.root.querySelectorAll('button').forEach(b=>{b.disabled=true;});
  try { await work(); await refreshMovieNight(state, true); }
  catch(e) { ui.message.textContent=e.message; toast(e.message,'bad'); }
  finally {ui.busy=false; ui.root.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
}

export async function refreshMovieNight(state, force=false) {
  const ui=state.nightUI;
  if (!ui || !state.root.isConnected || ui.loading && !force) return;
  const serial = ui.serial = (ui.serial || 0)+1;
  ui.loading=true;
  try {
    const query=new URLSearchParams({minutes:ui.budget.value,kids:ui.kids.checked});
    const d=await api(`/api/movie-night?${query}`);
    if (!state.root.isConnected || serial!==ui.serial) return;
    const focus = ui.pendingFocus || (ui.root.contains(document.activeElement) ? document.activeElement.dataset.focus : null);
    const total=d.shortlist.reduce((sum,m)=>sum+m.votes,0);
    const chosen=d.shortlist.find(m=>m.key===d.chosen);
    ui.message.textContent=chosen ? `Tonight’s pick: ${chosen.title}. Open it in Plex when you’re ready.`
      : d.shortlist.length ? `${d.shortlist.length} films on the shortlist · ${total} ${total===1?'vote':'votes'}. Vote for more than one if you like.`
      : 'The shortlist is open. Add a contender below and invite the household to vote.';
    const top=Math.max(0,...d.shortlist.map(m=>m.votes));
    ui.shortlist.replaceChildren(...(d.shortlist.length ? d.shortlist.map(item=>h('article',{class:'night-candidate',dataset:{chosen:String(item.key===d.chosen)}},
      h('div',{class:'night-art'},art(item)),
      h('div',{class:'night-copy'},
        item.key===d.chosen ? h('span',{class:'feature-tag'},'TONIGHT’S PICK') : item.votes && item.votes===top ? h('span',{class:'feature-tag'},'HOUSEHOLD FAVOURITE') : null,
        h('h3',{},item.title),h('p',{class:'meta'},meta(item)),
        h('div',{class:'vote-meter','aria-hidden':'true'},h('span',{style:`width:${top?item.votes/top*100:0}%`})),
        h('div',{class:'feature-actions'},
          h('button',{type:'button',class:item.voted?'primary':'ghost','aria-pressed':String(item.voted),
            'data-focus':`vote:${item.key}`, 'aria-label':`${item.voted?'Remove your vote for':'Vote for'} ${item.title}`,onclick:()=>change(state,'kid',()=>post(`/api/movie-night/${item.key}/vote`,{vote:!item.voted}))},`${item.voted?'✓ Voted':'Vote'} · ${item.votes}`),
          item.key===d.chosen ? h('a',{class:'action',href:watchUrl(state.machine,item.key),target:'_blank',rel:'noopener'},'Watch in Plex')
            : h('button',{type:'button',class:'ghost',onclick:()=>change(state,'household',()=>post(`/api/movie-night/${item.key}/choose`))},'Choose for tonight'),
          h('button',{type:'button',class:'ghost small','aria-label':`Remove ${item.title} from shortlist`,onclick:async(e)=>{
            if(await askFirst(e.currentTarget, `${item.title} and its votes leave tonight’s shortlist.`, {confirm:'Remove'})) change(state,'household',()=>post(`/api/movie-night/${item.key}/remove`));
          }},'Remove'))))) : [h('div',{class:'feature-empty'},h('h3',{},'Give tonight a shortlist'),h('p',{},'Add up to 12 films. Votes stay here even when Plex is temporarily unavailable.'))]));
    ui.suggestions.replaceChildren(...(d.suggestions.length ? d.suggestions.map(item=>h('article',{class:'night-suggestion'},
      h('div',{class:'night-art'},art(item)),h('div',{class:'night-copy'},h('h4',{},item.title),h('p',{class:'meta'},meta(item)),
        h('p',{class:'match-reason'},item.reasons.join(' · ')),
        h('button',{type:'button',class:'ghost','data-focus':`add:${item.key}`,onclick:()=>change(state,'kid',()=>post('/api/movie-night',{key:item.key}))},'Add to shortlist'))))
      : [h('p',{class:'feature-empty'},d.library_available ? 'No unwatched films match. Try another filter, or search the library above to add any movie to the shortlist.' : 'Plex isn’t returning the library right now. Your shortlist and votes are still available.')]));
    if (focus) {
      const key = focus.startsWith('add:') ? focus.replace('add:', 'vote:') : focus;
      [...ui.root.querySelectorAll('[data-focus]')].find(node=>node.dataset.focus===key)?.focus({preventScroll:true});
      ui.pendingFocus=null;
    }
  } catch(e) { if(serial===ui.serial && state.root.isConnected) ui.message.textContent=`Couldn’t refresh movie night. ${e.message}`; }
  finally {if(serial===ui.serial) ui.loading=false;}
}
