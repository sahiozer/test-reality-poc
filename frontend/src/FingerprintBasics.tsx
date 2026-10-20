import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Database, FileCheck2, Fingerprint as FingerprintIcon, GitCompareArrows, Layers3, ListTree, Pause, Play, ScanLine, ShieldCheck, Sparkles, Square } from 'lucide-react';
import type { Coverage, DomainInfo, Finding, Fingerprint, Overview } from './types';
import { basicsHelp, basicsSteps } from './basicsContent';
import { BasicsStepExplanation, ConceptDefinition } from './BasicsStepExplanation';
import './basics.css';

const fmt=(v:number)=>new Intl.NumberFormat('en-US').format(v);
const pct=(v:number)=>`${(v*100).toFixed(2)}%`;
const icons=[Database,ListTree,ScanLine,ShieldCheck,FingerprintIcon,GitCompareArrows,FileCheck2,Sparkles];
type Props={workspace:DomainInfo;overview:Overview|null;coverage:Coverage|null;findings:Finding[];fingerprints:Fingerprint[]};
type Loaded=Omit<Props,'overview'|'coverage'> & {overview:Overview;coverage:Coverage};

function HelpTerm({name}:{name:string}){
  const [pinned,setPinned]=useState(false),[hover,setHover]=useState(false);
  const host=useRef<HTMLDivElement>(null),id=useId(),open=pinned||hover,help=basicsHelp[name];
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!host.current?.contains(e.target as Node)){setPinned(false);setHover(false);}};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  return <div ref={host} className="basics-help-host" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setPinned(false);setHover(false);}}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setPinned(false);setHover(false);}}}>
    <button className="basics-help-button" aria-label={`${name} hakkında`} aria-expanded={open} aria-controls={id} aria-describedby={open?id:undefined} onClick={()=>setPinned(v=>!v)}>{name}<CircleHelp size={12}/></button>
    {open&&<div className="basics-popover" role="tooltip" id={id}><strong>{name}</strong><dl><div><dt>WHAT IS IT?</dt><dd>{help.what}</dd></div><div><dt>WHERE DO WE USE IT?</dt><dd>{help.where}</dd></div><div><dt>WHY IS IT HERE?</dt><dd>{help.why}</dd></div></dl></div>}
  </div>;
}

