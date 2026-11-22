import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ModeToggle from "@/components/ModeToggle";

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

describe("theme toggle hydration", () => {
  it("uses a stable server snapshot before reading the browser theme", () => {
    const markup = renderToStaticMarkup(createElement(ModeToggle));
    expect(markup).toContain("切換主題（目前：跟隨系統）");
    expect(markup).toContain("lucide-monitor");
    expect(markup).not.toContain("lucide-sun");
  });
});
