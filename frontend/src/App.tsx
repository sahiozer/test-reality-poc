import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, ChevronRight, Clock3, Database, Layers3, Play, RefreshCw, Search, ShieldAlert, Sparkles, X } from 'lucide-react';
import { FingerprintPipeline } from './FingerprintPipeline';
import type { DomainInfo, Coverage, Finding, FindingDetail, Fingerprint, Overview, Snapshot, State } from './types';

const number = (v:number) => new Intl.NumberFormat('en-US').format(v);
const percent = (v:number) => `${(v*100).toFixed(2)}%`;
const date = (v:string) => new Date(v).toLocaleString();
async function api<T>(path:string, init?:RequestInit, domain="CUSTOMER_LENDING"):Promise<T> {
  const response = await fetch(`/api${path}${domain==='CUSTOMER_LENDING'?'':'?domain='+encodeURIComponent(domain)}`, init);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.message || `Request failed (${response.status})`), {status:response.status});
  }
  return response.json();
}
const findingLabel = (type:string) => ({REPRESENTATION_GAP:'Reality gap', MISSING_STATE:'Missing state', DATA_HEALTH_ISSUE:'Data health issue', FRESHNESS_GAP:'Freshness gap'}[type] || type.replaceAll('_',' ').toLowerCase());
const stateLabel = (s:State) => s.label || `${s.features.customer_type} · ${s.features.account_count_bucket} active accounts · ${s.features.has_fx_account?'FX':'no FX'} · ${s.features.has_active_loan?'active loan':'no active loan'} · ${s.features.has_active_card?'active card':'no active card'} · ${s.features.has_blocked_account?'blocked':'unblocked'}`;
function value(f:Finding, side:'prod'|'test') {
  const v = side==='prod'?f.prod_value:f.test_value;
  if (typeof v==='number') return f.evidence.unit==='fraction'?percent(v):number(v);
  return new Date(v).toLocaleDateString();
}

type WorkspaceDomain = "CUSTOMER_LENDING" | "CARDS";
const domainStorageKey = "test-reality-domain";
function validDomain(value: string | null): WorkspaceDomain {
  return value === "CARDS" ? "CARDS" : "CUSTOMER_LENDING";
}
function restoredDomain(): WorkspaceDomain {
  try { return validDomain(localStorage.getItem(domainStorageKey)); }
  catch { return "CUSTOMER_LENDING"; }
}

