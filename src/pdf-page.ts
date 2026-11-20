/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(file: File) {
  if (!file.size || file.size > 30_000_000) throw new Error("PDF en fazla 30 MB olabilir.");
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
  const task = getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: assets + "cmaps/",
    cMapPacked: true,
    iccUrl: assets + "iccs/",
    standardFontDataUrl: assets + "standard_fonts/",
    wasmUrl: assets + "wasm/",
  });
  try {
    const pdf = await task.promise;
    return {
      pages: pdf.numPages,
      name: file.name,
      close: () => task.destroy(),
      async render(number: number, longestEdge: number) {
        const page = await pdf.getPage(number);
        const dimensions = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: longestEdge / Math.max(dimensions.width, dimensions.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        try {
          await page.render({ canvas, viewport, background: "#fff" }).promise;
          const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
          if (!png) throw new Error("PDF sayfası görsele dönüştürülemedi.");
          return new File([png], `${file.name.replace(/\.pdf$/i, "")} · Sayfa ${number}.png`, { type: "image/png" });
        } finally {
          page.cleanup();
          canvas.width = canvas.height = 0;
        }
      },
    };
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err instanceof Error && err.name === "PasswordException")
      throw new Error("Parola korumalı PDF’yi önce açıp korumasız bir kopyasını yükleyin.");
    throw new Error("PDF okunamadı. Dosyanın açılabildiğini kontrol edin.");
  }
}
