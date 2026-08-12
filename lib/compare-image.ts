/**
 * 比較 PNG 的畫布組裝（瀏覽器端專用：用到 Image 與 canvas）。
 * 文案來源一律走 lib/compare-export.ts，跟離線 HTML 匯出共用同一份字串。
 *
 * 排版計算抽成純函式 `compareImageLayout`（可單元測試，無 canvas）：
 * 兩張以內單排橫排；三張以上每列最多 2 張，避免匯出圖過寬。
 */
import type { CompareLegendItem } from "./compare-export";

const PADDING = 32;
const TITLE_FONT_PX = 34;
const LINE_FONT_PX = 22;
const LINE_HEIGHT_PX = 32;
const LEGEND_SWATCH_PX = 18;
const PANEL_LABEL_PX = 24;
const PANEL_GAP = 24;
/** 每列最多放幾張面板圖（三面板以上避免單排超寬）。 */
const MAX_PANELS_PER_ROW = 2;
/** 內容區最小寬度（含標註與圖例的版面需求）。 */
const MIN_CONTENT_WIDTH = 960;

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

export interface PanelSize {
	width: number;
	height: number;
}

export interface CompareImageLayout {
	/** 每列最多幾張（<=2 為單排）。 */
	columns: number;
	/** 每張面板在內容區的 x（不含 PADDING）。 */
	panelX: number[];
	/** 每張面板在面板區的 y（不含標題/標註/圖例與 PADDING）。 */
	panelY: number[];
	/** 內容區寬度＝最寬一列的寬（至少 MIN_CONTENT_WIDTH）。 */
	contentWidth: number;
	/** 面板區總高（各列高的和＋列間距）。 */
	panelsAreaHeight: number;
}

/**
 * 純排版：把 N 張面板圖排成「每列最多 maxPerRow 張」的網格。
 * 兩張以內就是單排（與舊版 A/B 排版一致）；三張以上每列最多 2 張。
 * 每列寬＝該列圖片寬和＋間距，總內容寬＝最寬列（至少 MIN_CONTENT_WIDTH）；
 * 各列左上對齊，x 由左到右連續、y 依列高累積。
 */
/**
 * 純排版：把 N 張面板圖排成「每列最多 maxPerRow 張」的網格。
 * 兩張以內就是單排（與舊版 A/B 排版一致）；三張以上每列最多 2 張。
 * 每列寬＝該列圖片寬和＋間距，總內容寬＝最寬列（至少 MIN_CONTENT_WIDTH）；
 * 各列左上對齊，x 由左到右連續、y 依列高累加；列間距可自訂（匯出端會把
 * 面板標籤高度算進去，避免下一列的標籤蓋到上一列的圖）。
 */
