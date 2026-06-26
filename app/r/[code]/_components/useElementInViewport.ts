"use client";

import { useEffect, useState } from "react";

export function useElementInViewport(element: Element | null, threshold = 0) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry?.isIntersecting ?? false);
      },
      { threshold },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [element, threshold]);

  return element ? isVisible : false;
}
