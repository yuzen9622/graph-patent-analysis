import type { ReactNode } from "react";
import styles from "@/components/workspace/workspace.module.css";

export default function SynonymsLayout({ children }: { children: ReactNode }) {
  return <div className={styles.surface}>{children}</div>;
}
