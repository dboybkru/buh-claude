import { useEffect, useState } from "react";
import { Loader2, FileDown, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { handleApiError } from "@/lib/errors";

interface Props {
  url: string;
  fallbackName: string;
  title: string;
  open: boolean;
  onClose: () => void;
}

export function PdfPreviewDialog({ url, fallbackName, title, open, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>(fallbackName);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    fetchAuthorizedBlob(url, fallbackName)
      .then(({ blob, filename }) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setFilename(filename);
      })
      .catch((err) => {
        if (!cancelled) handleApiError(err, "Не удалось сформировать PDF");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setBlobUrl(null);
    };
  }, [open, url, fallbackName]);

  async function download() {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(url, fallbackName);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать PDF");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={download}>
              <FileDown className="h-4 w-4" /> Скачать
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 bg-muted/30">
          {loading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Формирование PDF...
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              title={filename}
              className="w-full h-full border-0"
              aria-label="Превью документа"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