function BasicsVisual({stage,data}:{stage:number;data:Loaded}){
  const {workspace,overview,coverage,findings,fingerprints}=data,cards=workspace.id==='CARDS';
  const [prod,test]=overview.environments,rateKey=cards?'multi_active_card_rate':'multi_account_rate';
  const health=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
  const healthCount=typeof health?.test_value==='number'?fmt(health.test_value):'—';
  const rule=cards?'BR-CARD-001':'BR-CUSTOMER-001';
  switch(stage){
    case 0:return <><div className="basics-sources"><div><Database size={26}/><small>PROD REFERANSI</small><strong>{prod}</strong><p>Onaylı snapshot<br/>Restore edilmiş backup<br/>Read-only replica</p></div><ArrowRight className="basics-source-arrow" size={23}/><div><Database size={26}/><small>TEST ORTAMI</small><strong>{test}</strong><p>Mevcut TEST veritabanı</p></div></div><p className="basics-key-line">Canlı PROD’a doğrudan bağlanmak zorunlu değildir.</p></>;
    case 1:return <><div className="basics-schema" aria-label="İlişki haritası">{(cards?['CARD','CARD_ACCOUNT','CARD_LIMIT','CARD_STATUS_HISTORY']:['CUSTOMER','ACCOUNT','LOAN','CARD']).map((name,i)=><div key={name}><span>{i===0?<Database size={18}/>:<ArrowRight size={16}/>}</span><strong>{name}</strong></div>)}</div><p className="basics-key-line">Önce iskeletini tanırız; sonra ölçeriz.</p><p className="basics-caption">Keşif yaklaşımı: metadata / katalog. Bu POC’de tablolar ve ilişkiler önceden tanımlıdır.</p></>;
    case 2:return <div className="basics-scale"><span className="basics-visual-tag">ÖLÇEK ÖRNEĞİ</span><div className="basics-raw-blocks" aria-hidden="true">{Array.from({length:30},(_,i)=><i key={i} style={{'--block-delay':`${i*12}ms`} as React.CSSProperties}/>)}</div><strong className="basics-big-count">100,000,000 <small>ROWS</small></strong><p>100 milyon satırı uygulamaya çekmiyoruz; hesabı verinin yanında yaptırıp küçük özetleri alıyoruz.</p><div className="basics-collapse-flow">{['DB metadata','COUNT / GROUP BY / DISTINCT','İsteğe bağlı sample / sketch','Nadir durumlar için hedefli sorgu'].map((label,i)=><div key={label} style={{'--reveal-delay':`${i*80}ms`} as React.CSSProperties}><ArrowDown size={14}/><span>{label}</span></div>)}<div className="basics-metric-stack"><ArrowDown size={14}/><strong>{fmt(fingerprints.length)} <small>METRICS</small></strong></div></div><p className="basics-caption">POC: exact SQL + küçük gruplanmış durumlar. 100M benchmark yapılmadı; sample/sketch bu akışın olası hızlandırıcılarıdır.</p></div>;
    case 3:return <><div className="basics-equation"><span><Layers3 size={24}/><strong>Ortak engine</strong></span><b>+</b><span><ShieldCheck size={24}/><strong>Domain Config</strong></span><b>=</b><span className="basics-result"><FingerprintIcon size={24}/><strong>{workspace.displayName}<br/>Fingerprint</strong></span></div><dl className="basics-config-example"><div><dt>Domain</dt><dd>{workspace.id}</dd></div><div><dt>Metric</dt><dd>{cards?'2+ active cards':'2+ active accounts'}</dd></div><div><dt>Rule</dt><dd>{cards?'CLOSED card → available limit = 0':'CLOSED customer → active accounts = 0'}</dd></div></dl><div className="basics-domain-examples">{(cards?['2+ active cards','Physical + virtual combination','CLOSED card → available limit = 0']:['2+ active accounts','FX account','Active loan','Closed customer + active account']).map(t=><span key={t}>{t}</span>)}</div><p className="basics-key-line">Her domain için sıfırdan engine yazmıyoruz.</p><p className="basics-caption">Ortak SQL ölçümleri yeniden kullanılır; iş anlamı ve eşikler domain tanımlarıyla eklenir.</p></>;
    case 4:return <><div className="basics-identity"><div><Database size={45}/><strong>İki kaynak</strong><small>{prod}<br/>{test}</small></div><ArrowRight size={25}/><div className="basics-identity-stack"><FingerprintIcon size={34}/><strong>{fmt(fingerprints.length)}</strong><span>metrik</span></div></div><div className="basics-fields">{['metric','value','environment','scope','timestamp','calculation method'].map(t=><span key={t}>{t}</span>)}</div><p className="basics-key-line">Fingerprint ham veri değil; verinin karşılaştırılabilir kimliğidir.</p></>;
    case 5:return <><h3 className="basics-chart-title">{cards?'2+ active cards':'2+ active accounts'}</h3><div className="basics-bars">{[[prod,'PROD'],[test,'TEST']].map(([env,label])=><div key={env}><span>{label}</span><div className="basics-bar-track"><i className={label==='PROD'?'is-prod':'is-test'} style={{width:`${overview.business_metrics[env][rateKey]*100}%`}}/></div><strong>{pct(overview.business_metrics[env][rateKey])}</strong></div>)}</div><p className="basics-key-line">Fark tek başına problem demek değildir.</p><p className="basics-caption">Destek + kapsam + iş önemi → finding değerlendirmesi</p></>;
    case 6:return <><div className="basics-finding-stats">{[['Coverage',`${coverage.represented_in_test} / ${coverage.total_significant_prod_states}`],['Missing',fmt(coverage.missing_in_test)],['Underrepresented',fmt(coverage.underrepresented_in_test)],['Findings',fmt(findings.length)],[cards?'Health violations':'Health candidates',healthCount]].map(([label,value])=><div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div><div className="basics-finding-types">{['Representation Gap','Missing State','Data Health Issue','Freshness Gap'].map((t,i)=><span key={t} style={{'--reveal-delay':`${i*80}ms`} as React.CSSProperties}>{t}</span>)}</div><p className="basics-caption">Az temsil edilen durumlar, represented kapsamına dahildir. Freshness gap: {fmt(overview.freshness.age_difference_days)} gün; analiz anındaki TEST data age: {Math.floor(overview.test_data_age_days)} gün.</p></>;
    default:return <><div className="basics-explanation">{[['Evidence',`TEST = ${healthCount}`,health?.title],['RAG Context',rule,cards?'Kapalı kartın kullanılabilir limiti sıfır olmalıdır.':'Kapalı müşterilerin aktif hesabı bulunmamalıdır.'],['LLM Explanation','Okunabilir açıklama',health?.explanation]].map(([label,title,text],i)=><div key={label} style={{'--reveal-delay':`${i*150}ms`} as React.CSSProperties}><span>{String(i+1).padStart(2,'0')} · {label}</span><strong>{title}</strong><p>{text}</p></div>)}</div><p className="basics-key-line">Engine bulur; RAG ilgili bilgiyi getirir; LLM yalnızca açıklar.</p><p className="basics-caption">Mevcut kanıt ve doğrulanmış demo kuralıyla açıklama akışı örneği. Gösterilen metin kayıtlı finding özetidir; bu sayfa yeni RAG/LLM işi tetiklemez.</p></>;
  }
}

export function FingerprintBasics({workspace,overview,coverage,findings,fingerprints}:Props){
  const [active,setActive]=useState(0),[technical,setTechnical]=useState(false),[mode,setMode]=useState<'stopped'|'playing'|'paused'>('stopped');
  const stepButtons=useRef<(HTMLButtonElement|null)[]>([]);
  useEffect(()=>{setMode('stopped');},[workspace.id]);
  useEffect(()=>{if(mode!=='playing')return;const timer=setTimeout(()=>{if(active===7)setMode('stopped');else setActive(active+1);},2500);return()=>clearTimeout(timer);},[mode,active]);
  function select(index:number,focus=false){setMode('stopped');setActive(index);if(focus)stepButtons.current[index]?.focus();}
  if(!overview||!coverage)return <div className="empty" role="status">Workspace özeti yükleniyor…</div>;
  const data:Loaded={workspace,overview,coverage,findings,fingerprints};
  const step=basicsSteps[active],Icon=icons[active],cards=workspace.id==='CARDS';
  const rateKey=cards?'multi_active_card_rate':'multi_account_rate';
  const record=fingerprints.find(f=>f.metric_name===rateKey&&f.environment===overview.environments[0]);
  return <section className="basics-page" lang="tr" aria-label="Fingerprint Basics">
    <div className="basics-intro"><div><span className="basics-eyebrow">AYNI ENGINE · FARKLI DOMAIN</span><h2>Ham veriyi taşımıyoruz; verinin karakterini küçük ve karşılaştırılabilir bir fingerprint’e dönüştürüyoruz.</h2><p>Basics: “Bana basitçe anlat.” <span>Pipeline: “Detaylı ürün sürecini göster.”</span></p></div><div className="basics-live-summary" aria-label="Basics summary"><span><Check size={13}/>{workspace.displayName}</span><strong data-testid="basics-metrics">{fmt(fingerprints.length)} <small>metrik</small></strong><p><b>{findings.length}</b> finding · <b>{coverage.represented_in_test} / {coverage.total_significant_prod_states}</b> coverage</p></div></div>
    <div className="basics-toolbar"><div className="basics-view-toggle" role="group" aria-label="Görünüm"><button aria-pressed={!technical} onClick={()=>setTechnical(false)}><BookOpen size={13}/>Business view</button><button aria-pressed={technical} onClick={()=>setTechnical(true)}>Technical view</button></div><div className="basics-walk-controls">
      {mode==='playing'?<button onClick={()=>setMode('paused')}><Pause size={13}/>Pause walkthrough</button>:<button onClick={()=>{if(mode==='stopped')setActive(0);setMode('playing');}}><Play size={13}/>{mode==='paused'?'Resume walkthrough':'Play walkthrough'}</button>}
      {mode!=='stopped'&&<button aria-label="Stop walkthrough" onClick={()=>{setMode('stopped');setActive(0);}}><Square size={12}/>Stop</button>}
    </div></div>
    <div className="basics-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={1} aria-valuemax={8} aria-valuenow={active+1}><i style={{width:`${(active+1)/8*100}%`}}/></div>
    <ol className="basics-steps" aria-label="Fingerprint Basics adımları">{basicsSteps.map((s,i)=><li key={s.title}><button ref={el=>{stepButtons.current[i]=el;}} className={active===i?'is-active':''} aria-pressed={active===i} aria-controls="basics-detail" onClick={()=>select(i)} onKeyDown={e=>{const next=e.key==='Home'?0:e.key==='End'?7:['ArrowRight','ArrowDown'].includes(e.key)?(i+1)%8:['ArrowLeft','ArrowUp'].includes(e.key)?(i+7)%8:null;if(next!==null){e.preventDefault();select(next,true);}}}><span>{String(i+1).padStart(2,'0')}</span><strong>{s.title}</strong></button></li>)}</ol>
    <section className="basics-detail" id="basics-detail" role="region" aria-labelledby="basics-step-title" key={`${workspace.id}-${active}`}>
      <header className="basics-detail-header"><span className="basics-active-icon"><Icon size={25}/></span><div><small>ADIM {String(active+1).padStart(2,'0')} / 08 · {workspace.displayName}</small><h2 id="basics-step-title">{step.title}</h2></div><div className="basics-next-prev"><button aria-label="Previous step" disabled={active===0} onClick={()=>select(active-1)}><ChevronLeft size={18}/></button><button aria-label="Next step" disabled={active===7} onClick={()=>select(active+1)}><ChevronRight size={18}/></button></div></header>
      <div className="basics-what" aria-label="WHAT HAPPENS HERE?"><small>BU ADIMDA NE OLUR?</small><p>{step.what}</p></div>
      <div className="basics-visual"><BasicsVisual stage={active} data={data}/></div>
      <div className="basics-io"><div aria-label="INPUT"><small>INPUT / GİRDİ</small><p>{step.input}</p></div><ArrowRight size={17}/><div aria-label="OUTPUT"><small>OUTPUT / ÇIKTI</small><p>{step.output}</p></div></div>
      <div className="basics-responsibilities"><div aria-label="WHAT IS AUTOMATIC?"><small><Check size={13}/>OTOMATİK OLAN</small><p>{step.automatic}</p></div><div aria-label="WHAT DOES THE USER CONFIGURE?"><small><ShieldCheck size={13}/>SİZİN AYARLADIKLARINIZ</small><p>{step.configure}</p></div></div>
      <div className="basics-tech" aria-label="TECHNOLOGY"><small>TECHNOLOGY / ARAÇLAR <span>· ? ile kısa açıklama</span></small><div>{step.tech.map(name=><HelpTerm key={name} name={name}/>)}</div></div>
      <BasicsStepExplanation key={`${workspace.id}-${active}`} stage={active} data={data} technical={technical}/>
      {technical&&<section className="basics-technical" aria-label="Technical view details"><h3>Teknik bakış · aynı kayıtlı veri</h3><p>Şemalar: <strong>{overview.environments.join(' → ')}</strong> · {workspace.stateFeatureCount} durum özelliği. Örnekler açıklama amaçlıdır; çalıştırılmaz.</p><div><section><h4>Ortak SQL ölçümü</h4><pre>{`SELECT status, COUNT(*)\nFROM ${overview.environments[0]}.${cards?'card':'customer'}\nGROUP BY status;`}</pre><p>Generic: sayım / null / distinct / tarih.<br/>Domain: iş metriği / ilişki / kural.</p></section><section><h4>Domain tanımı örneği</h4><pre>{JSON.stringify({domain:workspace.id,metric:rateKey,rule:cards?'CLOSED card → available limit = 0':'CLOSED customer → active accounts = 0'},null,2)}</pre></section></div><h4>Mevcut fingerprint kaydı</h4><pre>{JSON.stringify(record,null,2)}</pre></section>}
    </section>
    <details className="basics-glossary"><summary>Teknoloji ve kavram rehberi</summary><div className="basics-tech">{Object.keys(basicsHelp).map(name=><HelpTerm key={name} name={name}/>)}</div><div className="basics-reference">{Object.keys(basicsHelp).map(name=><details key={name}><summary>{name==='Metadata queries'?'Metadata':name}</summary><ConceptDefinition name={name}/></details>)}</div></details>
    <p className="basics-footnote">Mevcut POC: PostgreSQL, SQL aggregate, küçük gruplarda Polars, yerel BM25 ve isteğe bağlı Ollama. Oracle, DuckDB, Parquet ve sketch yolları olası genişletmelerdir; bu sayfa connector, kural veya veri değiştirmez.</p>
  </section>;
}
