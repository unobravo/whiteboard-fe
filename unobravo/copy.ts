import type { UnobravoAuthErrorCode } from "./types";

const ERROR_BY_CODE: Record<UnobravoAuthErrorCode, string> = {
  "not-embedded":
    "Questa lavagna può essere aperta solo dall'applicazione Unobravo.",
  timeout: "L'applicazione non ha risposto. Riprova.",
  unauthorized: "Non hai accesso a questa lavagna.",
  internal: "Si è verificato un errore di configurazione.",
};

/**
 * Strings used by the layer's own screens.
 *
 * Kept here, rather than in upstream's locale files, so that upstream
 * translation updates never conflict with the layer.
 */
export const COPY = {
  loadingTitle: "Caricamento della lavagna…",
  errorTitle: "Non è possibile aprire la lavagna",
  errorByCode: ERROR_BY_CODE,
  retry: "Riprova",
};
