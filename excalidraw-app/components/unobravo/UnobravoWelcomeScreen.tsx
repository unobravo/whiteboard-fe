import { loginIcon } from "@excalidraw/excalidraw/components/icons";
import { POINTER_EVENTS } from "@excalidraw/common";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { WelcomeScreen } from "@excalidraw/excalidraw/index";
import React from "react";

import { isExcalidrawPlusSignedUser } from "../../app_constants";
import { FEATURES } from "../../../unobravo";

/**
 * Overlay of `excalidraw-app/components/AppWelcomeScreen.tsx` — see
 * `UnobravoMainMenu` for why the overlay pattern is used and how drift is
 * caught. With every flag on this renders exactly what upstream renders.
 */
export const UnobravoWelcomeScreen: React.FC<{
  onCollabDialogOpen: () => any;
  isCollabEnabled: boolean;
}> = React.memo((props) => {
  const { t } = useI18n();

  let headingContent;

  if (FEATURES.plus && isExcalidrawPlusSignedUser) {
    headingContent = t("welcomeScreen.app.center_heading_plus")
      .split(/(Excalidraw\+)/)
      .map((bit, idx) => {
        if (bit === "Excalidraw+") {
          return (
            <a
              style={{ pointerEvents: POINTER_EVENTS.inheritFromUI }}
              href={`${
                import.meta.env.VITE_APP_PLUS_APP
              }?utm_source=excalidraw&utm_medium=app&utm_content=welcomeScreenSignedInUser`}
              key={idx}
            >
              Excalidraw+
            </a>
          );
        }
        return bit;
      });
  } else {
    headingContent = (
      <>
        {t("welcomeScreen.app.center_heading")}
        <br />
        {t("welcomeScreen.app.center_heading_line2")}
        <br />
        {t("welcomeScreen.app.center_heading_line3")}
      </>
    );
  }

  // Every centre entry is flag-driven, so all of them off would leave two empty
  // divs behind: `.welcome-screen-center` draws nothing, but an empty
  // `.welcome-screen-menu` is still a flex item and eats 2rem of the column's
  // gap. Derive what is left and render only that.
  const showCollab = props.isCollabEnabled && FEATURES.collaboration;
  const showSignUp = FEATURES.plus && !isExcalidrawPlusSignedUser;
  const showMenu =
    FEATURES.loadScene || FEATURES.welcomeHelp || showCollab || showSignUp;
  const showCenter = FEATURES.welcomeLogo || showMenu;

  return (
    <WelcomeScreen>
      <WelcomeScreen.Hints.MenuHint>
        {t("welcomeScreen.app.menuHint")}
      </WelcomeScreen.Hints.MenuHint>
      <WelcomeScreen.Hints.ToolbarHint />
      <WelcomeScreen.Hints.HelpHint />
      {showCenter && (
        <WelcomeScreen.Center>
          {/* keep these as separate JSX children: `Center` falls back to
              upstream's default column when `children` is a single falsy value,
              and an array of `false`s is truthy */}
          {FEATURES.welcomeLogo && <WelcomeScreen.Center.Logo />}
          {FEATURES.welcomeLogo && (
            <WelcomeScreen.Center.Heading>
              {headingContent}
            </WelcomeScreen.Center.Heading>
          )}
          {showMenu && (
            <WelcomeScreen.Center.Menu>
              {FEATURES.loadScene && <WelcomeScreen.Center.MenuItemLoadScene />}
              {FEATURES.welcomeHelp && <WelcomeScreen.Center.MenuItemHelp />}
              {showCollab && (
                <WelcomeScreen.Center.MenuItemLiveCollaborationTrigger
                  onSelect={() => props.onCollabDialogOpen()}
                />
              )}
              {showSignUp && (
                <WelcomeScreen.Center.MenuItemLink
                  href={`${
                    import.meta.env.VITE_APP_PLUS_LP
                  }/plus?utm_source=excalidraw&utm_medium=app&utm_content=welcomeScreenGuest`}
                  shortcut={null}
                  icon={loginIcon}
                >
                  {t("labels.signUp")}
                </WelcomeScreen.Center.MenuItemLink>
              )}
            </WelcomeScreen.Center.Menu>
          )}
        </WelcomeScreen.Center>
      )}
    </WelcomeScreen>
  );
});
