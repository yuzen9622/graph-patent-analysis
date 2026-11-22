import type { ReactNode } from "react";
import WorkspacePage from "@/components/workspace/WorkspacePage";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspacePage>{children}</WorkspacePage>;
}
