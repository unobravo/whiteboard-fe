import type { UnobravoAuthErrorCode } from "./types";

/**
 * Strings used by the layer's own screens.
 *
 * Kept here rather than in upstream's locale files, so that upstream
 * translation updates never conflict with the layer. Only the two languages
 * the product ships are covered; anything else falls back to English.
 */
type Copy = {
  loadingTitle: string;
  errorTitle: string;
  errorByCode: Record<UnobravoAuthErrorCode, string>;
  retry: string;
};

const EN: Copy = {
  loadingTitle: "Loading the whiteboard…",
  errorTitle: "This whiteboard can't be opened",
  errorByCode: {
    "not-embedded": "This whiteboard can only be opened from the Unobravo app.",
    timeout: "The app didn't respond. Please try again.",
    unauthorized: "You don't have access to this whiteboard.",
    internal: "Something went wrong while opening this whiteboard.",
  },
  retry: "Try again",
};

const IT: Copy = {
  loadingTitle: "Caricamento della lavagna…",
  errorTitle: "Non è possibile aprire la lavagna",
  errorByCode: {
    "not-embedded":
      "Questa lavagna può essere aperta solo dall'applicazione Unobravo.",
    timeout: "L'applicazione non ha risposto. Riprova.",
    unauthorized: "Non hai accesso a questa lavagna.",
    internal: "Si è verificato un errore durante l'apertura della lavagna.",
  },
  retry: "Riprova",
};

/**
 * Resolved from the browser, since the editor's own `langCode` lives inside the
 * editor — which is precisely what these screens render *instead of*.
 */
export const getCopy = (language: string = window.navigator.language): Copy =>
  language.toLowerCase().startsWith("it") ? IT : EN;

export const COPY_BY_LANGUAGE = { en: EN, it: IT };
