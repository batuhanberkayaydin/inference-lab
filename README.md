# Inference Lab

Yerel model karşılaştırma ve eşzamanlı yük ölçüm aracı. 1–24 ayrı girdi, 1–4 model, yönetici ayarları, hazır bağlamlar ve otomatik kayıtlı raporlar.

## Başlatma

### Docker Compose

Depoyu klonlayıp uygulama klasörüne geçin:

```bash
git clone https://github.com/batuhanberkayaydin/inference-lab.git
cd inference-lab
```

Docker çalışır durumdayken:

```bash
docker compose up
```

İlk açılışta arayüz ve Python backend yerel Dockerfile'dan tek imajda derlenir. Python tarafı yalnızca standart kütüphaneyi kullanır: pip, cryptography veya başka bir Python paketi kurulmaz; PyPI erişimi gerekmez. Sunucuya ayrıca Python veya Node kurmak gerekmez. İlk Docker derlemesi temel Node/Python imajlarını ve frontend npm paketlerini indirebilir; tamamen internetsiz bir derleme değildir.

Uygulama [http://127.0.0.1:8080](http://127.0.0.1:8080) adresindedir; giriş **admin / admin**. Arka planda çalıştırmak için `docker compose up -d`. Kaynak kodu güncelleyip yeniden derlemek için:

```bash
git pull
docker compose up --build -d
```

GitHub'da otomatik Docker derleme/yayın iş akışı yoktur; hazır GHCR imajı çekilmez. Eski yayımlanmış imaj bu değişiklikleri içermez. Yerel Docker derlemesi veya `bash start.sh` kullanın. Model sağlayıcısına erişim yine gereklidir.

`can't open file '/app/backend/server.py': [Errno 13] Permission denied` hatası için güncel Dockerfile kaynak dizinlerini 0755, dosyalarını 0644 yapar; böylece sunucudaki kısıtlı umask izinleri runtime kullanıcısını engellemez. Derleme ayrıca `lab` kullanıcısıyla backend girişini kontrol eder. Düzeltme için `git pull` ve `docker compose up --build -d` gerekir; yalnızca container'ı yeniden başlatmak eski imajı değiştirmez. Veri ve API anahtarı dosyalarının özel izinleri korunur.

Servis `restart: unless-stopped` kullanır; elle durdurulmadıkça Docker yeniden başladığında tekrar açılır. Model ayarları, özel API anahtarı dosyaları, girdiler ve raporlar `lab-data` adlı kalıcı volume’da tutulur. `docker compose down` volume’u korur; `down -v` verileri siler. Yerel Python sürümünün `data/` klasörüyle bu Docker volume’u ayrıdır; mevcut yerel kayıtlar otomatik taşınmaz.

Port ve yönetici bilgilerini değiştirmek için `.env.example` dosyasını `.env` adıyla kopyalayıp düzenleyin. Docker varsayılan 8080 portunu, yerel Python sürümü 8787 portunu kullanır. Compose yalnızca bilgisayarın loopback adresine port açar; container içinde servis `0.0.0.0:8787` dinler ve root olmayan kullanıcıyla çalışır.

Sağlayıcı başka bir container içindeyse aynı Docker ağındaki servis adını kullanın. Bilgisayarınızdaki vLLM servisine bağlanırken sağlayıcı URL’sini `http://host.docker.internal:8000/v1` şeklinde girin; container içindeki `localhost` container’ın kendisidir. Linux’ta model servisi Docker ağı tarafından erişilebilir bir arayüzde dinlemelidir. [Docker ağ dokümanı](https://docs.docker.com/desktop/features/networking/) ve [Compose restart politikası](https://docs.docker.com/reference/compose-file/services/#restart).

### Yerel Python

Node.js **24.22.1 LTS veya daha yeni bir 24.x güvenlik sürümü** ve Python 3.10+ gerekir. Proje sürümü `.nvmrc` içinde sabittir. nvm kullanıyorsanız uygulama klasöründe önce:

```bash
nvm install
nvm use
```

Ardından:

```bash
bash start.sh
```

İlk çalıştırmada pip içermeyen yerel Python ortamı ve npm bağımlılıkları hazırlanır; frontend derlenir. Python için hiçbir paket indirilmez. Ardından [http://127.0.0.1:8787](http://127.0.0.1:8787) adresini açın. Yalnızca backend'i başlatmak için mevcut Python ile `python3 backend/server.py` yeterlidir; arayüz için derlenmiş `dist/` gerekir.

`start.sh`, eski bir Node sürümü seçiliyse nvm üzerinden bu projenin kurulu sürümüne geçer; sistem genelindeki varsayılan sürümü değiştirmez. npm kurulumu ve geliştirme/derleme/test komutları eski Node sürümlerini reddeder. Docker derlemesi de `node:24.22.1-bookworm-slim` kullanır. Node yalnızca frontend geliştirme ve derleme aşamasında gereklidir; son Docker imajı Python backend ve statik arayüz dosyalarını içerir.

Bu sürüm [21 Ekim 2026 Node güvenlik yamalarını](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) içerir. Yeni Node güvenlik sürümleri geldiğinde `.nvmrc`, `package.json` engines ve Dockerfile birlikte güncellenmelidir. `npm audit` paket açıklarını tarar; Node çalışma zamanının güvenlik kontrolünün yerini tutmaz.

Giriş: **admin / admin**. Yeni kurulumda model, bağlam, kayıtlı girdi ve rapor listeleri boştur. Ölçüm için **Yönetici ayarları → Model ekle** bölümüne sağlayıcı URL’si, model kimliği ve gerekiyorsa API anahtarı girin. Yeni testler gerçek API üzerinden çalışır; demo modu kaldırılmıştır.

Desteklenen API protokolü OpenAI uyumlu Chat Completions'tır; vLLM ve aynı protokolü uygulayan sağlayıcılar bu seçenekle kullanılır. Modeli kaydettikten sonra **Bağlantıyı test et**, kayıtlı URL, model kimliği ve anahtarla en fazla bir çıktı tokenı isteyen gerçek bir istek gönderir. Sağlayıcı bu istek için ücret veya kota uygulayabilir. Kontrol bağlantı ve normal JSON yanıtını doğrular; streaming, usage, context sınırı ve performans için benchmark gerekir. API anahtarı veya sağlayıcı hata gövdesi sonuçta gösterilmez.

Geliştirme sırasında iki terminal:

```bash
.venv/bin/python backend/server.py
npm run dev
```

Vite arayüzü [http://127.0.0.1:5173](http://127.0.0.1:5173) üzerinden API çağrılarını 8787 portuna yönlendirir. Sunucu sadece loopback'e bağlanır.

## Test modları

- **Tek istek:** tek girdi seçilen bütün modellerde ölçülür.
- **Eşzamanlı yük:** 1–24 ayrı girdi, her model için aynı anda gönderilir.
- **Seri vs. eşzamanlı:** aynı girdiler önce tek tek (C1), ardından birlikte (CN) gönderilir; iki faz ayrı kaydedilir.
- Modeller varsayılan olarak sırayla ölçülür. Ayrı donanımdaki sağlayıcıları aynı anda karşılaştırmak için “Aynı anda çalışsın” seçilebilir.

Örnek: 2 model ve 4 girdi seçildiğinde **Eşzamanlı yük** her modelde 4 isteği birlikte gönderir (toplam 8 API isteği). **Sırayla → aynı anda** aynı 4 girdiyi önce tek tek, ardından birlikte gönderir (model başına 8, toplam 16 API isteği). Sonuçlarda iki faz ayrı seçilir. Model çalışma düzeni bu fazlardan bağımsızdır: “Modeller sırayla” ayarında ilk model kendi testini bitirir, sonra diğer model başlar. Paylaşılan GPU’da model testlerini paralel başlatmak ek kaynak rekabeti yaratabilir.

Eski demo modelleri ve değiştirilmemiş eski örnek bağlamlar listelerden gizlenir. Kullanıcı tarafından değiştirilmiş bağlamlar gösterilir; eski demo raporları sentetik olarak etiketlenmiş halde korunur. Gerçek API modu OpenAI uyumlu `/v1/chat/completions`, SSE, `stream_options.include_usage` destekleyen uç noktalar içindir. Native Anthropic/Gemini API gibi farklı protokoller için sonradan sağlayıcı adaptörü eklenmelidir.

## Kayıtlı girdiler

**Kayıtlı girdiler → Yeni girdi** bölümünde uzun bağlamı ve soruyu ayrı alanlarda hazırlayın. Ad, kategori ve serbest/8K/16K/32K/64K/128K hedef etiketiyle saklayabilirsiniz. `.txt` dosyaları da bağlam alanına alınır. Birleştirilmiş metin en fazla 1 milyon karakter olabilir.

32K etiketi metni otomatik büyütmez veya gerçek 32.768 token olduğunu doğrulamaz. Ekrandaki yaklaşık token sayısı karakter / 3 tahminidir; gerçek sayı model tokenizer’ına ve sağlayıcı usage yanıtına bağlıdır.

Arşivdeki **Benchmark’ta kullan** düğmesi kaydı seçilen girdi kutusuna veya tüm kutulara yükler. Her kutunun seçim menüsünde ayrıca **Kayıtlı girdiler** grubu vardır. Mevcut kutu metnini **Girdiyi kaydet** ile arşive alabilirsiniz. İki alan doluysa birleşim `bağlam + "\n\nSoru:\n" + soru` şeklindedir; yalnızca bir alan doluysa metin aynen korunur.

Kayıtlar SQLite `inputs` tablosunda saklanır; uygulama tekrar açıldığında korunur. Kütüphane listesi yalnızca küçük özetler yükler; uzun metin seçim/düzenleme sırasında alınır. Eski bağlamlar, model ayarları ve raporlar korunur.

## 32K ve 64K örnek promptlar

Önceden hazırlanmış kurgusal Türkçe hasar dosyası soruları `examples/turkce_sorular_32k.txt` ve `examples/turkce_sorular_64k.txt` içinde değiştirilmeden bulunur. Bu dosyalar Docker imajına da dahildir; internet gerekmez.

- Benchmark: her kutudaki **Örnek promptlar** grubundan tek girdiye, **Tüm girdilere örnek yükle** menüsünden bütün etkin girdilere yükleyin.
- Süreli test: **Hazır girdi → Örnek promptlar** grubundan seçin.
- Kayıtlı girdiler: **Örnek prompttan yeni girdi hazırla** ile taslak açıp inceledikten sonra kaydedin.

Örnek seçmek API isteği başlatmaz. Dosyalar ilk kurulumda kullanıcı tablolarına veya istek kutularına otomatik eklenmez. 32K / 64K etiketleri hedef uzunluk adlarıdır; tam 32.768 / 65.536 token garantisi vermez. Gerçek token sayısı modelin tokenizer’ına ve chat template’ine bağlıdır. Mevcut kurulumların model, girdi ve raporları korunur; eski demo kayıtları otomatik silinmez.

2 model × 24 istek için varsayılan “Modeller aynı anda çalışsın” ayarında toplam 48 eşzamanlı istek; 4 modelde toplam 96 eşzamanlı istek başlatılır. İşletim sistemi, ağ ve sağlayıcı kapasitesi gerçek varış ve işlenme zamanlarını etkileyebilir. “Modeller sırayla” ayarında aynı anda yalnızca bir modelin 24 isteği çalışır.

## Metrikler ve raporlar

Başarısız sağlayıcı istekleri Docker loglarında `provider_request_failed` olayı olarak görünür: `docker compose logs -f inference-lab`. Olay; koşu ve model kimliği, faz, girdi sıra numarası (süreli testte döngü), HTTP durum kodu varsa kod, hata kategorisi, aşama, geçen süre, timeout ve kısmi yanıt bilgisi içerir. `waiting_for_headers` bağlantı kurulması ve HTTP yanıt başlıklarının beklenmesini, `receiving_response` yanıt gövdesinin okunmasını kapsar. API anahtarı, URL, girdi, yanıt ve sağlayıcının ham hata gövdesi loglanmaz; sağlayıcının ayrıntılı hata mesajı için kendi loglarına bakın. Hatalar otomatik yeniden denenmez.

Toplam çıktı verimi, TTFT ortalama/p95/p99, tahmini akış hızı, uçtan uca ortalama/p95, duvar süresi, giriş/çıktı token sayısı, tahmini TPOT, p95 içerik parçası aralığı, istek/sn, draft/adım ve ortalama kabul oranı.

Token sayısı sağlayıcı usage alanından alınır. Sağlayıcı usage göndermiyorsa token tabanlı hızlar boş kalır; karakter tahmini sadece girdi hazırlığında gösterilir. Grafik, sağlayıcı sayıları geldikçe toplam çıktı / geçen süreyi gösterir. Ara usage olmayan sağlayıcılarda tamamlanma anında güncellenir; gerçek zamanlı decode token hızını temsil etmez.

Genel bakış grafiği benchmark ve kayıtlı raporlarda ortaktır. Verim veya kümülatif çıktı tokenı seçilebilir; model isimlerine tıklayarak çizgiler gizlenir/gösterilir. Grafiğe tıklayarak, üzerinde gezinerek veya süre kaydırıcısının ok/Home/End tuşlarını kullanarak kayıtlı örnekler incelenir. Eksenler koşu süresine ve değerlere, çizim alanı da gerçek panel genişliğine uyarlanır. Eksik veriler sıfır olarak çizilmez veya aradaki boşluklar birleştirilmez. Her model kendi fazının başlangıcına göre hizalanır; faz tamamlandığında son nokta rapor özetiyle eşleşir.

Draft/kabul oranı için isteğe bağlı metrics URL eklenir. Desteklenen sayaçlar: `spec_decode_num_drafts_total`, `spec_decode_num_draft_tokens_total`, `spec_decode_num_accepted_tokens_total`. [vLLM kaynak dokümanı](https://github.com/vllm-project/vllm/blob/main/docs/features/speculative_decoding/acceptance_metrics.md) bu sayaçların anlamlarını açıklar. Öncesi/sonrası farklar kullanılır; sayaçlar sunucu kapsamında olduğu için diğer trafik ve yayın gecikmesi sonucu etkileyebilir. Küçük ilk sürümde warmup, çoklu tekrar veya donanım izolasyonu doğrulaması yoktur.

Bu uygulama performans ölçer; model cevaplarının doğruluğunu otomatik değerlendirmez. İlk sürümde her fazda 1–24 örnek kullanılır; p95/p99 istatistiksel genelleme yerine koşu özeti olarak okunmalıdır.

Koşular, durdurma ve hata durumları dahil, `data/lab.sqlite3` içinde saklanır. Raporlar geçmişten açılabilir, onay verilerek silinebilir ve **Markdown / CSV / JSON** olarak dışa aktarılabilir. Devam eden koşular silinemez. PDF için tarayıcı **PDF / Yazdır** seçeneği vardır. Girdiler ve model çıktıları raporlarda saklandığından kendi veri saklama politikanıza uygun içerik kullanın.

## Yerel ayarlar

- `LAB_ADMIN_USER`, `LAB_ADMIN_PASSWORD`: varsayılan hesabı değiştirir.
- `backend/server.py --port 8787 --data-dir /tam/yol`: port/veri dizini.
- API anahtarları şifrelenmez: `data/credentials/` altındaki ayrı dosyalarda düz metin tutulur. POSIX sistemlerinde veri ve anahtar dizinleri 0700, anahtar dosyaları ve DB 0600 izinleri taşır; root veya uygulama kullanıcısı bu dosyaları okuyabilir. SQLite yalnızca rastgele dosya referansı taşır. Anahtarlar tarayıcıya ve raporlara gönderilmez.
- Eski Fernet kayıtları ve `data/credential.key` silinmez veya otomatik dönüştürülmez. Bu sürüm bunları çözmez; model düzenleme ekranında API anahtarını yeniden girip kaydedin. Boş anahtar alanı eski kaydı korur. Anahtarsız model, girdiler ve raporlar doğrudan çalışmaya devam eder.
- Yedeklerken SQLite ile birlikte tüm `data/credentials/` dizinini ve mevcutsa eski `credential.key` dosyasını koruyun. Oturumlar bellektedir; yeniden başlatınca giriş gerekir. Kesilen koşular sonraki başlangıçta “Kesintiye uğradı” olarak korunur.
- Bu yerel geliştirme sürümünü internete açmak için ayrıca üretim kimlik doğrulaması ve dağıtım yapılandırması gerekir.

## Geliştirme ve testler

```bash
npm test
npm run build
```

`AGENTS.md` ölçüm ve veri kurallarını; `TEST_CASES.md` otomatik ve manuel senaryoları açıklar. Testler geçici SQLite ve yerel sahte SSE sağlayıcısı kullanır; dış API çağrısı ve ücret yoktur.

Protokol referansı: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat). Yerel Manrope font dosyaları [Google Fonts](https://github.com/google/fonts/tree/main/ofl/manrope) kaynağından; OFL lisansı `public/fonts/OFL.txt` içindedir. `data/`, `.env`, anahtarlar, yerel raporlar ve geliştirme ekran görüntüleri Git deposuna dahil edilmez.

## Süreli test ve vLLM empty guard

**Süreli test** sayfasında tek model, 1–24 paralel döngü, süre (en fazla 1 saat), yanıt sonrası bekleme ve istek zaman aşımı seçilir. Her döngü kendi yanıtını alır, bekler ve yeniden gönderir; yavaş bir döngü diğerini bekletmez. Süre dolunca yeni istek başlatılmaz; devam eden istekler tamamlanır veya zaman aşımına uğrar. Bu yüzden gerçek bitiş zamanı belirtilen süreden uzun olabilir. 10.000 istek sınırında gönderim biter ve kayıt kısmi sonuç olarak işaretlenir. Durdur butonu açık bağlantıları da keser.

Metin/kayıtlı girdi veya doğrudan chat/completions JSON gövdesi kullanılabilir. curl heredoc (`--data-binary @- <<'JSON'`) ve inline `--data-raw` içeri aktarılır. curl çalıştırılmaz ve dosyadan veri okunmaz; komuttaki anahtarlar/başlıklar aktarılmaz. Gövde ve --max-time okunur. Model kimliği seçilen kayıtlı modelle eşleşmelidir; sağlayıcı URL’si ve anahtarı admin ayarlarından alınır. Docker’da host servisi için `host.docker.internal` adresini kullanın. `chat_template_kwargs.enable_thinking` ve `reasoning_effort` korunur; stream isteklerinde usage istenir.

Her istek için HTTP durumu, dolu cevap/boş cevap kontrolü, toplam yanıt süresi, completion_tokens / toplam süre olarak token/sn, `x-vllm-empty-guard`, attempts, version ve policy saklanır. Reasoning ayrı tutulur: reasoning gelip content boş kalırsa istek başarılı sayılmaz. HTTP/cevap başarısı ile guard pass ayrı kavramlardır. Attempts >1 tekrar olarak işaretlenir; eksik başlık ve usage bilinmeyen kalır. Sonuçlar aynı sayfanın geçmişinde saklanır; detaylar sayfalıdır, cevaplar detayı açınca yüklenir. JSON indir ile tam kayıt alınabilir. Demo sonuçları ve başlıkları sentetiktir.
