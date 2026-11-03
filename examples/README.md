# İsteğe bağlı Türkçe prompt örnekleri

- `turkce_sorular_32k.txt`: 32K hedef etiketi, 83.112 karakter.
- `turkce_sorular_64k.txt`: 64K hedef etiketi, 165.847 karakter.

Dosyalar üst çalışma alanındaki `turkce_context_sorulari/` örneklerinin değiştirilmemiş kopyalarıdır. Kişi ve olaylar kurgusaldır. İçlerindeki kurallar yalnızca bu benchmark örneğine aittir.

32K / 64K dosya adları ve hedef etiketleri, her model için tam 32.768 / 65.536 token garantisi vermez. Gerçek uzunluk seçilen modelin tokenizer’ına ve chat template’ine bağlıdır.

Yeni kurulum bu örnekleri kullanıcı tablolarına kaydetmez veya istek kutularına yerleştirmez. Benchmark ve Süreli test menülerinden açıkça seçerek yükleyebilirsiniz. Kayıtlı girdiler sayfasında örnekten taslak açıp inceleyerek arşive kaydedebilirsiniz. Dosyalar Docker imajına dahil edilir; dış internet bağlantısı gerektirmez.
