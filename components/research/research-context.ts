"use client";

import { createContext, useContext } from "react";
import type { ResearchController } from "./use-research";

export const ResearchContext = createContext<(ResearchController & { inspectJob: (id: string) => void }) | null>(null);
export function useResearchController() {
  const controller = useContext(ResearchContext);
  if (!controller) throw new Error("研究元件需要 ResearchContext。");
  return controller;
}
