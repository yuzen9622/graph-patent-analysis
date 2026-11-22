"use client";

import { useEffect, useRef } from "react";
import { motion, Reorder } from "motion/react";
import { MessageSquare, Network, Plus, X } from "lucide-react";
import { SPRING_LAYOUT } from "@/lib/ease";
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
  useEffect(() => {
    document.getElementById(`tab-${active}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return <>
    <Reorder.Group as="div" axis="x" layoutScroll values={tabs} onReorder={onReorder}
      role="tablist" aria-label="工作區分頁" className={styles.tabs}>
      {tabs.map((tab, index) => {
        const Icon = tab.kind === "chat" ? MessageSquare : Network;
        return <Reorder.Item as="div" key={tab.key} value={tab} dragMomentum={false}
          layout="position" whileDrag={{ zIndex: 2 }} className={styles.tabItem} data-active={tab.key === active}
          onPointerDownCapture={() => { dragged.current = false; }}
          onDragStart={() => { dragged.current = true; }}>
          {tab.key === active && <motion.span aria-hidden="true" className={styles.tabIndicator}
            layoutId="workspace-tab-indicator" transition={SPRING_LAYOUT} />}
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
    <button type="button" className={styles.newTab} title="新增對話分頁" aria-label="新增對話分頁" onClick={onNew}><Plus size={17} /></button>
  </>;
}
