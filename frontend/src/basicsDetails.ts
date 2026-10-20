import type { Coverage, DomainInfo, Finding, Fingerprint, Overview } from './types';

export type BasicsDetailData = {
  workspace: DomainInfo; overview: Overview; coverage: Coverage;
  findings: Finding[]; fingerprints: Fingerprint[];
};
type Snippet = { label: string; code: string };
export type StepExplanation = {
  purpose: string; system: string; example: string; flow?: string[];
  snippets: Snippet[]; technicalSnippets?: Snippet[]; note?: string;
  automatic: string[]; configure: string[]; output: string;
};

export function stepExplanation(stage: number, data: BasicsDetailData): StepExplanation {
  const { workspace, overview, coverage, findings, fingerprints } = data;
  const cards = workspace.id === 'CARDS';
  const [prod, test] = overview.environments;
  const metric = cards ? 'multi_active_card_rate' : 'multi_account_rate';
  const entity = cards ? 'card' : 'account';
  const rule = cards ? 'BR-CARD-001' : 'BR-CUSTOMER-001';
  const rate = (env: string) => overview.business_metrics[env][metric];
  const percent = (v: number) => `${(v * 100).toFixed(2)}%`;
  const count = (v: number) => new Intl.NumberFormat('en-US').format(v);
  const record = fingerprints.find(f => f.metric_name === metric && f.environment === prod);
  const health = findings.find(f => f.finding_type === 'DATA_HEALTH_ISSUE');
  const representation = findings.find(f => f.finding_type === 'REPRESENTATION_GAP' && f.evidence.metric === metric);
  const healthCount = typeof health?.test_value === 'number' ? count(health.test_value) : '—';
  switch (stage) {
    case 0: return {
      purpose: 'Ürün önce hangi PROD referansını hangi TEST ortamıyla karşılaştıracağını bilir. Onaylı snapshot, restore edilmiş backup veya read-only kaynak seçilebilir.',
      system: `Bu POC, PostgreSQL’de önceden hazırlanmış ${prod} ve ${test} şemalarını kullanır. Burada yeni bir bağlantı kurulmaz; ham business satırları kopyalanmaz.`,
      example: 'Kavramsal bağlantı örneği: PROD bir read-only replica, TEST ise QA veritabanı olabilir. Aşağıdaki şema adları canlı bağlantı bilgisi değildir.',
      snippets: [{ label: 'Bağlantı kapsamı örneği · kimlik bilgisi içermez', code: 'PROD: read-only replica\nschema: CUSTOMER_APP\n\nTEST: QA database\nschema: CUSTOMER_APP_TEST' }],
      automatic: ['Genel bağlantı akışında: bağlantı sağlığı, kaynağa erişim ve şema görünürlüğü kontrol edilir.', 'Read-only yetki mümkün olduğunda doğrulanır. POC’de kaynak bağlantısı önceden ayarlıdır.'],
      configure: ['Bağlantı bilgileri ve güvenli kimlik bilgileri.', 'Şema/tablo kapsamı ve dahil/hariç listeleri. Bu sayfa bu ayarları değiştirmez.'],
      output: `Karşılaştırma çifti: ${prod} → ${test}; izin verilen kaynak kapsamı.`,
    };
    case 1: return {
      purpose: 'Burada business tablosuna SELECT * atmıyoruz. Önce database’in kendi metadata kataloglarını okuma yaklaşımını anlatıyoruz.',
      system: 'Kataloglar tablo, kolon, veri tipi, PK/FK ve tarih alanlarını tanıtır. Oracle ALL_CONSTRAINTS / ALL_CONS_COLUMNS ilişkileri; PostgreSQL information_schema / pg_catalog yapı bilgisini verir. Mevcut POC otomatik keşif yerine önceden tanımlı tablo/alan ve ilişki haritasını kullanır.',
      example: 'Oracle örneği yalnızca hangi tabloların bulunduğunu söyler. Technical view, kolon ve veri tipi örneğini de gösterir. Bu sorgular burada çalıştırılmaz; POC’de Oracle connector yoktur.',
      flow: cards ? ['CUSTOMER → CARD', 'CARD → CARD_ACCOUNT / CARD_LIMIT / CARD_STATUS_HISTORY'] : ['CUSTOMER → ACCOUNT → LOAN', 'CUSTOMER → CARD'],
      snippets: [{ label: 'Oracle metadata · tablo listesi (eğitim örneği)', code: "SELECT table_name\nFROM all_tables\nWHERE owner = 'APP_SCHEMA';" }],
      technicalSnippets: [{ label: 'Oracle metadata · kolon ve tip listesi', code: "SELECT table_name, column_name, data_type\nFROM all_tab_columns\nWHERE owner = 'APP_SCHEMA';" }],
      automatic: ['Katalog keşfi tasarımında: tablo, kolon, tip, PK/FK, tarih alanları ve ilişki grafiği.', 'Bu POC’de engine sürümlü şema haritasını kullanır; keşif connector’ü çalıştırmaz.'],
      configure: ['Alias, yok sayılacak tablolar/alanlar.', 'Gerekirse teknik alan adlarına iş anlamı eşlemesi ve semantik düzeltmeler.'],
      output: 'Sonraki ölçümlerin hangi tablo ve ilişkilere uygulanacağını belirleyen şema haritası.',
    };
    case 2: return {
      purpose: 'Şemayı öğrendikten sonra domain’den bağımsız temel ölçümleri çıkarıyoruz: kaç satır var, durumlar nasıl dağılıyor, boş veya eski alan var mı?',
      system: 'COUNT, GROUP BY, SUM, AVG, MIN, MAX ve DISTINCT gibi aggregate SQL hesapları veritabanında çalışır. Uygulama küçük sonucu alır; POC, DB’de gruplanmış küçük durumları Polars ile de işler.',
      example: 'Varsayımsal ACCOUNT tablosu: 100,000,000 satır. 100M satırı SELECT * ile indirmek yerine aşağıdaki akışla küçük bir metrik seti çıkarılır. Bu bir kapasite testi veya canlı POC sonucu değildir.',
      flow: ['1 · DB metadata', '2 · Uygun ölçümlerde exact aggregate SQL', '3 · Pahalı keşifte isteğe bağlı sample / sketch', '4 · Nadir/kritik durumlara hedefli sorgu', '5 · Küçük metrik setini sakla'],
      snippets: [{ label: 'Exact sayım · açıklama amaçlı, çalıştırılmaz', code: `SELECT COUNT(*)\nFROM ${prod}.${entity};` }],
      technicalSnippets: [
        { label: 'Durum dağılımı', code: `SELECT status, COUNT(*)\nFROM ${prod}.${entity}\nGROUP BY status;` },
        { label: 'Farklı müşteri sayısı', code: `SELECT COUNT(DISTINCT customer_id)\nFROM ${prod}.${entity};` },
        { label: 'En yeni kayıt tarihi', code: `SELECT MAX(${cards ? 'created_at' : 'opened_at'})\nFROM ${prod}.${entity};` },
      ],
      note: 'Varsayımsal çıktı (canlı metrik değil): row_count = 100M · active_rate = 71% · closed_rate = 24% · distinct_customers ≈ 18.4M · multi_active_account_rate = 32% · status_null_rate = 0.03%. 100 milyon satırı taşımıyoruz; 100 milyon satırın karakterini özetliyoruz.',
      automatic: ['Tanımlı alanlarda: satır/null/distinct sayımı, min/max ve tarih aralığı.', 'Durum dağılımı, ilişki bütünlüğü ve freshness. Kayıtlı POC metrikleri exact hesaplanır.'],
      configure: ['Normalde ek ayar gerekmez; gerekirse kapsam ve eşikler.', 'Genel mimaride örnekleme politikası seçilebilir; POC’de sampling/sketch uygulanmıyor. Nadir/kritik durumlar sample’a bırakılmaz.'],
      output: 'Domain’den bağımsız profil metrikleri. Polars genel mimaride hızlandırıcı seçeneğidir; mevcut POC’nin gerçek bağımlılığıdır. DuckDB/Parquet/DataSketches olası genişletmelerdir.',
    };
    case 3: return {
      purpose: 'Generic profiling teknik yapıyı ölçer. Domain profiling ise iş açısından anlamlı veri durumlarını çıkarır.',
      system: 'SQL generic mi? Çekirdek motor generic. Her domain için sıfırdan engine yazmıyoruz. Ortak ölçümler yeniden kullanılır; domain’e özel metrik ve kural tanımları iş anlamını ekler. POC’de bu tanımlar sürümlü koddadır.',
      example: cards ? 'Cards: 2+ aktif kart, fiziksel + sanal kart birleşimi ve kapalı kartta pozitif kullanılabilir limit. BR-CARD-001: CLOSED card → available limit = 0.' : 'Customer & Lending: 2+ aktif hesap, FX hesap, aktif kredi ve kapalı müşteri + aktif hesap. BR-CUSTOMER-001: CLOSED customer → active accounts = 0.',
      flow: ['Generic engine', '+ Domain config / reusable metric definitions', '= Domain fingerprint'],
      snippets: [{ label: 'Basit metrik tanımı', code: `Metric: ${cards ? '2+ active cards' : '2+ active accounts'}\nEntity: Customer\nDefinition: Active ${cards ? 'card' : 'account'} count >= 2` }],
      technicalSnippets: [{ label: 'Kavramsal config · uygulanan ayar değildir', code: JSON.stringify({ domain: workspace.id, metric, rule }, null, 2) }],
      automatic: ['Ortak metrikler, tanımlı ilişkiler ve yeniden kullanılabilir ölçümlerin yürütülmesi.'],
      configure: ['Önemli domain metrikleri ve onaylı iş kuralları.', 'Alias/semantik eşlemeler, minimum destek ve toleranslar.'],
      output: `${workspace.displayName} iş anlamını taşıyan metrikler ve durum kombinasyonları.`,
    };
    case 4: return {
      purpose: 'Bu noktada ayrı ölçümleri tek standart yapı altında topluyoruz. Her kayıtta metrik adı, değer, ortam, kapsam, zaman ve hesaplama yöntemi bulunur.',
      system: 'Engine hesapladığı ölçümleri standart fingerprint kayıtlarına dönüştürüp saklar. Aşağıdaki nesne mevcut PROD kaydından gelir; alan adları API’deki gerçek alanlardır.',
      example: `${workspace.displayName}: ${count(fingerprints.length)} kayıtlı fingerprint metriği. Bu standart yapı, iki ortamın aynı ölçüm dilini kullanmasını sağlar.`,
      snippets: record ? [{ label: 'Mevcut fingerprint kaydı · salt okunur', code: JSON.stringify(record, null, 2) }] : [],
      note: 'Fingerprint ham veri değil; verinin karşılaştırılabilir kimliğidir.',
      automatic: ['Hesaplanan değerlerin aynı formatta paketlenmesi ve analiz sonucuna kaydedilmesi.'],
      configure: ['Kaynak kapsamı ve domain tanımları; metrikleri elle doldurmanız gerekmez.'],
      output: `${count(fingerprints.length)} metriklik karşılaştırılabilir kimlik; ham müşteri satırları içermez.`,
    };
    case 5: return {
      purpose: 'PROD ve TEST fingerprint’leri aynı metric key ve kapsam üzerinden eşleştirilir. Aynı ölçümün iki ortamda nasıl temsil edildiğini görürüz.',
      system: 'Fark ve oran, tolerans, minimum destek, representation mantığı, coverage ve iş önemiyle birlikte değerlendirilir. Her fark tek başına problem değildir.',
      example: `${metric}: PROD ${percent(rate(prod))}, TEST ${percent(rate(test))}. Görsel fark ${(100 * (rate(prod) - rate(test))).toFixed(2)} yüzde puan; TEST / PROD oranı ${rate(prod) ? (rate(test) / rate(prod)).toFixed(2) : '—'}. Bunlar mevcut değerlerden türetilen sunum hesaplarıdır.`,
      flow: ['Difference', '+ coverage', '+ business importance', '= assessment'],
      snippets: [{ label: 'Eşleştirme örneği · kayıtlı değerler', code: `metric_name: ${metric}\nPROD: ${percent(rate(prod))}\nTEST: ${percent(rate(test))}` }],
      note: `${percent(rate(prod))} ve ${percent(rate(test))} görmek tek başına “TEST kötü” anlamına gelmez. TEST’in PROD’un 1:1 kopyası olması beklenmez.`,
      automatic: ['Aynı tanım ve kapsamla hesaplanan metriklerin eşleştirilmesi; kayıtlı karşılaştırma kurallarının uygulanması.'],
      configure: ['İş önemine göre toleranslar ve destek eşikleri. Bu sayfa eşik değiştirmez.'],
      output: 'Kapsam ve iş bağlamıyla değerlendirilebilen farklar; yeni bir metrik tanımı değil.',
    };
    case 6: return {
      purpose: 'Karşılaştırma sonuçları standardize edilmiş finding’lere dönüşür. Her finding neyin farklı olduğunu ve hangi kanıta dayandığını taşır.',
      system: 'Engine dört tür bulgu üretir: Representation Gap, Missing State, Data Health Issue ve Freshness Gap. AI bu kararı vermez.',
      example: `${findings.length} findings · ${coverage.represented_in_test}/${coverage.total_significant_prod_states} coverage · ${coverage.missing_in_test} missing · ${coverage.underrepresented_in_test} underrepresented · ${healthCount} ${cards ? 'health violations' : 'health candidates'}. Az temsil edilen durumlar represented kapsamına dahildir.`,
      snippets: representation ? [{ label: 'Kayıtlı finding’den alanlar · oranlar 0–1 aralığında', code: JSON.stringify({ finding_type: representation.finding_type, metric: representation.evidence.metric, prod_value: representation.prod_value, test_value: representation.test_value, assessment: representation.assessment }, null, 2) }] : [],
      automatic: ['Tanımlı kural, kapsam ve eşiklerle finding üretimi; kanıtın finding’e bağlanması.'],
      configure: ['İş kuralları, minimum destek ve incelenecek farkların önemi.'],
      output: `${findings.length} kayıtlı finding. Veri sağlığı bulgusu işaretlenir; bu ekranda kaynak veri düzeltilmez.`,
    };
    default: return {
      purpose: 'Finding zaten engine tarafından oluşturulmuştur. AI burada finding üretmez; hazır sonucu okunabilir dille açıklar.',
      system: 'RAG ilgili kurum bilgisini yerel knowledge base’den BM25 ile getirir. LLM hazır dil modelidir; evidence + retrieved context’i insan diline çevirir. LLM hesaplama motoru değildir.',
      example: `${cards ? 'Kapalı kart + pozitif kullanılabilir limit' : 'Kapalı müşteri + aktif hesap'}: TEST = ${healthCount}. İlgili onaylı kural ${rule}. Açıklama bu kanıtı ve kuralı temel alır.`,
      flow: ['Finding evidence', '→ RAG retrieval', '→ Business rule / glossary', '→ LLM explanation'],
      snippets: [{ label: 'Açıklama girdisi örneği · yeni iş tetiklemez', code: `Evidence: ${health?.evidence.metric ?? '—'}\nTEST: ${healthCount}\nRAG rule: ${rule}\nOutput: insan dilinde, kanıta bağlı açıklama` }],
      note: 'Kanıt hemen görünür; yerel Ollama açıklamayı asenkron hazırlar. Gerekirse deterministik fallback kullanılır. Bu sayfa kayıtlı özetleri gösterir; yeni retrieval veya LLM işi başlatmaz. Türkçe anlatım bu eğitim akışının dilidir, model çıktısına dil garantisi vermez.',
      automatic: ['Finding detail akışında yerel bağlam getirme, asenkron açıklama ve gerektiğinde deterministik fallback.'],
      configure: ['Onaylı business rule/glossary içeriği ve isteğe bağlı yerel model erişimi.'],
      output: 'Hazır finding’in insan tarafından okunabilir açıklaması; kanıt veya finding kararı değiştirilmez.',
    };
  }
}
