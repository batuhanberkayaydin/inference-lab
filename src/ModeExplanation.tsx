import { ArrowRight, ChevronDown, CircleHelp, Layers3, Timer } from "lucide-react";
import "./mode-explanation.css";

export function ModeExplanation({ mode, count, schedule }: {
  mode: string;
  count: number;
  schedule: string;
}) {
  const compare = mode === "compare";
  const single = mode === "single";
  const visibleInputs = Math.min(count, 4);

  return (
    <details className="mode-explanation">
      <summary><CircleHelp size={15} aria-hidden="true" /> Bu test nasıl çalışır? <ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="mode-explanation-body">
        <p>
          {compare
            ? `Her model aynı ${count} girdiyi iki fazda alır. İlk fazda bir istek sonuçlanınca sıradaki başlar. İkinci fazda girdiler birlikte gönderilir. Sonuçlarda iki fazı ayrı ayrı inceleyebilirsin.`
            : single
              ? "Seçtiğin her model aynı girdiyi bir kez alır. İlk token ve cevabın tamamlanma sürelerini karşılaştırabilirsin."
              : `Her modelin ${count} girdisi, önceki yanıtlar beklenmeden birlikte gönderilir. Bu mod, modelin yük altındaki hızını ve yanıt sürelerini ölçer.`}
        </p>
        <div className="mode-sequence">
          {(single || compare) && (
            <div className="sequence-lane">
              <span><Timer size={15} aria-hidden="true" /> {single ? "Tek istek" : "İlk faz · sırayla"}</span>
              <div className="sequence-items">
                {Array.from({ length: single ? 1 : visibleInputs }, (_, index) => (
                  <span className="sequence-pair" key={index}>
                    <span className="sequence-request">Girdi {index + 1}</span>
                    {compare && index < visibleInputs - 1 && <><small>yanıt bitsin</small><ArrowRight size={13} aria-hidden="true" /></>}
                  </span>
                ))}
                {compare && count > visibleInputs && <small>+${count - visibleInputs} girdi</small>}
              </div>
            </div>
          )}
          {!single && (
            <div className="sequence-lane">
              <span><Layers3 size={15} aria-hidden="true" /> {compare ? "İkinci faz · birlikte" : "Birlikte gönderim"}</span>
              <div className="sequence-items concurrent">
                {Array.from({ length: visibleInputs }, (_, index) => (
                  <span className="sequence-request" key={index}>Girdi {index + 1}</span>
                ))}
                {count > visibleInputs && <small>+${count - visibleInputs} girdi</small>}
              </div>
            </div>
          )}
        </div>
        <div className="model-schedule-explanation">
          <b>Modellerin çalışma sırası</b>
          <p>
            {schedule === "parallel"
              ? "Seçilen modellerin testleri her fazda birlikte başlar. Aynı GPU’yu paylaşan modeller birbirini yavaşlatabilir."
              : "Bir modelin o fazdaki testi bitince diğer model başlar. Her modelin kendi girdileri, seçilen test türüne göre gönderilir."}
            {compare && " İlk faz tüm modellerde tamamlanınca ikinci faz başlar."}
          </p>
        </div>
      </div>
    </details>
  );
}
