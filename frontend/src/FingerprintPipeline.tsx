import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, Database, FileCheck2, GitCompareArrows, Layers3, ListTree, Pause, Play, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';
import type { Coverage, DomainInfo, Finding, Fingerprint, Overview } from './types';
import './pipeline.css';

const stages = [
  {label:'SOURCE',title:'Kaynak seçimi',short:'Onaylı PROD ve mevcut TEST',icon:Database},
  {label:'SCHEMA DISCOVERY',title:'Şemayı keşfet',short:'Tablolar, alanlar, ilişkiler',icon:ListTree},
  {label:'GENERIC PROFILING',title:'Ortak metrikleri çıkar',short:'Satır, null, distinct, tarih',icon:ScanLine},
  {label:'DOMAIN PROFILING',title:'Domain’e özel metrikleri ekle',short:'İş metrikleri ve kurallar',icon:ShieldCheck},
  {label:'FINGERPRINT',title:'Fingerprint oluştur',short:'Küçük, yapısal metrik seti',icon:Layers3},
  {label:'PROD ↔ TEST COMPARISON',title:'Aynı metriği iki ortamda karşılaştır',short:'Farkı iş bağlamında değerlendir',icon:GitCompareArrows},
  {label:'COVERAGE & FINDINGS',title:'Coverage ve finding üret',short:'Eksik durumlar ve veri sağlığı',icon:FileCheck2},
  {label:'CONTEXT & EXPLANATION',title:'Bulguya bağlam ekle, açıkla',short:'Kanıt → bağlam → açıklama',icon:Sparkles},
];
const fmt = (v:number) => new Intl.NumberFormat('en-US').format(v);
const pct = (v:number) => `${(v*100).toFixed(2)}%`;
const findingTypes = ['Representation Gap','Missing State','Data Health Issue','Freshness Gap'];
type Props = {workspace:DomainInfo;overview:Overview|null;coverage:Coverage|null;fingerprints:Fingerprint[];findings:Finding[]};