export function compareImageLayout(
	panelSizes: readonly PanelSize[],
	maxPerRow = MAX_PANELS_PER_ROW,
	rowGap = PANEL_GAP * 2,
): CompareImageLayout {
	if (panelSizes.length === 0) {
		return {
			columns: maxPerRow,
			panelX: [],
			panelY: [],
			contentWidth: MIN_CONTENT_WIDTH,
			panelsAreaHeight: 0,
		};
	}
	const columns = Math.min(maxPerRow, panelSizes.length);
	const panelX: number[] = [];
	const panelY: number[] = [];
	const rowWidths: number[] = [];
	let contentWidth = 0;
	for (let index = 0; index < panelSizes.length; index += 1) {
		const column = index % columns;
		if (column === 0) {
			const rowWidth =
				panelSizes
					.slice(index, Math.min(index + columns, panelSizes.length))
					.reduce((sum, size) => sum + size.width, 0) +
				PANEL_GAP * (Math.min(columns, panelSizes.length - index) - 1);
			rowWidths.push(rowWidth);
			contentWidth = Math.max(contentWidth, rowWidth);
		}
		panelX.push(
			column === 0
				? 0
				: panelSizes
						.slice(index - column, index)
						.reduce((sum, size) => sum + size.width, 0) +
						PANEL_GAP * column,
		);
	}
	const rowHeights: number[] = [];
	for (let row = 0; row < rowWidths.length; row += 1) {
		const start = row * columns;
		const end = Math.min(start + columns, panelSizes.length);
		rowHeights.push(
			Math.max(...panelSizes.slice(start, end).map((s) => s.height)),
		);
	}
	let y = 0;
	for (let row = 0; row < rowHeights.length; row += 1) {
		const start = row * columns;
		const end = Math.min(start + columns, panelSizes.length);
		for (let index = start; index < end; index += 1) panelY.push(y);
		y += rowHeights[row] + (row < rowHeights.length - 1 ? rowGap : 0);
	}
	return {
		columns,
		panelX,
		panelY,
		contentWidth: Math.max(contentWidth, MIN_CONTENT_WIDTH),
		panelsAreaHeight: y,
	};
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
 * 產生一張帶標題、面板來源、共用篩選、指標與圖例的白底 PNG。
 * panels 一張＝差異檢視；多張＝並排檢視（三張以上每列最多 2 張）。
 */
export async function composeCompareImage(
	input: CompareImageInput,
): Promise<string> {
	if (input.panels.length === 0) throw new Error("沒有可匯出的畫面");
	const images = await Promise.all(
		input.panels.map((panel) => loadPngImage(panel.dataUrl)),
	);

	// 先量出折行後的標註與圖例高度，再設定最終畫布尺寸；改變 height 會重設 context，
	// 所以所有實際繪製設定都在後面重設一次。
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("無法建立畫布");

	ctx.font = `bold ${PANEL_LABEL_PX - 4}px system-ui, sans-serif`;
	// 每張子圖都有自己的可用寬度；不可讓很長的檔名跨進另一張圖。
	const panelLabelLines = input.panels.map((panel, index) =>
		wrapCanvasText(ctx, panel.label, images[index].width),
	);
	const panelLabelHeight =
		Math.max(...panelLabelLines.map((lines) => lines.length)) * PANEL_LABEL_PX;
	// 列間距要把標籤高度算進去：下一列的標籤才不會蓋到上一列的圖。
	const layout = compareImageLayout(
		images.map((image) => ({ width: image.width, height: image.height })),
		MAX_PANELS_PER_ROW,
		panelLabelHeight + 10 + PANEL_GAP,
	);
	const contentWidth = layout.contentWidth;
	const width = contentWidth + PADDING * 2;
	canvas.width = width;

	ctx.font = `${LINE_FONT_PX}px system-ui, sans-serif`;
	const annotationLines = input.annotationLines.flatMap((line) =>
		wrapCanvasText(ctx, line, contentWidth),
	);
	const legend = positionLegend(ctx, input.legend, contentWidth);
	const legendRows = legend.length === 0 ? 0 : (legend.at(-1)?.row ?? 0) + 1;
	const headerHeight =
		TITLE_FONT_PX +
		20 +
		annotationLines.length * LINE_HEIGHT_PX +
		legendRows * LINE_HEIGHT_PX +
		12;
	const height =
		headerHeight +
		panelLabelHeight +
		10 +
		layout.panelsAreaHeight +
		PADDING * 2;
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

	// 每張圖的標籤直接放在該張圖（該列）正上方，不同列各自對齊。
	const panelTop = y + panelLabelHeight + 10;
	for (const [index, image] of images.entries()) {
		const x = PADDING + layout.panelX[index];
		const panelY = panelTop + layout.panelY[index];
		const labelTop = y + layout.panelY[index];
		ctx.fillStyle = "#0f172a";
		ctx.font = `bold ${PANEL_LABEL_PX - 4}px system-ui, sans-serif`;
		for (const [lineIndex, line] of panelLabelLines[index].entries()) {
			ctx.fillText(line, x, labelTop + lineIndex * PANEL_LABEL_PX);
		}
		ctx.drawImage(image, x, panelY);
		ctx.strokeStyle = "#cbd5e1";
		ctx.lineWidth = 1;
		ctx.strokeRect(x + 0.5, panelY + 0.5, image.width, image.height);
	}

	return canvas.toDataURL("image/png");
}
