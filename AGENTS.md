# Inference Lab geliştirme talimatları

## Kapsam ve başlangıç

- Bu klasör bağımsız bir yerel benchmark uygulamasıdır. Üst dizindeki deneyleri ve mevcut sonuçları değiştirme.
- Önce `PRODUCT.md`, `DESIGN.md` ve ilgili kaynakları oku. Arayüz dili Türkçe.
- Arayüz: React + TypeScript + Vite; backend: Python HTTP server, SQLite, cryptography.
- RTK kurulu ortamlarda shell komutlarını `rtk` ile çalıştır; RTK bulunmayan ortamlarda standart komutları kullan.
- Node sürümü `.nvmrc` ile seçilir: en az 24.22.1, desteklenen hat 24.x. npm komutlarından önce `nvm use` uygula; eski sistem Node sürümüyle güvenlik kontrollerini devre dışı bırakma. Node güvenlik güncellemelerinde `.nvmrc`, package engines ve Docker derleme sürümünü birlikte değiştir.
- Kullanıcının açık yetkisi olmadan gerçek sağlayıcılara benchmark gönderme. Testlerde yalnızca demo veya yerel sahte SSE sunucusu kullan.

## Değişmez ölçüm kuralları

- En fazla 8 dolu girdi ve 4 farklı model. Karşılaştırılan modeller aynı girdi ve generation ayarlarını almalı.
- Toplam verim = başarılı çıktı tokenları / model fazının duvar süresi; istek başına hızların toplamı değildir.
- Token sayısı sağlayıcı `usage` alanından gelir. SSE parçaları token değildir. Eksik usage için token sayısı veya hız üretme.
- TTFT ilk content/reasoning parçasına kadar geçen süredir. Akış hızı/TPOT tahmin etiketi taşımalıdır.
- Draft/kabul metriklerini Prometheus koşu öncesi/sonrası sayaç farkından al. Sayaç sıfırlanırsa veya yoksa değer `null` kalmalı. Sunucu kapsamı uyarısını koru.
- Başarısız, durdurulan ve yarım kalan koşuları sakla. Başarısız istekleri başarı gibi gösterme.
- Demo sonuçları tüm ekran ve dışa aktarımlarda açıkça sentetik olmalıdır. Gerçek deney sonuçlarıyla karıştırma.

## Veri ve güvenlik

- API anahtarları yalnızca backend tarafından kullanılmalı; UI'ya, loglara, raporlara veya repoya yazılmamalı.
- `data/credential.key` ve SQLite dosyası kullanıcıya özeldir; `data/` Git dışında kalır.
- Anahtar alanı düzenlemede boş bırakılırsa mevcut anahtar korunur. Kaldırma ayrı ve açık bir tercihtir.
- Raporlar model ayarlarının ve girdilerin koşu anındaki kopyasını taşır; daha sonra model düzenlemek eski raporu değiştirmemeli.
- Kayıtlı girdiler `inputs` tablosunda bağlam ve soru olarak saklanır. Hedef 32K gibi bir etikettir; metni otomatik uzatma veya bu etiketi gerçek token sayısı diye gösterme.
- Girdi listesi uzun içerikleri taşımaz; detay yalnızca seçme/düzenlemede yüklenir. Kayıttan yükleme isteği otomatik çalıştırmaz ve diğer kutuları değiştirip değiştirmeyeceği açık olmalıdır.
- Varsayılan admin/admin sadece bu yerel geliştirme sürümü içindir. Sunucu 127.0.0.1'e bağlanır.
- Docker içinde `--host 0.0.0.0` kullanılır; Compose varsayılan olarak sadece `127.0.0.1:8080` portunu yayımlar. `restart: unless-stopped` ve `lab-data` kalıcı volume korunmalıdır. Yerel `data/` klasörünü veya anahtarları Docker build context'ine alma.
- Grafik eksik token bilgisini sıfır saymamalı, bilinmeyen aralıkları birleştirmemeli ve son ölçümü rapor özetindeki duvar süresi/değerle eşleştirmelidir. Model fazları kendi başlangıcına göre hizalanır; anlık decode hızı diye sunulmaz.

## Doğrulama ve genişletme

- Python bağımlılıkları: `.venv/bin/python -m pip install -r backend/requirements.txt`.
- Temel regresyonlar: `rtk npm test`; frontend derleme: `rtk npm run build`.
- Testler gerçek sağlayıcıya çağrı yapmaz. Yeni veri kümeleri ve sağlayıcı uyarlayıcıları için `tests/` ve `TEST_CASES.md` genişletilmeli.
- UI akışını masaüstü ve mobilde doğrula; rapor geçmişi, eksik veri, hata ve durdurma durumlarını koru.
- Şimdilik warmup, çoklu tekrar, GPU/KV-cache ölçümleri ve gerçek tokenizer entegrasyonu yok. Bunları eklerken rapor şemasını sürümle ve eski raporların okunmasını koru.

## Süreli test kuralları
- `duration_runs` ayrı kayıt tablosudur; benchmark raporlarıyla karıştırma. Her paralel döngü kendi yanıtından sonra bekler; süre dolunca gönderimi kes, aktif isteğin sonucunu koru.
- Guard başlığı yoksa bilinmiyor; attempts yoksa sıfır/tek deneme üretme. `pass` ve HTTP/cevap başarısını ayrı raporla. Reasoning tek başına dolu kullanıcı cevabı değildir.
- JSON/curl hiçbir şekilde shell ile çalıştırılmaz; API anahtarları yalnızca kayıtlı sağlayıcı ayarından gelir. Özel gövde alanlarını ve chat_template_kwargs değerlerini testlerde koru.
- Kullanıcı servisleri kapattıysa QA için geçici port/veri dizini kullan; bitişte test sunucusunu kapat ve durmuş Compose servisini yeniden açma.
