# İlk sürüm test senaryoları

Çalıştırma: `rtk npm test`. Geçici veritabanı ve yerel sahte SSE sunucusu kullanılır; gerçek sağlayıcıya istek gönderilmez.

| Senaryo | Beklenen sonuç |
|---|---|
| p95 hesabı / boş veri / tek örnek | Doğrusal interpolasyon; veri yoksa null |
| Verim ve başarısız istek | Başarılı çıktı tokenları / fazın duvar süresi |
| Usage yok | Gecikmeler var; token/hız alanları null |
| Draft sayaç farkı | Önce/sonra farkı; sıfırlanırsa null |
| URL normalizasyonu | /v1 ile/olmadan aynı chat/completions yolu |
| Gerçek SSE fixture | Rol parçası TTFT sayılmaz; iki parça 10 token kullanımını korur |
| Seri vs. concurrent | İki faz birebir aynı payload; concurrent faz paralel çalışır |
| Eksik DONE | Başarısız istek ve kısmi rapor |
| Sessiz/uzun bekleyen stream | Mutlak timeout akışı keser |
| Durdurma | Kısmi çıktı ve durduruldu raporu saklanır |
| Limitler / çift model / aktif koşu | 8 girdi, 4 model ve tek aktif koşu sınırları |
| 4 model × 8 istek | 32 başarılı ölçüm |
| Giriş / kötü şifre / kötü Origin | 401/403; yetkisiz veri erişimi yok |
| Markdown / CSV / JSON | Doğru koşu dışa aktarılır; API anahtarı yok |
| Anahtar düzenleme / yeniden açma | Şifreli veri korunur, boş giriş anahtarı silmez |

## Manuel arayüz kontrolü

- Admin/admin ile giriş; hatalı şifre mesajı.
- 1–4 model seçimi; 1–8 girdi; ayrı bağlam seçimi ve metin düzenleme.
- Tek istek, eşzamanlı, seri vs. eşzamanlı modları.
- Demo işaretinin sonuç ve rapor geçmişinde korunması.
- Tüm metriğin görünmesi, referans model farkları ve istek çıktıları.
- Koşunun otomatik kaydı, geçmişten açılması, arama/filtre ve dışa aktarım.
- Model ekleme/düzenleme; anahtarın geri gönderilmemesi.
- Bağlam ekleme/düzenleme; .txt içe aktarım; testte kullan.
- Masaüstü 1440 px, mobil 390 px; yatay sayfa taşması yok, geniş tablolar kendi içinde kayar.
- Klavyeyle gezinme, görünen focus, boş/hata/durdurulmuş durumlar.

## Kayıtlı girdi regresyonları

- Uzun Türkçe bağlam, satır sonları ve soru birleşimi kayıpsız korunur.
- Liste uç noktası uzun metni taşımaz; içerik detaydan yüklenir.
- Tek başına bağlam veya soru ek başlık olmadan saklanır.
- Düzenleme aynı kimlik ve oluşturulma tarihini korur; yeniden açınca kayıtlar vardır.
- Boş, geçersiz hedefli ve 1 milyon karakteri aşan girdiler reddedilir.
- Mevcut veritabanına yeni tablo eklenirken hazır bağlamlar değişmez.
- HTTP giriş gereksinimi; kaydetme, seçme, düzenleme ve silme akışı.
- Manuel: .txt içe al → 32K etiketiyle kaydet → Girdi 03’e yükle → diğer kutuların değişmediğini doğrula → seçim menüsünden Girdi 01’e yükle → kutu metnini arşive kaydet.

## Grafik ve Docker kontrolleri

- `node --test tests/chart.test.mjs`: kısa/uzun koşulara uygun eksen; eksik veri ile ölçülmüş sıfır ayrımı; kopuk veri aralıkları; tekrar eden ve sırasız örnekler; son noktanın rapor özetiyle eşleşmesi; klavye/süre inceleme için önceki gerçek örneğin bulunması.
- Docker: `docker compose config --quiet`, imaj derleme, `up -d --wait`, healthcheck, root olmayan kullanıcı, `unless-stopped` politikası ve durdurup yeniden açınca kayıtların/şifreli anahtarların korunması.
- UI: genel bakışta metrik seçimi, model görünürlüğü, süre inceleme; iki karşılaştırma fazının ayrı seçimi; masaüstü ve mobilde okunur eksenler ve taşmasız mod açıklamaları.

## Sonraki genişletmeler

Gerçek sağlayıcı sözleşme testleri, farklı SSE/protokol adaptörleri, tokenizer, warmup ve tekrarlı koşular, dataset sürümleme, yanıt doğruluğu, GPU/KV-cache/preemption ölçümleri ve rapor şema migrasyonu.

- Streaming snapshots expose partial answer text while an input is still running, then retain the complete answer.
- Normal JSON responses and JSON fallback from a streaming request preserve text/usage; TTFT and stream speed remain unknown.
- UI: overview and Cevaplar group answers by input; phases switch answers; desktop/mobile layout and copy controls work.

## Süreli test
- JSON/curl heredoc ve inline data yalnızca veri olarak okunur; response örneği ve authorization başlığı içeri aktarılmaz, dosya/shell komutu çalıştırılmaz.
- Her bağımsız döngü kendi yanıtından sonra bekler; yavaş istek diğer döngüyü engellemez. En fazla 8 aktif istek, süre bitiminde yeni gönderim yok; aktif istek sonuçlanır.
- HTTP 200, guard pass, attempts=1 veya >1, başlık/usage eksikliği ayrı korunur. Eksik usage hız üretmez; reasoning-only cevap başarısızdır.
- JSON normal cevap, kesik SSE, HTTP 500, durdurma, süreç yeniden başlatma, sayfalama, kimlik doğrulama ve JSON dışa aktarımı yerel fixture ile doğrulanır.
