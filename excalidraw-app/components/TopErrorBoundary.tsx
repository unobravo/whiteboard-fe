import Trans from "@excalidraw/excalidraw/components/Trans";
import { t } from "@excalidraw/excalidraw/i18n";
import * as Sentry from "@sentry/browser";
import React from "react";

// UNOBRAVO: this boundary is mounted outside <Excalidraw>, so there is no
// AppPropsContext to read, and it is a class component, so no hook either —
// the frozen module-scope value is the accessor here.
import { FEATURES } from "../../unobravo";

import { isErrorReportingEnabled } from "../sentry";

interface TopErrorBoundaryState {
  hasError: boolean;
  sentryEventId: string;
  errorMessage: string;
  errorName: string;
  localStorage: string;
}

// UNOBRAVO: gives devs full context on the crash screen itself, not just the
// original exception — whether it was seen and whether the user recovered.
type ErrorSplashLogContext = {
  originalEventId: string;
  errorMessage: string;
  errorName: string;
  url: string;
  timestamp: string;
  userAgent: string;
  viewport: string;
};

export class TopErrorBoundary extends React.Component<
  any,
  TopErrorBoundaryState
> {
  state: TopErrorBoundaryState = {
    hasError: false,
    sentryEventId: "",
    errorMessage: "",
    errorName: "",
    localStorage: "",
  };

  render() {
    return this.state.hasError ? this.errorSplash() : this.props.children;
  }

  componentDidCatch(error: Error, errorInfo: any) {
    const _localStorage: any = {};
    for (const [key, value] of Object.entries({ ...localStorage })) {
      try {
        _localStorage[key] = JSON.parse(value);
      } catch (error: any) {
        _localStorage[key] = value;
      }
    }

    Sentry.withScope((scope) => {
      scope.setExtras(errorInfo);
      const eventId = Sentry.captureException(error);

      Sentry.captureMessage("ErrorSplash displayed", {
        level: "info",
        tags: { errorSplashEvent: "view" },
        extra: this.buildLogContext(eventId, error.message, error.name),
      });

      this.setState((state) => ({
        hasError: true,
        sentryEventId: eventId,
        errorMessage: error.message,
        errorName: error.name,
        localStorage: JSON.stringify(_localStorage),
      }));
    });
  }

  private buildLogContext(
    eventId: string,
    errorMessage: string,
    errorName: string,
  ): ErrorSplashLogContext {
    return {
      originalEventId: eventId,
      errorMessage,
      errorName,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    };
  }

  // UNOBRAVO: logs the click and flushes before window.location.reload()
  // tears the page down, otherwise the outbound request can be dropped.
  private handleReloadClick = async () => {
    Sentry.captureMessage("ErrorSplash refresh clicked", {
      level: "info",
      tags: { errorSplashEvent: "click" },
      extra: this.buildLogContext(
        this.state.sentryEventId,
        this.state.errorMessage,
        this.state.errorName,
      ),
    });

    await Sentry.flush(1000).catch(() => {});
    window.location.reload();
  };

  private selectTextArea(event: React.MouseEvent<HTMLTextAreaElement>) {
    if (event.target !== document.activeElement) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).select();
    }
  }

  private async createGithubIssue() {
    let body = "";
    try {
      const templateStrFn = (
        await import(
          /* webpackChunkName: "bug-issue-template" */ "../bug-issue-template"
        )
      ).default;
      body = encodeURIComponent(templateStrFn(this.state.sentryEventId));
    } catch (error: any) {
      console.error(error);
    }

    window.open(
      `https://github.com/excalidraw/excalidraw/issues/new?body=${body}`,
      "_blank",
      "noopener noreferrer",
    );
  }

  private errorSplash() {
    return (
      <div className="ErrorSplash excalidraw">
        <div className="ErrorSplash-messageContainer">
          <div className="ErrorSplash-paragraph bigger align-center">
            <Trans
              i18nKey="errorSplash.headingMain"
              button={(el) => (
                <button onClick={() => this.handleReloadClick()}>{el}</button>
              )}
            />
          </div>
          <div className="ErrorSplash-paragraph align-center">
            <Trans
              i18nKey="errorSplash.clearCanvasMessage"
              button={(el) => (
                <button
                  onClick={() => {
                    try {
                      localStorage.clear();
                      window.location.reload();
                    } catch (error: any) {
                      console.error(error);
                    }
                  }}
                >
                  {el}
                </button>
              )}
            />
            <br />
            <div className="smaller">
              <span role="img" aria-label="warning">
                ⚠️
              </span>
              {t("errorSplash.clearCanvasCaveat")}
              <span role="img" aria-hidden="true">
                ⚠️
              </span>
            </div>
          </div>
          <div>
            {/* UNOBRAVO: with no DSN nothing is transmitted, but
            captureException still hands back an event id — telling the user
            their crash was "tracked", and giving them an id that identifies
            nothing, would be a lie */}
            {isErrorReportingEnabled && (
              <div className="ErrorSplash-paragraph">
                {t("errorSplash.trackedToSentry", {
                  eventId: this.state.sentryEventId,
                })}
              </div>
            )}
            {/* UNOBRAVO: the button's only action is opening a prefilled issue
            on github.com/excalidraw, with the user's scene in the body */}
            {FEATURES.socials && (
              <div className="ErrorSplash-paragraph">
                <Trans
                  i18nKey="errorSplash.openIssueMessage"
                  button={(el) => (
                    <button onClick={() => this.createGithubIssue()}>
                      {el}
                    </button>
                  )}
                />
              </div>
            )}
            <div className="ErrorSplash-paragraph">
              <div className="ErrorSplash-details">
                <label>{t("errorSplash.sceneContent")}</label>
                <textarea
                  rows={5}
                  onPointerDown={this.selectTextArea}
                  readOnly={true}
                  value={this.state.localStorage}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
