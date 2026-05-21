import { useEffect, useState } from "react";
import { Loader2, FileDown, X, RefreshCw, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { handleApiError } from "@/lib/errors";
import { PrintWarnings } from "@/components/PrintWarnings";

interface Props {
  /** Endpoint, который возвращает HTML preview (text/html). */
  previewUrl: string;
  /** Endpoint PDF — для кнопки «Скачать PDF» внутри preview. */
  pdfUrl: string;
  /** Опциональный endpoint warnings — если задан, показывается блок над preview. */
  warningsUrl?: string;
  organizationId?: string | null;
  documentRoute?: string | null;
  fallbackName: string;
  title: string;
  open: boolean;
  onClose: () => void;
}

async function fetchHtml(url: string): Promise<{ blob: Blob }> {
  const { blob } = await fetchAuthorizedBlob(url, "preview.html");
  return { blob };
}

export function HtmlPreviewDialog({
  previewUrl,
  pdfUrl,
  warningsUrl,
  organizationId,
  documentRoute,
  fallbackName,
  title,
  open,
  onClose,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetchHtml(previewUrl)
      .then(({ blob }) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        handleApiError(err, "Не удалось сформировать предпросмотр");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setBlobUrl(null);
    };
  }, [open, previewUrl, reloadKey]);

  async function downloadPdf() {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(pdfUrl, fallbackName);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать PDF");
    }
  }

  function openInNewTab() {
    if (blobUrl) window.open(blobUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Обновить preview">
              <RefreshCw className="h-4 w-4" /> Обновить
            </Button>
            <Button variant="outline" size="sm" onClick={openInNewTab} disabled={!blobUrl} aria-label="Открыть в новой вкладке">
              <ExternalLink className="h-4 w-4" /> В новой вкладке
            </Button>
            <Button variant="outline" size="sm" onClick={downloadPdf}>
              <FileDown className="h-4 w-4" /> Скачать PDF
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {warningsUrl ? (
          <div className="px-4 pt-3">
            <PrintWarnings url={warningsUrl} organizationId={organizationId} documentRoute={documentRoute} />
          </div>
        ) : null}

        {/* Тёмный фон вокруг «листа» — preview всегда на белом, чтобы соответствовать
            печатному выводу даже в тёмной теме. A4-пропорции: 210 × 297 мм. */}
        <div className="flex-1 bg-muted/40 dark:bg-muted/20 overflow-auto p-4 flex justify-center">
          {loading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Формирование предпросмотра...
            </div>
          ) : error ? (
            <div className="text-destructive">Ошибка: {error}</div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              title={title}
              className="bg-white shadow-md border-0 w-full max-w-[210mm]"
              style={{ aspectRatio: "210 / 297", height: "100%", minHeight: "70vh" }}
              aria-label="Предпросмотр документа"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