export function FingerprintPipeline({workspace,overview,coverage,fingerprints,findings}:Props) {
  const [active,setActive]=useState(0);
  const [playing,setPlaying]=useState(false);
  const buttons=useRef<(HTMLButtonElement|null)[]>([]);
  useEffect(()=>{setPlaying(false);},[workspace.id]);
  useEffect(()=>{
    if(!playing)return;
    const timer=setTimeout(()=>{if(active===7)setPlaying(false);else setActive(active+1);},1500);
    return ()=>clearTimeout(timer);
  },[active,playing]);
  function select(index:number,focus=false){setPlaying(false);setActive(index);if(focus)buttons.current[index]?.focus();}
  if(!overview||!coverage)return <div className="empty" role="status">Loading workspace pipeline…</div>;
  const cards=workspace.id==='CARDS';
  const [prodEnv,testEnv]=overview.environments;
  const rateKey=cards?'multi_active_card_rate':'multi_account_rate';
  const metricLabel=cards?'Customers with 2+ active cards':'Customers with 2+ active accounts';
  const prodRate=overview.business_metrics[prodEnv][rateKey],testRate=overview.business_metrics[testEnv][rateKey];
  const example=fingerprints.find(m=>m.environment===prodEnv&&m.metric_name===rateKey);
  const health=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
  const healthValue=typeof health?.test_value==='number'?fmt(health.test_value):'—';
  const rule=cards?'BR-CARD-001':'BR-CUSTOMER-001';
  const ruleText=cards?'Kapalı statüdeki kartın kullanılabilir limiti sıfır olmalıdır.':'Kapalı müşterilerin aktif hesabı bulunmamalıdır.';
  const tables=cards?['card','card_account','card_limit','card_status_history','card_customer','funding_account']:['customer','account','loan','card'];
  const domainMetrics=cards?['Customers with 2+ active cards','Physical + virtual card combination','Closed card + positive available limit','Card type/status combinations']:['Customers with 2+ active accounts','FX account presence','Active loan presence','Closed customer + active account','Customer/product state combinations'];
  const io=[
    ['Onaylı snapshot / restore edilmiş backup / read-only replica veya kaynak; mevcut TEST/QA veritabanı.',`${prodEnv} → ${testEnv}; analiz için izin verilen şemalar.`],
    ['Tablolar, kolonlar, veri tipleri, PK/FK ilişkileri ve tarih alanları.','Ölçülecek tablolar, ilişkiler ve tarih alanlarından oluşan yapısal harita.'],
    ['Şema haritası ve izin verilen alanlar.','Ortak profil: satır sayısı, null oranı, distinct, tarih aralığı, dağılımlar ve ilişki sağlığı.'],
    ['Ortak profil + domain config / rule set.','İş metrikleri ve domain’e özel durum kombinasyonları.'],
    ['Ortak metrikler + domain metrikleri.',`${fmt(fingerprints.length)} kayıtlı fingerprint metriği; iki ortam için aynı yapı.`],
    ['PROD ve TEST için eşleşen metrikler.','Metrik farkları; kapsam, veri bulunurluğu ve iş önemi ile değerlendirilir.'],
    ['Karşılaştırılan metrikler, durum kombinasyonları ve kural eşikleri.',`${fmt(findings.length)} finding; ${coverage.represented_in_test} / ${coverage.total_significant_prod_states} temsil edilen durum.`],
    ['Deterministik finding kanıtı ve ilgili yerel kurum bilgisi.','İnsan tarafından okunabilir açıklama; kanıt ve finding değişmez.'],
  ];
  function comparison(){return <div className="pipeline-comparison" aria-label={metricLabel}>
    <h3>{metricLabel}</h3>{[[prodEnv,'PROD',prodRate],[testEnv,'TEST',testRate]].map(([env,label,rate])=><div className="pipeline-bar-row" key={String(env)}><span>{String(label)}</span><div className="pipeline-bar-track"><div className={label==='PROD'?'pipeline-prod-bar':'pipeline-test-bar'} style={{width:`${Number(rate)*100}%`}}/></div><strong>{pct(Number(rate))}</strong></div>)}
  </div>;}
  function detail(overview:Overview,coverage:Coverage){switch(active){
    case 0:return <><p>PROD referansı, onaylı snapshot, restore edilmiş backup veya read-only replica/kaynak olabilir. TEST, mevcut test/QA veritabanıdır.</p><div className="pipeline-source-pair"><span><small>PROD SOURCE</small><strong>{prodEnv}</strong></span><ArrowRight size={18}/><span><small>TEST SOURCE</small><strong>{testEnv}</strong></span></div><p className="pipeline-callout">Canlı PROD’a bağlanmak zorunlu değildir.</p><div className="pipeline-tags"><span>Current: Manual Run Analysis</span><span>Future: Scheduled analysis</span></div><p className="pipeline-note">Mevcut POC: ayrı PostgreSQL şemaları, manuel tetikleme. Sürekli canlı DB polling yapılmaz.</p></>;
    case 1:return <><p>Önce tabloları, kolonları, veri tiplerini, PK/FK ilişkilerini ve tarih alanlarını anlamlandırırız. Mevcut POC, domain için önceden tanımlı tablo/alan haritasını ve bilinen ilişkileri kullanır; otomatik connector keşfi sunmaz.</p><div className="pipeline-table-map">{tables.map(t=><span key={t}><Database size={14}/>{t}</span>)}</div><p className="pipeline-example">{cards?'card.card_id → card_limit.card_id · card → card_account → funding_account':'customer.customer_id → account.customer_id · loan.customer_id · card.customer_id'}</p><p className="pipeline-callout">Önce verinin yapısını anlarız; her satırı uygulamaya çekmekle başlamayız.</p></>;
    case 2:return <><p>SELECT * ile milyonlarca satırı taşımak yerine COUNT, GROUP BY, DISTINCT ve aggregate hesapları kaynağın yanında çalıştırılır.</p><div className="pipeline-tags">{['row count','null rate','distinct / cardinality','min/max & date range','status distribution','relationship integrity','freshness'].map(t=><span key={t}>{t}</span>)}</div><p className="pipeline-example">Kayıtlı örnek: {prodEnv}.{cards?'card':'customer'} → row_count = {fmt(overview.business_metrics[prodEnv][workspace.entityCountKey])}</p><div className="pipeline-large-table"><div className="pipeline-section-label">BÜYÜK TABLO STRATEJİSİ · KAVRAMSAL ÖRNEK</div><h3>100 milyon satırı taşımıyoruz; 100 milyon satırın karakterini özetliyoruz.</h3><ol className="pipeline-collapse">{['100,000,000 rows','Oracle/PostgreSQL metadata & statistics','Database-side aggregates','Controlled sampling where appropriate','Targeted queries for rare/critical states','Small fingerprint metric set'].map((s,i)=><li key={s} style={{'--reveal-delay':`${i*70}ms`} as React.CSSProperties}><span>{s}</span>{i<5&&<ArrowDown size={13}/>}</li>)}</ol><p>Gerekli metriklerde exact DB aggregation kullanılır. Kontrollü sampling keşif amaçlı dağılımları hızlandırabilir; uygun yerlerde approximate / sketch yöntemleri değerlendirilebilir. Nadir veya kritik durumlar hedefli sorgularla doğrulanır; yalnızca sampling’e güvenilmez.</p><p className="pipeline-note">Mevcut POC: PostgreSQL exact aggregate ve bounded grouped states; Polars yalnızca küçük grupları işler. 100M ölçümü yapılmış değildir. Polars / DuckDB ve Apache DataSketches olası ölçek hızlandırıcılarıdır; yeni veya zorunlu bağımlılık eklenmez.</p></div></>;
    case 3:return <><div className="pipeline-profiling-pair"><div><small>GENERIC PROFILING</small><strong>Mostly automatic</strong><p>Yapısal alanlara aynı ortak ölçümler uygulanır.</p></div><div><small>DOMAIN PROFILING</small><strong>Domain config / rules</strong><p>İş açısından önemli metrikler ve ilişkiler tanımlanır.</p></div></div><div className="pipeline-tags">{domainMetrics.map(m=><span key={m}>{m}</span>)}</div><p className="pipeline-callout">Fingerprint’in temel kısmı otomatik; iş açısından önemli metrikler domain config/rule set ile eklenir.</p><p className="pipeline-example">{metricLabel}: PROD {pct(prodRate)} · TEST {pct(testRate)}</p></>;
    case 4:return <><p>Fingerprint ham veri değil; metrik adı, değer, kapsam, ortam, timestamp ve hesaplama yöntemini içeren yapısal bir metrik setidir. Gerekirse sample/approximation metadata eklenebilir; mevcut POC exact ölçümleri kullanır.</p><div className="pipeline-record"><span>{example?.scope}</span><strong>{example?.metric_name}</strong><b>{pct(prodRate)}</b><small>{prodEnv} · {example?new Date(example.timestamp).toLocaleString():'—'}</small></div>{comparison()}<p className="pipeline-callout">Fingerprint, verinin fotoğrafı değil; karşılaştırılabilir özet karakteridir.</p></>;
    case 5:return <>{comparison()}<p className="pipeline-callout">Fark = otomatik problem değildir.</p><div className="pipeline-formula"><span>Difference</span><b>+</b><span>coverage / availability</span><b>+</b><span>business relevance</span><b>=</b><strong>finding assessment</strong></div><p>TEST’in PROD’u 1:1 kopyalaması beklenmez. Farkın test senaryolarını ve iş açısından önemli durumları ne ölçüde etkilediği değerlendirilir.</p></>;
    case 6:return <><div className="pipeline-coverage-grid">{[
      ['Coverage',`${coverage.represented_in_test} / ${coverage.total_significant_prod_states}`],['Missing',fmt(coverage.missing_in_test)],['Underrepresented',fmt(coverage.underrepresented_in_test)],['Findings',fmt(findings.length)],[cards?'Health violations':'Health candidates',healthValue],['Freshness gap',`${fmt(overview.freshness.age_difference_days)} days`],['TEST data age',`${Math.floor(overview.test_data_age_days)} days`],['Fingerprints',fmt(fingerprints.length)],
    ].map(([label,v])=><div key={label}><small>{label}</small><strong>{v}</strong></div>)}</div><p className="pipeline-note">Freshness gap = PROD ve TEST’in son iş tarihleri arasındaki fark. TEST data age = analiz anında TEST’in yaşı. Underrepresented durumlar, represented toplamına dahildir.</p><div className="pipeline-finding-chips">{findingTypes.map((t,i)=><span key={t} style={{'--reveal-delay':`${i*80}ms`} as React.CSSProperties}>{t}</span>)}</div><p className="pipeline-example">{health?.title} → TEST {healthValue}</p></>;
    default:return <><p className="pipeline-callout">Engine bulur; RAG ilgili kurum bilgisini getirir; LLM yalnızca açıklar.</p><div className="pipeline-explanation-flow">{[
      ['01 · Finding evidence',`PROD = ${typeof health?.prod_value==='number'?fmt(health.prod_value):'—'} · TEST = ${healthValue}`,health?.title],
      ['02 · RAG retrieval → Business rule / glossary',rule,ruleText],
      ['03 · Local Ollama → Human-readable explanation','Async generation · deterministic fallback',health?.explanation],
    ].map(([label,title,text],i)=><div key={label} style={{'--reveal-delay':`${i*160}ms`} as React.CSSProperties}><small>{label}</small><strong>{title}</strong><p>{text}</p></div>)}</div><p className="pipeline-note">Kayıtlı kanıt ve doğrulanmış demo kuralıyla akış örneği. Burada gösterilen metin deterministik finding özetidir; yeni RAG/LLM işi tetiklenmez. Gerçek finding detayında kanıt hemen görünür, açıklama arka planda tamamlanır.</p></>;
  }}
  return <section className="pipeline-page" aria-label="Fingerprint Pipeline" lang="tr">
    <div className="pipeline-intro"><div><span className="pipeline-section-label">SAME ENGINE · DIFFERENT DOMAIN</span><h2>Engine aynı; fingerprint içeriği domain’e göre değişir.</h2><p>Ham veriyi taşımak yerine veri karakterini ölçer, aynı metrikleri PROD ve TEST’te karşılaştırırız.</p></div><span className="pipeline-workspace-tag"><Check size={13}/>{workspace.displayName}</span></div>
    <div className="pipeline-summary" key={workspace.id} aria-label="Pipeline summary"><div><strong data-testid="pipeline-fingerprints">{fmt(fingerprints.length)}</strong><span>Fingerprint metrics</span></div><div><strong data-testid="pipeline-findings">{fmt(findings.length)}</strong><span>Findings</span></div><div><strong data-testid="pipeline-coverage">{coverage.represented_in_test} / {coverage.total_significant_prod_states}</strong><span>States represented</span></div><div className="pipeline-summary-example"><small>{metricLabel}</small><strong><span>PROD {pct(prodRate)}</span><ArrowRight size={14}/><span>TEST {pct(testRate)}</span></strong></div></div>
    <div className="pipeline-controls"><p>8 aşama · bir adım seçin</p><button className="pipeline-play" onClick={()=>{if(playing)setPlaying(false);else{setActive(0);setPlaying(true);}}}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'Stop walkthrough':'Play walkthrough'}</button></div>
    <ol className="pipeline-stages" aria-label="Fingerprint pipeline stages">{stages.map((s,index)=><li key={s.label}>
      <button ref={el=>{buttons.current[index]=el;}} className={`pipeline-stage ${active===index?'is-active':''}`} style={{'--pulse-delay':`${index*140}ms`} as React.CSSProperties} aria-pressed={active===index} aria-controls="pipeline-detail" onClick={()=>select(index)} onKeyDown={e=>{
        const indexNext=e.key==='Home'?0:e.key==='End'?7:['ArrowRight','ArrowDown'].includes(e.key)?(index+1)%8:['ArrowLeft','ArrowUp'].includes(e.key)?(index+7)%8:null;
        if(indexNext!==null){e.preventDefault();select(indexNext,true);}
      }}><span className="pipeline-stage-top"><span>{String(index+1).padStart(2,'0')}</span><s.icon size={17}/></span><strong>{s.label}</strong><small>{s.short}</small></button>
      {active===index&&<section id="pipeline-detail" className="pipeline-detail" role="region" aria-labelledby="pipeline-stage-title" key={`${workspace.id}-${active}`}><div className="pipeline-detail-heading"><span className="pipeline-step-number">{String(active+1).padStart(2,'0')}</span><div><small>{s.label} · {workspace.displayName}</small><h2 id="pipeline-stage-title">{s.title}</h2></div></div><div className="pipeline-io"><div><small>INPUTS</small><p>{io[active][0]}</p></div><ArrowRight size={15}/><div><small>OUTPUTS</small><p>{io[active][1]}</p></div></div><div className="pipeline-detail-content">{detail(overview,coverage)}</div></section>}
    </li>)}</ol>
    <section className="pipeline-latest panel" aria-label="Latest analysis"><h2>Latest analysis</h2><dl>{[
      ['Workspace',workspace.displayName],['Trigger type','Manual Run Analysis'],['PROD source',prodEnv],['TEST source',testEnv],['Fingerprint count',fmt(fingerprints.length)],['Finding count',fmt(findings.length)],['Coverage',`${coverage.represented_in_test} / ${coverage.total_significant_prod_states}`],['Analysis timestamp',new Date(overview.generated_at).toLocaleString()],
    ].map(([label,v])=><div key={label}><dt>{label}</dt><dd>{v}</dd></div>)}</dl></section>
    <details className="pipeline-technical"><summary>Technical details</summary><div><p>Current domain map · {workspace.displayName} · {workspace.stateFeatureCount} state features · {prodEnv} / {testEnv}</p><p>Calculation method: {example?.calculation_method}</p><pre>{JSON.stringify(example,null,2)}</pre><p>Aggregate SQL concept (not executed by this page):</p><pre>{`SELECT status, COUNT(*) FROM ${prodEnv}.${cards?'card':'customer'} GROUP BY status;`}</pre><p>Configured rule example: {rule} · {ruleText}</p><p>Sample / approximation metadata is optional; these saved metrics are exact.</p></div></details>
  </section>;
}
