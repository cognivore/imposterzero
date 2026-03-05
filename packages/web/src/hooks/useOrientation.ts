import { useState, useEffect } from "react";

interface OrientationState {
  readonly isPortrait: boolean;
  readonly isNarrow: boolean;
  readonly requiresLandscape: boolean;
}

export const useOrientation = (): OrientationState => {
  const [isPortrait, setIsPortrait] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mqlOrientation = window.matchMedia("(orientation: portrait)");
    const mqlWidth = window.matchMedia("(max-width: 767px)");

    const update = () => {
      setIsPortrait(mqlOrientation.matches);
      setIsNarrow(mqlWidth.matches);
    };

    update();
    mqlOrientation.addEventListener("change", update);
    mqlWidth.addEventListener("change", update);
    return () => {
      mqlOrientation.removeEventListener("change", update);
      mqlWidth.removeEventListener("change", update);
    };
  }, []);

  return { isPortrait, isNarrow, requiresLandscape: isPortrait && isNarrow };
};
