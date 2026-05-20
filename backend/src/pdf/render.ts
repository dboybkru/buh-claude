import { renderToStream } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { registerFonts } from "./fonts.js";

export async function renderPdfStream(doc: ReactElement): Promise<NodeJS.ReadableStream> {
  registerFonts();
  // @react-pdf/renderer типизирует Document как ReactElement; передаём напрямую.
  // renderToStream возвращает Node Readable.
  return renderToStream(doc as unknown as Parameters<typeof renderToStream>[0]);
}
