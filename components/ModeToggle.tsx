"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const ORDER = ["light", "dark", "system"] as const;
const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS = { light: "淺色模式", dark: "深色模式", system: "跟隨系統" };
const subscribe = () => () => {};

export default function ModeToggle() {
	const { theme, setTheme } = useTheme();
	const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
	const current = hydrated && (theme === "light" || theme === "dark") ? theme : "system";
	const Icon = ICONS[current];
	const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			onClick={() => setTheme(next)}
			aria-label={`切換主題（目前：${LABELS[current]}）`}
			title={`切換主題（目前：${LABELS[current]}）`}
		>
			<Icon className="size-3.5" aria-hidden />
		</Button>
	);
}
