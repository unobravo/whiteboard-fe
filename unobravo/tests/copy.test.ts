import { COPY_BY_LANGUAGE, getCopy } from "../copy";

import type { UnobravoAuthErrorCode } from "../types";

const CODES: UnobravoAuthErrorCode[] = [
  "not-embedded",
  "timeout",
  "unauthorized",
  "internal",
];

describe("getCopy", () => {
  it("uses Italian for Italian locales", () => {
    expect(getCopy("it").retry).toBe(COPY_BY_LANGUAGE.it.retry);
    expect(getCopy("it-IT").retry).toBe(COPY_BY_LANGUAGE.it.retry);
    expect(getCopy("IT-it").retry).toBe(COPY_BY_LANGUAGE.it.retry);
  });

  it("falls back to English for anything else", () => {
    expect(getCopy("en-GB").retry).toBe(COPY_BY_LANGUAGE.en.retry);
    expect(getCopy("fr").retry).toBe(COPY_BY_LANGUAGE.en.retry);
    expect(getCopy("").retry).toBe(COPY_BY_LANGUAGE.en.retry);
  });

  it("covers every error code in both languages", () => {
    for (const copy of Object.values(COPY_BY_LANGUAGE)) {
      for (const code of CODES) {
        expect(copy.errorByCode[code]).toBeTruthy();
      }
    }
  });
});
