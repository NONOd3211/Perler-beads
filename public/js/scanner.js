// 扫描主流程:按 grid 切 cell → 颜色匹配 MARD 色板 → 写入 lastMergedGrid。
// 颜色匹配对 generate.js 导出的图(每 cell 填 MARD 真实 RGB)100% 精确。
import { splitGrid } from './scanner-preprocess.js';
import { BEAD_PALETTE_291 } from './palettes.js';
import {
    setLastMergedGrid,
    setLastGridDims,
    setLastCellSize,
    setScannerErrors,
    dom,
} from './state.js';
import { repaintCurrentMode } from './render-bus.js';
import { openZoomModal } from './ui-modals.js';

const COLOR_DISTANCE_THRESHOLD = 12; // RGB 欧氏距离 < 12 视为精确匹配
const CODE_TO_PALETTE = new Map(BEAD_PALETTE_291.map((p) => [p.code, p]));
const DEFAULT_CELL_SIZE = 20;

export async function importDiagramFromImage(imageData, grid) {
    if (!grid || !grid.rows || !grid.cols || !grid.cellSize || !grid.origin) {
        return { ok: false, fatal: 'invalid_grid' };
    }
    if (!imageData || !imageData.width || !imageData.height) {
        return { ok: false, fatal: 'invalid_image' };
    }

    const { cells: gridCells, warnings } = splitGrid(imageData, grid);
    const cells = [];
    const errors = [];

    for (let r = 0; r < grid.rows; r++) {
        const row = [];
        for (let c = 0; c < grid.cols; c++) {
            const { best, bestD, allTransparent } = matchCellByColor(gridCells[r][c]);
            if (best && bestD <= COLOR_DISTANCE_THRESHOLD) {
                row.push({ code: best.code, transparent: false, confidence: 1 });
            } else if (allTransparent) {
                // 全透明 = 该格无拼豆,不算错误
                row.push({ code: null, transparent: true, confidence: 0 });
            } else {
                // 颜色不在 MARD 调色板内:标记错误,保留 best 作为 picker 预填候选
                row.push({ code: null, transparent: true, confidence: 0 });
                errors.push({
                    row: r,
                    col: c,
                    reason: 'color_mismatch',
                    candidates: best ? [best.code] : [],
                });
            }
        }
        cells.push(row);
    }

    return { ok: true, cells, errors, warnings };
}

// 取 cell 4 角各 3x3 像素(避开中央文字)的 RGB 平均,找最近 MARD 色。
// 总是返回 { best, bestD, allTransparent }:
// - allTransparent=true → 该格无像素(如透明导出/缺图),不算错误
// - bestD <= threshold → 可直接采用 best.code
// - 否则 → 把 best 作为 candidates 交给错误处理(picker 预填最近色)
function matchCellByColor(cellImg) {
    const w = cellImg.width, h = cellImg.height;
    const data = cellImg.data;
    const corners = [
        [1, 1, 3, 3],
        [w - 4, 1, 3, 3],
        [1, h - 4, 3, 3],
        [w - 4, h - 4, 3, 3],
    ];
    let r = 0, g = 0, b = 0, n = 0;
    for (const [x0, y0, cw, ch] of corners) {
        for (let y = y0; y < y0 + ch; y++) {
            for (let x = x0; x < x0 + cw; x++) {
                const i = (y * w + x) * 4;
                if (data[i + 3] < 128) continue; // 跳过透明像素
                r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
            }
        }
    }
    if (n === 0) return { best: null, bestD: Infinity, allTransparent: true };

    const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    let best = null, bestD = Infinity;
    for (const p of BEAD_PALETTE_291) {
        const dr = avg[0] - p.r, dg = avg[1] - p.g, db = avg[2] - p.b;
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < bestD) { bestD = d; best = p; }
    }
    return { best, bestD, allTransparent: false };
}

export function applyScanResultToEditor(result) {
    if (!result || !result.ok) return;

    const grid = result.cells.map((row) =>
        row.map((cell) => {
            if (cell.transparent || !cell.code) return { transparent: true };
            return CODE_TO_PALETTE.get(cell.code) || { transparent: true };
        })
    );

    const rows = result.cells.length;
    const cols = result.cells[0]?.length || 0;

    setLastMergedGrid(grid);
    setLastGridDims(cols, rows);
    setLastCellSize(DEFAULT_CELL_SIZE);
    setScannerErrors(result.errors || []);

    if (dom && dom.perlerCanvas) {
        dom.perlerCanvas.width = cols * DEFAULT_CELL_SIZE;
        dom.perlerCanvas.height = rows * DEFAULT_CELL_SIZE;
    }

    repaintCurrentMode();
    openZoomModal();
}