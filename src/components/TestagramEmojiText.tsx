import { useEffect, useRef } from "react";
import { parseTwemoji } from "../lib/twemoji";

type TestagramEmojiTextProps = {
  children: string;
  className?: string;
  title?: boolean;
};

/**
 * Safe emoji-aware text renderer for posts, replies, profiles and notifications.
 * The parser operates on text nodes after React has rendered them.
 */
export function TestagramEmojiText({ children, className, title = false }: TestagramEmojiTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) parseTwemoji(ref.current, { title });
  }, [children, title]);

  return <span ref={ref} className={className}>{children}</span>;
}
