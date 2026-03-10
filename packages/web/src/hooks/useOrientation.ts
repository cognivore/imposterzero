import { useState, useEffect } from "react";

interface OrientationState {
  readonly isPortrait: boolean;
  readonly isMobile: boolean;
  readonly requiresLandscape: boolean;
}

export const useOrientation = (): OrientationState => {
  const [isPortrait, setIsPortrait] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mqlOrientation = window.matchMedia("(orientation: portrait)");
    const mqlWidth = window.matchMedia("(max-width: 960px)");
    const mqlHeight = window.matchMedia("(max-height: 540px)");

    const update = () => {
      setIsPortrait(mqlOrientation.matches);
      setIsMobile(mqlWidth.matches || mqlHeight.matches);
    };

    update();
    mqlOrientation.addEventListener("change", update);
    mqlWidth.addEventListener("change", update);
    mqlHeight.addEventListener("change", update);
    return () => {
      mqlOrientation.removeEventListener("change", update);
      mqlWidth.removeEventListener("change", update);
      mqlHeight.removeEventListener("change", update);
    };
  }, []);

  return { isPortrait, isMobile, requiresLandscape: isPortrait && isMobile };
};