export function App() {
  const [domain,setDomain]=useState<WorkspaceDomain>(restoredDomain);
  function changeDomain(value: string) {
    const next = validDomain(value);
    try { localStorage.setItem(domainStorageKey,next); } catch { /* Keep switching usable when storage is unavailable. */ }
    setDomain(next);
  }
  const [domains,setDomains]=useState<DomainInfo[]>([]);
  const workspace=domains.find(d=>d.id===domain);
  async function domainApi<T>(path:string,init?:RequestInit) {return api<T>(path,init,domain);}
  const [overview,setOverview]=useState<Overview|null>(null);
  const [findings,setFindings]=useState<Finding[]>([]);
  const [coverage,setCoverage]=useState<Coverage|null>(null);
  const [fingerprints,setFingerprints]=useState<Fingerprint[]>([]);
  const [loading,setLoading]=useState(true);
  const [running,setRunning]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [tab,setTab]=useState('Overview');
  const [filter,setFilter]=useState('ALL');
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<FindingDetail|null>(null);
  const [stateFilter,setStateFilter]=useState('ALL');
  const detailClose = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement|null>(null);

  useEffect(()=>{
    setSelected(null);setOverview(null);setFindings([]);setCoverage(null);setFingerprints([]);setFilter("ALL");setQuery("");setNotice("");
    const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();
  },[domain]);
  useEffect(()=>{
    if (!selected || selected.aiExplanationStatus!=='PENDING') return;
    let cancelled=false;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const detail=await domainApi<FindingDetail>(`/findings/${encodeURIComponent(selected.finding_id)}`,{signal:controller.signal});
        if (cancelled) return;
        if (detail.aiExplanationStatus!=='PENDING') {setSelected(detail);return;}
        setSelected(detail);
        timer=setTimeout(()=>void poll(),4000);
      } catch {
        if (!cancelled) setSelected(current=>current?{...current,aiExplanation:current.deterministicSummary,aiExplanationStatus:'FALLBACK'}:null);
      }
    };
    timer=setTimeout(()=>void poll(),0);
    return ()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[selected?.finding_id,selected?.aiExplanationStatus]);
  useEffect(()=>{
    if (!selected) return;
    detailClose.current?.focus();
    const listener = (event:KeyboardEvent) => {
      if (event.key==='Escape') closeDetail();
      if (event.key==='Tab') {
        const dialog=detailClose.current?.closest('[role="dialog"]');
        const controls=Array.from(dialog?.querySelectorAll<HTMLElement>('button, summary') || []).filter(control=>control.getClientRects().length);
        const first=controls[0],last=controls[controls.length-1];
        if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
        else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown', listener);
    return ()=>document.removeEventListener('keydown',listener);
  },[selected?.finding_id]);

  async function load(signal:AbortSignal) {
    setLoading(true); setError('');
    try {
      const descriptors=await api<DomainInfo[]>('/domains',{signal});if(signal.aborted)return;setDomains(descriptors);
      const o=await domainApi<Overview>('/overview',{signal});
      const [f,c,p]=await Promise.all([domainApi<Finding[]>('/findings',{signal}),domainApi<Coverage>('/states/coverage',{signal}),domainApi<Fingerprint[]>('/fingerprints',{signal})]);
      if(signal.aborted)return;
      setOverview(o);setFindings(f);setCoverage(c);setFingerprints(p);
    } catch(e) {
      if(signal.aborted)return;
      const err=e as Error & {status?:number};
      if (err.status===409) setNotice('Your environments are ready. Run the first analysis to calculate their differences.');
      else setError(err.message);
    } finally {if(!signal.aborted)setLoading(false);}
  }
  async function run() {
    setRunning(true);setError('');setNotice('');
    try {
      const r=await domainApi<Snapshot>('/analysis/run',{method:'POST'});
      setOverview({...r.overview,dataset:r.dataset,run_id:r.run_id,generated_at:r.generated_at,latest_attempt:{status:'SUCCEEDED',error_message:null}});
      setFindings(r.findings);setCoverage(r.coverage);setFingerprints(r.fingerprints);
      setNotice('Analysis complete. All results below were calculated from the current database.');
    } catch(e) {setError((e as Error).message + (overview?' Previous successful results remain visible.':''));}
    finally {setRunning(false);}
  }
  async function openDetail(f:Finding) {
    trigger.current=document.activeElement as HTMLElement;
    // Evidence is already in the persisted snapshot: display it before any LLM request.
    setSelected({...f,deterministicSummary:f.explanation,aiExplanation:'',aiExplanationStatus:'PENDING'});
  }
  function closeDetail() {setSelected(null);trigger.current?.focus();}
  const visible=findings.filter(f=>(filter==='ALL'||f.finding_type===filter)&&`${f.title} ${f.finding_type}`.toLowerCase().includes(query.toLowerCase()));
  const prodEnv=overview?.environments[0] || workspace?.environments[0] || "";
  const testEnv=overview?.environments[1] || workspace?.environments[1] || "";
  const prod=overview?.business_metrics[prodEnv];
  const test=overview?.business_metrics[testEnv];
  const entityLabel=workspace?.entityLabel || "";
  const countKey=workspace?.entityCountKey || "";
  const distributionTotalKey=workspace?.distributionTotalKey || "";
  const shownStates=coverage?.states.filter(s=>stateFilter==='ALL'||s.assessment===stateFilter) || [];

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();setTab('Overview');}}><span className="brand-icon"><Layers3 size={22}/></span><span>test reality<span className="brand-dot">.</span></span></a>
      <div className="workspace"><div className="workspace-avatar">TR</div><div><strong>Banking workspace</strong><select aria-label="Banking workspace domain" value={domain} disabled={running} onChange={e=>changeDomain(e.target.value)}>{domains.map(d=><option key={d.id} value={d.id}>{d.displayName}</option>)}</select></div><span className="poc">POC</span></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{[['Overview',Activity],['Findings',ShieldAlert],['State coverage',Layers3],['Fingerprints',Database],['Fingerprint Pipeline',Layers3]].map(([name,Icon])=>{
        const Component=Icon as typeof Activity;
        return <button key={name as string} className={tab===name?'nav-item active':'nav-item'} onClick={()=>setTab(name as string)}><Component size={18}/>{name as string}{name==='Findings'&&overview&&<span className="nav-count">{findings.length}</span>}</button>;
      })}</nav>
      <div className="sidebar-note"><span className="tiny-dot"/> Database-derived evidence<p>Understand what your test environment is missing.</p></div>
      <div className="sidebar-footer"><div className="avatar">TR</div><div><strong>Test Reality POC</strong><span>Version 0.1 · isolated deployment</span></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div>Workspace <ChevronRight size={14}/><strong>{tab}</strong></div><span className="topbar-tag"><span className="tiny-dot"/> Narrow working POC</span></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">ENVIRONMENT INTELLIGENCE</div><h1>{tab==='Fingerprint Pipeline'?'Fingerprint Pipeline':tab==='Overview'?'See the gaps. Test with confidence.':tab==='Findings'?'Every finding, backed by evidence.':tab==='State coverage'?'Coverage beyond row counts.':'The shape of your data.'}</h1><p>{tab==='Fingerprint Pipeline'?"PROD ve TEST verisi nasıl ölçülür, fingerprint’e dönüşür ve finding üretir?":"Compare your production reference with TEST, down to the business states that matter."}</p></div>{tab!=='Fingerprint Pipeline'&&<button className="primary" onClick={()=>void run()} disabled={running||loading}>{running?<RefreshCw className="spin" size={16}/>:<Play size={16}/>} {running?'Analyzing environments…':'Run analysis'}</button>}</div>
        {error&&<div className="alert error" role="alert"><ShieldAlert size={18}/>{error}</div>}
        {notice&&<div className="alert notice" role="status"><Check size={17}/>{notice}</div>}
        {overview?.latest_attempt?.status==='FAILED'&&<div className="alert error" role="alert">Latest run failed. Showing the last successful snapshot: {overview.latest_attempt.error_message}</div>}
        <div className="environment-strip"><div className="environment-name"><Database size={19}/><div><span className="micro">REFERENCE ENVIRONMENT</span><strong>{prodEnv} <span className="env-badge prod">PROD</span></strong></div></div><ArrowRight size={19} className="muted"/><div className="environment-name"><Database size={19}/><div><span className="micro">COMPARED ENVIRONMENT</span><strong>{testEnv} <span className="env-badge test">TEST</span></strong></div></div><div className="environment-meta">{prod&&test?<><strong>{number(prod[countKey])} / {number(test[countKey])}</strong><span>{entityLabel} · PROD / TEST</span></>:<span>PostgreSQL · separate schemas</span>}</div><span className="snapshot-status"><span className="tiny-dot"/>{overview?'Analysis saved':'Awaiting analysis'}</span></div>
        {loading&&<div className="empty"><RefreshCw className="spin"/> Loading saved analysis…</div>}
        {!loading&&!overview&&<div className="empty"><Database size={32}/><h2>Start with the data.</h2><p>Run analysis to calculate fingerprints, significant business states, and evidence-based findings.</p></div>}
        {tab==='Fingerprint Pipeline'&&workspace&&<FingerprintPipeline workspace={workspace} overview={overview} coverage={coverage} fingerprints={fingerprints} findings={findings}/>}
        {overview&&<>
          {(tab==='Overview'||tab==='Findings')&&<div className="metrics-grid">
            {[{label:'Reality gaps',v:overview.reality_gaps,icon:Activity,color:'purple',hint:'Shared patterns, underrepresented in TEST',description:'Patterns present in both environments but materially underrepresented in TEST.'}, {label:'Data health issues',v:overview.data_health_issues,icon:ShieldAlert,color:'red',hint:'Inconsistent business relationships'}, {label:'Missing data states',v:overview.missing_data_states,icon:Layers3,color:'orange',hint:'Significant PROD states with no TEST representation.'}, {label:'TEST data age',v:`${Math.floor(overview.test_data_age_days)} days`,icon:Clock3,color:'blue',hint:`${number(overview.freshness.age_difference_days)} days behind PROD`}].map(m=><div className="metric-card" key={m.label}><div className="metric-label">{m.label}<span className={`metric-icon ${m.color}`}><m.icon size={18}/></span></div><div className="metric-value">{m.v}</div><div className="metric-hint" title={m.description || m.hint}>{m.hint}</div></div>)}
          </div>}
          {(tab==='Overview'||tab==='Findings')&&<div className={tab==='Overview'?'content-grid':''}>
            <section className="panel findings-panel"><div className="panel-heading"><div><h2>Findings requiring attention <span className="count-pill">{findings.length}</span></h2><p>Calculated evidence, prioritized for review.</p></div><span className="evidence-label"><Sparkles size={13}/> Deterministic evidence</span></div>
              <div className="table-tools"><div className="filter-tabs">{[['ALL','All findings'],['REPRESENTATION_GAP','Reality gaps'],['MISSING_STATE','Missing states'],['DATA_HEALTH_ISSUE','Health']].map(([v,l])=><button key={v} className={filter===v?'selected':''} onClick={()=>setFilter(v)}>{l}</button>)}</div><label className="search"><Search size={15}/><input aria-label="Search findings" placeholder="Find a pattern" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
              <div className="table-scroll"><table className="findings-table"><thead><tr><th>Data pattern</th><th>PROD reference</th><th>TEST</th><th>Assessment</th><th><span className="sr-only">Detail</span></th></tr></thead><tbody>{visible.map(f=><tr key={f.finding_id}><td><button className="pattern-button" onClick={()=>void openDetail(f)}><span className={`pattern-symbol ${f.finding_type==='DATA_HEALTH_ISSUE'?'red':f.finding_type==='MISSING_STATE'?'orange':'purple'}`}><Activity size={14}/></span><span><strong>{f.title}</strong><small>{findingLabel(f.finding_type)}</small></span></button></td><td>{value(f,'prod')}</td><td className={f.finding_type==='MISSING_STATE'?'zero-value':''}>{value(f,'test')}</td><td><span className={`assessment ${f.finding_type==='MISSING_STATE'?'missing':f.finding_type==='DATA_HEALTH_ISSUE'?'health':'gap'}`}>{f.finding_type==='MISSING_STATE'?'Missing':f.finding_type==='DATA_HEALTH_ISSUE'?'Inconsistent':f.finding_type==='FRESHNESS_GAP'?'Stale':'Underrepresented'}</span></td><td><button className="icon-button" aria-label={`Open ${f.title}`} onClick={()=>void openDetail(f)}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table>{visible.length===0&&<div className="empty small">No findings match this filter.</div>}</div><div className="panel-foot">{visible.length} findings · click a pattern to inspect its evidence</div>
            </section>
            {tab==='Overview'&&coverage&&<section className="panel coverage-summary"><div className="panel-heading"><div><h2>Data-state coverage</h2><p>Business combinations, not just rows.</p></div><Layers3 size={19} className="muted"/></div><div className="coverage-ring" style={{'--coverage':`${coverage.total_significant_prod_states?coverage.represented_in_test/coverage.total_significant_prod_states*100:0}%`} as React.CSSProperties}><div><strong>{coverage.total_significant_prod_states?Math.round(coverage.represented_in_test/coverage.total_significant_prod_states*100):0}<span>%</span></strong><small>represented in TEST</small></div></div><div className="coverage-total"><strong>{coverage.represented_in_test}<span> / {coverage.total_significant_prod_states}</span></strong><p>significant PROD states represented</p></div><div className="coverage-stat"><span><i className="legend-dot green"/>Represented</span><strong>{coverage.represented_in_test}</strong></div><div className="coverage-stat"><span><i className="legend-dot orange"/>Missing</span><strong>{coverage.missing_in_test}</strong></div><div className="coverage-stat"><span><i className="legend-dot purple"/>Underrepresented</span><strong>{coverage.underrepresented_in_test}</strong></div><p className="coverage-note">Underrepresented states are included in represented. Minimum {coverage.thresholds.minimum_support} {entityLabel} and {percent(coverage.thresholds.minimum_prevalence)} PROD prevalence.</p><button className="text-link" onClick={()=>setTab('State coverage')}>Explore state coverage <ArrowRight size={15}/></button></section>}
          </div>}
          {tab==='Overview'&&prod&&test&&<section className="panel comparison-panel"><div className="panel-heading"><div><h2>{workspace?.distributionTitle}</h2><p>{workspace?.distributionDescription}</p></div><button className="text-link" onClick={()=>setTab('Fingerprints')}>View fingerprints <ArrowRight size={15}/></button></div><div className="distribution">{(workspace?.distribution || []).map(({label,key})=>[label,prod[key],test[key]]).map(([label,p,t])=><div className="distribution-group" key={label as string}><strong>{label}</strong><div className="bar-row"><span>PROD</span><div className="bar-track"><div className="bar prod-bar" style={{width:`${Number(p)/prod[distributionTotalKey]*100}%`}}/></div><b>{percent(Number(p)/prod[distributionTotalKey])}</b></div><div className="bar-row"><span>TEST</span><div className="bar-track"><div className="bar test-bar" style={{width:`${Number(t)/test[distributionTotalKey]*100}%`}}/></div><b>{percent(Number(t)/test[distributionTotalKey])}</b></div></div>)}</div></section>}
          {tab==='State coverage'&&coverage&&<section className="panel"><div className="panel-heading"><div><h2>{coverage.represented_in_test} / {coverage.total_significant_prod_states} states represented</h2><p>{coverage.missing_in_test} missing · {coverage.underrepresented_in_test} underrepresented · exact {workspace?.stateFeatureCount}-feature combinations</p><p>Underrepresented states are included in represented.</p></div><select aria-label="Filter states" value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option value="ALL">All significant states</option><option value="MISSING">Missing</option><option value="UNDERREPRESENTED">Underrepresented</option><option value="REPRESENTED">Adequately represented</option></select></div><div className="table-scroll"><table><thead><tr><th>Business state</th><th>PROD {entityLabel}</th><th>PROD prevalence</th><th>TEST {entityLabel}</th><th>TEST prevalence</th><th>Assessment</th></tr></thead><tbody>{shownStates.map(s=>{const f=findings.find(f=>f.evidence.state_id===s.state_id);return <tr key={s.state_id}><td>{f?<button className="state-link" onClick={()=>void openDetail(f)}>{stateLabel(s)}</button>:stateLabel(s)}</td><td>{number(s.prod_count)}</td><td>{percent(s.prod_prevalence)}</td><td>{number(s.test_count)}</td><td>{percent(s.test_prevalence)}</td><td><span className={`assessment ${s.assessment==='MISSING'?'missing':s.assessment==='UNDERREPRESENTED'?'gap':'good'}`}>{s.assessment.toLowerCase()}</span></td></tr>;})}</tbody></table></div><div className="panel-foot">Support ≥ {coverage.thresholds.minimum_support} · prevalence ≥ {percent(coverage.thresholds.minimum_prevalence)} · underrepresentation: TEST &lt; {percent(coverage.thresholds.underrepresentation_prevalence_ratio)} of PROD prevalence</div></section>}
          {tab==='Fingerprints'&&<section className="panel fingerprints-panel"><div className="panel-heading"><div><h2>Environment fingerprints</h2><p>Row counts, null rates, distinct values, dates, business metrics, and relationship health.</p></div></div><div className="fingerprint-summary" aria-label="Fingerprint summary"><div><strong>{number(fingerprints.length)}</strong><span>Fingerprint metrics</span></div><div><strong>PROD reference</strong><span>{prodEnv}</span></div><div><strong>TEST</strong><span>{testEnv}</span></div><div><strong>Latest analysis</strong><span>{date(overview.generated_at)}</span></div></div><div className="table-scroll"><table className="fingerprints-table"><thead><tr><th>Scope / metric</th><th>PROD reference</th><th>TEST</th><th>Calculation</th></tr></thead><tbody>{fingerprints.filter(p=>p.environment===prodEnv).map(p=>{const t=fingerprints.find(t=>t.environment===testEnv&&t.scope===p.scope&&t.metric_name===p.metric_name);const fmt=(v:number|string|null|undefined)=>v==null?'—':typeof v==='number'?(p.metric_name==='null_rate'||p.metric_name.endsWith('_rate')?percent(v):number(v)):date(v);return <tr key={`${p.scope}:${p.metric_name}`}><td><strong>{p.scope}</strong><small className="block">{p.metric_name.replaceAll('_',' ')}</small></td><td>{fmt(p.value)}</td><td>{fmt(t?.value)}</td><td className="method-cell">{p.calculation_method}</td></tr>;})}</tbody></table></div></section>}
          <footer className="page-footer"><span><Check size={13}/> Calculated from PostgreSQL · synthetic data · no LLM</span><span>Last analysis: {date(overview.generated_at)}</span></footer>
        </>}
      </main>
    </div>
    {selected&&<div className="modal-backdrop" onClick={closeDetail}>
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={e=>e.stopPropagation()}>
        <div className="detail-top"><span className="eyebrow">FINDING EVIDENCE</span><button ref={detailClose} className="icon-button" aria-label="Close finding" onClick={closeDetail}><X size={20}/></button></div>
        <span className={`assessment ${selected.finding_type==='DATA_HEALTH_ISSUE'?'health':selected.finding_type==='MISSING_STATE'?'missing':'gap'}`}>{findingLabel(selected.finding_type)}</span>
        <h2 id="detail-title">{selected.title}</h2>
        <div className="detail-values"><div><span>PROD reference</span><strong>{value(selected,'prod')}</strong></div><div><span>TEST</span><strong>{value(selected,'test')}</strong></div></div>
        <section className="evidence-summary" aria-labelledby="evidence-summary-title"><h3 id="evidence-summary-title">Evidence summary</h3><p>{selected.finding_type==='DATA_HEALTH_ISSUE' && selected.evidence.metric==='closed_customers_with_active_accounts'?`PROD: ${value(selected,'prod')} customers. TEST: ${value(selected,'test')} customers with CLOSED customer status and at least one ACTIVE account.`:selected.explanation}</p></section>
        <div className="explanation-flow" aria-label="Engine evidence, locally retrieved context, AI explanation"><span>Evidence</span><ArrowRight size={12}/><span>Context</span><ArrowRight size={12}/><span>Explanation</span></div>
        <section className="ai-explanation" aria-labelledby="ai-explanation-title">
          <div className="detail-section-heading"><h3 id="ai-explanation-title">AI Explanation</h3><small className="ai-status" data-status={selected.aiExplanationStatus}>{selected.aiExplanationStatus==='PENDING'?'Local on-prem AI • Generating…':selected.aiExplanationStatus==='GENERATED'?'Local on-prem AI • Generated':'Template fallback'}</small></div>
          {selected.aiExplanationStatus==='PENDING'?<p role="status">Local on-prem AI explanation is being generated…</p>:<p lang="tr">{selected.aiExplanation||selected.deterministicSummary}</p>}
        </section>
        <section className="context-used" aria-labelledby="context-used-title">
          <div className="detail-section-heading"><h3 id="context-used-title">Context used</h3><small>Retrieved locally</small></div>
          {selected.retrievedContext?.length?<ul>{selected.retrievedContext.map(chunk=><li key={chunk.id}><div className="context-source"><strong>{chunk.id}</strong><span className={`source-badge ${chunk.sourceType==='BUSINESS_RULE'?'rule':''}`}>{chunk.sourceType.replaceAll('_',' ')}</span></div>{chunk.title!==chunk.id&&<small className="context-title">{chunk.title.startsWith(`${chunk.id} — `)?chunk.title.slice(chunk.id.length+3):chunk.title}</small>}<p lang="tr">{chunk.content}</p></li>)}</ul>:<p>{selected.aiExplanationStatus==='PENDING'?'Retrieving local domain context…':'No relevant domain context available; explanation uses structured evidence.'}</p>}
        </section>
        <details className="technical-evidence"><summary><span><strong>Technical evidence</strong><small>Calculation method, raw evidence and metric metadata</small></span><ChevronRight size={16}/></summary><div className="technical-evidence-body"><h3>Calculation method</h3><p>{String(selected.evidence.calculation_method || 'See raw evidence below.')}</p><h3>Raw evidence</h3><pre>{JSON.stringify(selected.evidence,null,2)}</pre><h3>Explanation-ready evidence</h3><pre>{JSON.stringify(selected.explanation_ready,null,2)}</pre><div className="detail-meta"><strong>{selected.severity} assessment</strong><span>Calculated {date(selected.generated_at)}</span><code>{selected.finding_id}</code></div></div></details>
      </section>
    </div>}
  </div>;
}
