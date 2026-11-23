"use client";

import { useEffect, useRef, useState } from "react";
import { Reorder } from "motion/react";
import { ChevronLeft, ChevronRight, MessageSquare, Network, Plus, X } from "lucide-react";
import styles from "./workspace.module.css";

export interface WorkspaceTab {
  key: string;
  resource: string;
  kind: "chat" | "graph";
  href: string;
  title: string;
  section: "research" | "import";
}

export function WorkspaceTabs({ tabs, active, label, onSelect, onClose, onNew, onReorder }: {
  tabs: WorkspaceTab[];
  active: string;
  label: (tab: WorkspaceTab) => string;
  onSelect: (tab: WorkspaceTab) => void;
  onClose: (tab: WorkspaceTab) => void;
  onNew: () => void;
  onReorder: (tabs: WorkspaceTab[]) => void;
}) {
  const dragged = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    function measure() {
      if (!element) return;
      const left = element.scrollLeft > 1;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setOverflow(previous => previous.left === left && previous.right === right ? previous : { left, right });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [tabs]);
  function scrollTabs(direction: number) {
    const element = strip.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * .75,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  useEffect(() => {
    document.getElementById(`tab-${active}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return <>
    {(overflow.left || overflow.right) && <button type="button" className={styles.scrollTab} aria-label="向左捲動分頁" disabled={!overflow.left} onClick={() => scrollTabs(-1)}><ChevronLeft size={15} /></button>}
    <Reorder.Group ref={strip} as="div" axis="x" layoutScroll values={tabs} onReorder={onReorder}
      role="tablist" aria-label="工作區分頁" className={styles.tabs}>
      {tabs.map((tab, index) => {
        const Icon = tab.kind === "chat" ? MessageSquare : Network;
        return <Reorder.Item as="div" key={tab.key} value={tab} dragMomentum={false}
          layout="position" whileDrag={{ zIndex: 2 }} className={styles.tabItem} data-active={tab.key === active}
          onPointerDownCapture={() => { dragged.current = false; }}
          onDragStart={() => { dragged.current = true; }}>
          <button type="button" role="tab" id={`tab-${tab.key}`} aria-controls={`panel-${tab.key}`}
            aria-selected={active === tab.key} tabIndex={active === tab.key ? 0 : -1} title={label(tab)}
            className={styles.tab} onClick={event => {
              if (!dragged.current || event.detail === 0) onSelect(tab);
            }}
            onKeyDown={event => {
              if (event.key === "Delete") { event.preventDefault(); onClose(tab); return; }
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const target = step ? (index + step + tabs.length) % tabs.length : event.key === "Home" ? 0 : tabs.length - 1;
              if (event.altKey && step) {
                const order = [...tabs];
                order.splice(index, 1);
                order.splice(target, 0, tab);
                onReorder(order);
              } else {
                document.getElementById(`tab-${tabs[target].key}`)?.focus();
                onSelect(tabs[target]);
              }
            }}>
            <Icon size={15} aria-hidden /><span>{label(tab)}</span>
          </button>
          <button type="button" aria-label={`關閉「${label(tab)}」分頁`} title="關閉分頁"
            className={styles.closeTab} onPointerDown={event => event.stopPropagation()} onClick={() => onClose(tab)}>
            <X size={14} aria-hidden />
          </button>
        </Reorder.Item>;
      })}
    </Reorder.Group>
    {(overflow.left || overflow.right) && <button type="button" className={styles.scrollTab} aria-label="向右捲動分頁" disabled={!overflow.right} onClick={() => scrollTabs(1)}><ChevronRight size={15} /></button>}
    <button type="button" className={styles.newTab} title="新增對話分頁" aria-label="新增對話分頁" onClick={onNew}><Plus size={17} /></button>
  </>;
}
