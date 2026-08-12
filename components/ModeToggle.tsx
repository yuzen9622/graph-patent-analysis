"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const ORDER = ["light", "dark", "system"] as const;
const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS = { light: "淺色模式", dark: "深色模式", system: "跟隨系統" };

export default function ModeToggle() {
	const { theme, setTheme } = useTheme();
	const current = (theme ?? "system") as (typeof ORDER)[number];
	const Icon = ICONS[current];
	const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
	return (
		<button
			type="button"
			onClick={() => setTheme(next)}
			aria-label={`切換主題（目前：${LABELS[current]}）`}
			title={`切換主題（目前：${LABELS[current]}）`}
			className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 cursor-pointer"
		>
			<Icon size={14} aria-hidden />
		</button>
	);
}
