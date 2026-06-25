// js/render-bus.js — 渲染调度层
// 提供 repaintCurrentMode(按当前模式重绘 perlerCanvas)与
// recomputePreservingRefine(切品牌/色板/阈值后保留精修地重算重绘)。
//
// 独立成模块是为了打破循环依赖:state.js 是被 generate.js /
// fused-preview.js / color.js 引用的底层状态,若把"渲染调度"留在
// state.js,就会 state → generate → state 绕回,只能靠 main.js 的
// setter 注入 + 动态 import 回填(可读性差)。这里单向依赖
// render-bus → state/generate/fused-preview/color,editor / ui-* 只读
// render-bus,不再需要注入。

import {
    dom,
    currentMode,
    lastMergedGrid,
    lastPreMergeGrid,
    lastGridCols,
    lastGridRows,
    lastCellSize,
    mergeThreshold,
    setLastMergedGrid,
} from './state.js';
import { drawGrid, generatePerlerGrid } from './generate.js';
import { repaintFused } from './fused-preview.js';
import { getClosestBeadColor, mergeSimilarColors } from './color.js';

// 按当前模式重绘 perlerCanvas:
// fused 模式走 fused-preview;否则用 lastMergedGrid 全量重画 grid。
// 供 editor undo/redo、ui-mode 模式切换、ui-fuse 效果切换调用。
export function repaintCurrentMode() {
    if (currentMode === 'fused') {
        repaintFused();
        return;
    }
    if (!lastMergedGrid) return;
    const canvas = dom.perlerCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, lastMergedGrid, lastGridCols, lastGridRows, lastCellSize);
}

// 切色板/阈值后,保留手动精修痕迹地重算并重绘。
// - palette:每格重新映射到新色板的最近色,再重画。
// - threshold:用合并前的 preMergeGrid 按新阈值重新合并,更新 mergedGrid 后重画。
// - 其它/缺数据:回退到整图重新生成。
export function recomputePreservingRefine(kind) {
    if (!lastMergedGrid) {
        generatePerlerGrid();
        return;
    }
    const canvas = dom.perlerCanvas;
    const ctx = canvas.getContext('2d');
    const cols = lastGridCols;
    const rows = lastGridRows;
    const cs = lastCellSize;

    if (kind === 'palette') {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = lastMergedGrid[r][c];
                if (cell.transparent) continue;
                lastMergedGrid[r][c] = getClosestBeadColor(cell.r, cell.g, cell.b);
            }
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, lastMergedGrid, cols, rows, cs);
        return;
    }

    if (kind === 'threshold') {
        if (!lastPreMergeGrid) {
            generatePerlerGrid();
            return;
        }
        const remerged = mergeSimilarColors(lastPreMergeGrid, cols, rows, mergeThreshold);
        setLastMergedGrid(remerged);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, remerged, cols, rows, cs);
        return;
    }

    generatePerlerGrid();
}
