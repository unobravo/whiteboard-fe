import { useAppProps } from "./App";
import Trans from "./Trans";

const BraveMeasureTextError = () => {
  // UNOBRAVO (upstream candidate): line 3 carries the actual remediation
  // ("we strongly recommend disabling this setting"), so it stays either way —
  // only its how-to link is dropped, leaving the sentence as plain text.
  // Line 4 is nothing but "open an issue on our GitHub or write us on Discord",
  // which is meaningless without the links and points at Excalidraw's trackers
  // rather than ours, so it goes entirely.
  const externalLinksEnabled = useAppProps().externalLinksEnabled !== false;

  return (
    <div data-testid="brave-measure-text-error">
      <p>
        <Trans
          i18nKey="errors.brave_measure_text_error.line1"
          bold={(el) => <span style={{ fontWeight: 600 }}>{el}</span>}
        />
      </p>
      <p>
        <Trans
          i18nKey="errors.brave_measure_text_error.line2"
          bold={(el) => <span style={{ fontWeight: 600 }}>{el}</span>}
        />
      </p>
      <p>
        <Trans
          i18nKey="errors.brave_measure_text_error.line3"
          link={(el) =>
            externalLinksEnabled ? (
              <a href="http://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq#turning-off-aggresive-block-fingerprinting-in-brave-browser">
                {el}
              </a>
            ) : (
              <>{el}</>
            )
          }
        />
      </p>
      {externalLinksEnabled && (
        <p>
          <Trans
            i18nKey="errors.brave_measure_text_error.line4"
            issueLink={(el) => (
              <a href="https://github.com/excalidraw/excalidraw/issues/new">
                {el}
              </a>
            )}
            discordLink={(el) => <a href="https://discord.gg/UexuTaE">{el}.</a>}
          />
        </p>
      )}
    </div>
  );
};

export default BraveMeasureTextError;
