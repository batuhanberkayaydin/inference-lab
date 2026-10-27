import { ArrowRight, Check, Layers3, Timer } from "lucide-react";
import "./mode-explanation.css";

export function ModeExplanation({
  mode,
  count,
  models,
  schedule,
}: {
  mode: string;
  count: number;
  models: number;
  schedule: string;
}) {
  const concurrent = mode === "concurrent",
    compare = mode === "compare";
  const inputs = mode === "single" ? 1 : count;
  return (
    <div className="mode-explanation">
      <div className="mode-explanation-heading">
        <h3>
          {compare
            ? "Yük artınca performans nasıl değişiyor?"
            : concurrent
              ? "Bir model, aynı anda birden fazla isteği nasıl karşılıyor?"
              : "Bir isteğin yanıt süresini ölç"}
        </h3>
        <span>
          {models} model · {inputs} girdi{compare ? " · 2 faz" : ""}
        </span>
      </div>
      <p>
        {compare
          ? `Aynı ${inputs} girdiyi her modelde iki kez çalıştırırız. Önce girdiler sırayla gönderilir; bir yanıt bitmeden diğeri başlamaz. Sonra aynı girdilerin tamamı birlikte gönderilir. Böylece eşzamanlı yükün hız ve bekleme süresi üzerindeki etkisini görürsün.`
          : concurrent
            ? `${inputs} girdi, her modelin kendi testinde aynı anda gönderilir. Örneğin 4 girdi seçersen model aynı anda 4 yanıt üretmeye çalışır; bir isteğin bitmesi beklenmez. Bu mod, servisinin birden fazla kullanıcıya aynı anda cevap verme kapasitesini ölçer.`
            : "Tek bir girdi seçtiğin modellerde aynı ayarlarla gönderilir. İlk yanıtın ne kadar sürede geldiğini ve cevabın ne kadar sürede tamamlandığını karşılaştırırsın."}
      </p>
      <div className="mode-sequence">
        {!concurrent && (
          <div className="sequence-lane">
            <span>
              <Timer size={14} />
              {compare ? "İlk faz · sırayla" : "Tek istek"}
            </span>
            <div className="sequence-items">
              {Array.from(
                { length: compare ? Math.min(inputs, 4) : 1 },
                (_, i) => (
                  <span className="sequence-pair" key={i}>
                    <span className="sequence-request">
                      Girdi {String(i + 1).padStart(2, "0")}
                    </span>
                    {i < Math.min(inputs, 4) - 1 && compare && (
                      <>
                        <small>yanıt bitsin</small>
                        <ArrowRight size={12} />
                      </>
                    )}
                  </span>
                ),
              )}
              {compare && inputs > 4 && <small>… {inputs} girdi</small>}
            </div>
          </div>
        )}
        {(concurrent || compare) && (
          <div className="sequence-lane">
            <span>
              <Layers3 size={14} />
              {compare ? "İkinci faz · aynı anda" : "Aynı anda gönderim"}
            </span>
            <div className="sequence-items concurrent">
              {Array.from({ length: Math.min(inputs, 8) }, (_, i) => (
                <span className="sequence-request" key={i}>
                  Girdi {String(i + 1).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mode-takeaways">
        <span>
          <Check size={13} />
          {compare
            ? `${models * inputs * 2} toplam API isteği; iki faz ayrı raporlanır.`
            : `${models * inputs} toplam API isteği; tüm modeller aynı girdileri alır.`}
        </span>
        <span>
          <Check size={13} />
          {compare
            ? "Sonuçlarda “Sırayla” ve “Aynı anda” fazlarını değiştirerek karşılaştır."
            : "İlk token süresi, toplam verim ve tamamlanma süresini birlikte değerlendir."}
        </span>
      </div>
      <div className="model-schedule-explanation">
        <b>Modellerin çalışma sırası farklı bir ayardır.</b>
        <p>
          {schedule === "parallel"
            ? "“Modeller aynı anda” seçili: her fazda seçtiğin modellerin testleri birlikte başlar. Ayrı sunucu/GPU kullanan modeller için uygundur. Aynı GPU’yu paylaşan modeller birbirini yavaşlatabilir."
            : "“Modeller sırayla” seçili: ilk modelin o fazdaki testi biter, sonra diğer model başlar. Bu, girdilerin eşzamanlı gönderilmesine engel değildir. Aynı GPU’yu paylaşan servisleri karşılaştırırken birbirine ek yük bindirmemeye yardımcı olur."}
          {compare &&
            " Önce tüm modellerin sırayla gönderim fazı tamamlanır, ardından tüm modellerin aynı anda gönderim fazına geçilir."}
        </p>
      </div>
    </div>
  );
}
