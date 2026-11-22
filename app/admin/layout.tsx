import type { ReactNode } from "react";
import styles from "@/components/workspace/workspace.module.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className={styles.surface}>{children}</div>;
}
