import { useState } from 'react';
import { basicsHelp, basicsSteps } from './basicsContent';
import { stepExplanation, type BasicsDetailData } from './basicsDetails';

export function ConceptDefinition({ name }: { name: string }) {
  const help = basicsHelp[name];
  return <dl className="basics-concept-definition">
    <div><dt>WHAT IS IT?</dt><dd>{help.what}</dd></div>
    <div><dt>WHERE DO WE USE IT?</dt><dd>{help.where}</dd></div>
    <div><dt>WHY IS IT HERE?</dt><dd>{help.why}</dd></div>
  </dl>;
}

export function BasicsStepExplanation({ stage, data, technical }: { stage: number; data: BasicsDetailData; technical: boolean }) {
  const [open, setOpen] = useState(false);
  const detail = stepExplanation(stage, data);
  const snippets = [...detail.snippets, ...(technical ? detail.technicalSnippets ?? [] : [])];
  return <details className="basics-how" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Bu adım gerçekte nasıl çalışıyor?<span>Kısa örnek, sorgu ve sorumluluklar</span></summary>
    {open && <div className="basics-how-body">
      <div className="basics-how-grid">
        <section><h3><span>01</span>Bu adımda ne yapıyoruz?</h3><p>{detail.purpose}</p></section>
        <section><h3><span>02</span>Gerçekte sistem ne yapıyor?</h3><p>{detail.system}</p></section>
      </div>
      <section className="basics-how-example"><h3><span>03</span>Basit örnek</h3><p>{detail.example}</p>
        {detail.flow && <ol className="basics-how-flow" aria-label="Örnek akış">{detail.flow.map(item => <li key={item}>{item}</li>)}</ol>}
        {detail.note && <p className="basics-how-note">{detail.note}</p>}
      </section>
      <section className="basics-how-snippets"><h3><span>04</span>Örnek sorgu / config</h3><p>Salt okunur anlatım örnekleri; bu sayfada hiçbir sorgu veya config çalıştırılmaz.</p>
        {snippets.length ? <div>{snippets.map(snippet => <figure key={snippet.label}><figcaption>{snippet.label}</figcaption><pre><code>{snippet.code}</code></pre></figure>)}</div> : <p>Bu kapsamda örnek kayıt bulunamadı; gösterim için veri üretilmez.</p>}
      </section>
      <div className="basics-how-grid basics-how-roles">
        <section><h3><span>05</span>Ne otomatik?</h3><ul>{detail.automatic.map(item => <li key={item}>{item}</li>)}</ul></section>
        <section><h3><span>06</span>Kullanıcı ne ayarlar?</h3><ul>{detail.configure.map(item => <li key={item}>{item}</li>)}</ul></section>
      </div>
      <section><h3><span>07</span>Çıktı ne?</h3><p>{detail.output}</p></section>
      <section className="basics-how-tools"><h3><span>08</span>Hangi teknoloji burada ve neden?</h3><div>{basicsSteps[stage].tech.map(name => <article key={name}><h4>{name}</h4><ConceptDefinition name={name}/></article>)}</div></section>
    </div>}
  </details>;
}
