export type TextDirection = 'ltr' | 'rtl';

// Persian-primary direction detection: any strong RTL character makes the
// surrounding prose RTL. This is intentionally not a majority vote because
// identifiers and file paths can otherwise overpower a Persian sentence.
const RTL_CHARACTER_PATTERN = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export const getTextDirection = (value: unknown): TextDirection => (
  RTL_CHARACTER_PATTERN.test(String(value ?? '')) ? 'rtl' : 'ltr'
);
