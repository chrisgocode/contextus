"use client";

import { useEffect, useState } from "react";

// How much of the layout viewport's bottom the on-screen keyboard covers, in
// CSS pixels. iOS Safari doesn't resize the layout viewport for the keyboard,
// so `position: fixed; bottom: …` elements end up behind it; adding this
// inset lifts them back into view. Browsers that resize the layout viewport
// instead, like Chrome on Android, report 0.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setInset(
        Math.max(
          0,
          Math.round(
            window.innerHeight - (viewport.offsetTop + viewport.height),
          ),
        ),
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
