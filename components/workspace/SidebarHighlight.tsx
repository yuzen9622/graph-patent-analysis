"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import styles from "./workspace.module.css";

const HoverContext = createContext<string | null>(null);

export function SidebarRail({ children }: { children: ReactNode }) {
  const group = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const exit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(exit.current), []);

  function highlight(row: string | null) {
    clearTimeout(exit.current);
    if (row) setHovered(row);
    else exit.current = setTimeout(() => setHovered(null), 90);
  }

  return <LayoutGroup id={group}><HoverContext.Provider value={hovered}>
    <div className={styles.rail} onPointerOver={event => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>("[data-sidebar-row]");
      highlight(row && event.currentTarget.contains(row) ? row.dataset.sidebarRow ?? null : null);
    }} onPointerLeave={() => highlight(null)}>
      {children}
    </div>
  </HoverContext.Provider></LayoutGroup>;
}

export function SidebarHighlight({ row }: { row: string }) {
  const hovered = useContext(HoverContext);
  const reduced = useReducedMotion();
  if (hovered !== row) return null;
  return <motion.span aria-hidden className={styles.hoverSurface}
    layoutId={reduced ? undefined : "sidebar-hover"}
    transition={{ type: "spring", stiffness: 500, damping: 40 }} />;
}
