/**
 * 比較 PNG 的畫布組裝（瀏覽器端專用：用到 Image 與 canvas）。
 * 文案來源一律走 lib/compare-export.ts，跟離線 HTML 匯出共用同一份字串。
 */
import type { CompareLegendItem } from "./compare-export";

const PADDING = 32;
const TITLE_FONT_PX = 34;
const LINE_FONT_PX = 22;
const LINE_HEIGHT_PX = 32;
const LEGEND_SWATCH_PX = 18;
const PANEL_LABEL_PX = 24;
const PANEL_GAP = 24;

export interface ComparePanelImage {
	label: string;
	dataUrl: string;
}

export interface CompareImageInput {
	title: string;
	annotationLines: string[];
	legend: CompareLegendItem[];
	panels: ComparePanelImage[];
}

function loadPngImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("匯出圖片解碼失敗"));
		img.src = dataUrl;
	});
}

/** 將中文檔名／篩選字串按實際字寬折行，避免標註跨出匯出圖幅。 */
function wrapCanvasText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const lines: string[] = [];
	let current = "";
	for (const character of text) {
		const candidate = current + character;
		if (current && ctx.measureText(candidate).width > maxWidth) {
			lines.push(current);
			current = character;
		} else {
			current = candidate;
		}
	}
	if (current || lines.length === 0) lines.push(current);
	return lines;
}

interface PositionedLegendItem {
	item: CompareLegendItem;
	text: string;
	x: number;
	row: number;
}

function positionLegend(
	ctx: CanvasRenderingContext2D,
	legend: CompareLegendItem[],
	maxWidth: number,
): PositionedLegendItem[] {
	const positioned: PositionedLegendItem[] = [];
	let x = 0;
	let row = 0;
	for (const item of legend) {
		const text = `${item.label}（${item.encoding}）`;
		const itemWidth = LEGEND_SWATCH_PX + 8 + ctx.measureText(text).width + 28;
		if (x > 0 && x + itemWidth > maxWidth) {
			x = 0;
			row += 1;
		}
		positioned.push({ item, text, x, row });
		x += itemWidth;
	}
	return positioned;
}

/**
 * 產生一張帶標題、A/B 來源、共用篩選、指標與圖例的白底 PNG。
 * panels 一張＝差異檢視，兩張＝並排檢視。
 */
export async function composeCompareImage(
	input: CompareImageInput,
): Promise<string> {
	if (input.panels.length === 0) throw new Error("沒有可匯出的畫面");
	const images = await Promise.all(
		input.panels.map((panel) => loadPngImage(panel.dataUrl)),
	);

	const panelsWidth =
		images.reduce((sum, image) => sum + image.width, 0) +
		PANEL_GAP * (images.length - 1);
	const panelsHeight = Math.max(...images.map((image) => image.height));
	const width = Math.max(panelsWidth, 960) + PADDING * 2;
	const contentWidth = width - PADDING * 2;

	// 先量出折行後的標註與圖例高度，再設定最終畫布高度；改變 height 會重設 context，
	// 所以所有實際繪製設定都在後面重設一次。
	const canvas = document.createElement("canvas");
	canvas.width = width;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("無法建立畫布");
	ctx.font = `${LINE_FONT_PX}px system-ui, sans-serif`;
	const annotationLines = input.annotationLines.flatMap((line) =>
		wrapCanvasText(ctx, line, contentWidth),
	);
	const legend = positionLegend(ctx, input.legend, contentWidth);
	const legendRows =
		legend.length === 0 ? 0 : legend[legend.length - 1].row + 1;
	ctx.font = `bold ${PANEL_LABEL_PX - 4}px system-ui, sans-serif`;
	// 每張子圖都有自己的可用寬度；不可讓很長的 A/B 檔名跨進另一張圖。
	const panelLabelLines = input.panels.map((panel, index) =>
		wrapCanvasText(ctx, panel.label, images[index].width),
	);
	const panelLabelHeight =
		Math.max(...panelLabelLines.map((lines) => lines.length)) * PANEL_LABEL_PX;
	const headerHeight =
		TITLE_FONT_PX +
		20 +
		annotationLines.length * LINE_HEIGHT_PX +
		legendRows * LINE_HEIGHT_PX +
		12;
	const height =
		headerHeight + panelLabelHeight + 10 + panelsHeight + PADDING * 2;
	canvas.height = height;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.textBaseline = "top";

	let y = PADDING;
	ctx.fillStyle = "#0f172a";
	ctx.font = `bold ${TITLE_FONT_PX}px system-ui, sans-serif`;
	ctx.fillText(input.title, PADDING, y);
	y += TITLE_FONT_PX + 20;

	ctx.font = `${LINE_FONT_PX}px system-ui, sans-serif`;
	ctx.fillStyle = "#334155";
	for (const line of annotationLines) {
		ctx.fillText(line, PADDING, y);
		y += LINE_HEIGHT_PX;
	}

	for (const entry of legend) {
		const legendY = y + entry.row * LINE_HEIGHT_PX;
		ctx.fillStyle = entry.item.color;
		ctx.fillRect(
			PADDING + entry.x,
			legendY + 3,
			LEGEND_SWATCH_PX,
			LEGEND_SWATCH_PX,
		);
		ctx.fillStyle = "#334155";
		ctx.fillText(entry.text, PADDING + entry.x + LEGEND_SWATCH_PX + 8, legendY);
	}
	y += legendRows * LINE_HEIGHT_PX + 12;

	let x = PADDING;
	for (const [index, image] of images.entries()) {
		ctx.fillStyle = "#0f172a";
		ctx.font = `bold ${PANEL_LABEL_PX - 4}px system-ui, sans-serif`;
		for (const [lineIndex, line] of panelLabelLines[index].entries()) {
			ctx.fillText(line, x, y + lineIndex * PANEL_LABEL_PX);
		}
		ctx.drawImage(image, x, y + panelLabelHeight + 10);
		ctx.strokeStyle = "#cbd5e1";
		ctx.lineWidth = 1;
		ctx.strokeRect(
			x + 0.5,
			y + panelLabelHeight + 10.5,
			image.width,
			image.height,
		);
		x += image.width + PANEL_GAP;
	}

	return canvas.toDataURL("image/png");
}
