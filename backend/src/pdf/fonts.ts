import { Font } from "@react-pdf/renderer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(here, "fonts");

let registered = false;
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: "PTSans",
    fonts: [
      { src: path.join(FONTS_DIR, "PTSans-Regular.ttf") },
      { src: path.join(FONTS_DIR, "PTSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Отключаем перенос строк по дефис-правилу — react-pdf плохо переносит длинные русские слова
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
