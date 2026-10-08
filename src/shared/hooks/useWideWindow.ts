import { useEffect, useState } from "react";

/** Window width (CSS px) at which pages switch to their two-column layout. */
export const WIDE_LAYOUT_MIN_WIDTH = 640;

const isWideNow = () => typeof window !== "undefined" && window.innerWidth >= WIDE_LAYOUT_MIN_WIDTH;

/** Whether the window is wide enough for a two-column layout (rAF-throttled). */
export const useWideWindow = () => {
  const [isWide, setIsWide] = useState(isWideNow);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIsWide(isWideNow()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return isWide;
};
