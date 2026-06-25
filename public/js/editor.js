// 拼豆编辑器 — 撤销/重做 + 单格改色 + 相似色查询 + 选色浮窗
// 单一职责:管理手动精修状态(历史栈、最近色、浮窗)
// 数据源:state.lastMergedGrid(被引用并就地修改);不复制整个 grid 到自身

import { calculateColorDistance, getDisplayCode } from './color.js';
import {
    dom as stateDom,
    editorHistory,
    editorFuture,
    lastMergedGrid,
    lastCellSize,
    currentPalette,
    recentCodes,
    pushRecentCode,
    pickerActive,
    currentMode,
    lastGridCols,
    lastGridRows,
} from './state.js';
import { repaintCurrentMode } from './render-bus.js';

// 命令模式:history 存 {row, col, oldCell, newCell} diff 元组(单格 4 元组)
// undo/redo 通过 diff 写回单格,不再 clone 整 grid
// (10816 cell 拼豆图 50 步历史栈 ≈ 几十 MB → 几十 KB)
export function pushHistory(row, col, oldCell, newCell) {
    editorHistory.push({ row, col, oldCell, newCell });
    if (editorHistory.length > 50) editorHistory.shift();
    // 新编辑清 redo — 见 Task 3.3(undo/redo)对齐
    editorFuture.length = 0;
}
export function undo() {
    if (editorHistory.length === 0) return;
    const diff = editorHistory.pop();
    // 先把"当前(应用 newCell 后)"状态入 future,让 redo 能反向
    // 推入的 diff 字段含义同 history:{row, col, oldCell, newCell}
    // 这里的 oldCell 位置填 diff.oldCell(因为 redo 写回 newCell 即可),newCell 同 diff.newCell
    editorFuture.push({
        row: diff.row,
        col: diff.col,
        oldCell: diff.oldCell,
        newCell: diff.newCell,
    });
    if (editorFuture.length > 50) editorFuture.shift();
    // 写回 oldCell(单格)
    lastMergedGrid[diff.row][diff.col] = diff.oldCell;
    repaintCurrentMode();
}
export function redo() {
    if (editorFuture.length === 0) return;
    const diff = editorFuture.pop();
    editorHistory.push({
        row: diff.row,
        col: diff.col,
        oldCell: diff.oldCell,
        newCell: diff.newCell,
    });
    if (editorHistory.length > 50) editorHistory.shift();
    // 写回 newCell(单格)
    lastMergedGrid[diff.row][diff.col] = diff.newCell;
    repaintCurrentMode();
}
export function canUndo() {
    return editorHistory.length > 0;
}
export function canRedo() {
    return editorFuture.length > 0;
}

async function drawFusedForEditor(ctx, grid, cols, rows, cs) {
    const { drawFused } = await import('./fused-preview.js');
    drawFused(ctx, grid, cols, rows, cs);
}
async function drawGridForEditor(ctx, grid, cols, rows, cs) {
    const { drawGrid } = await import('./generate.js');
    drawGrid(ctx, grid, cols, rows, cs);
}

export function applyColorChange(row, col, newColor) {
    if (!lastMergedGrid) return;
    // 1. 取 oldCell(应用前的 cell)+ 入栈 diff + 清 redo
    const oldCell = lastMergedGrid[row][col];
    pushHistory(row, col, oldCell, newColor);
    // 2. 改 grid
    lastMergedGrid[row][col] = newColor;
    // 3. 更新最近色号(去重 + 置顶 + 截断到 12)
    const code = getDisplayCode(newColor);
    pushRecentCode(code);
    // 4. 局部重绘
    const cs = lastCellSize;
    const perlerCanvas = stateDom.perlerCanvas;
    const ctx = perlerCanvas.getContext('2d');
    if (currentMode === 'fused') {
        // fused:clear 单格 + 重画整图(避免邻接圆边界破图)
        ctx.clearRect(0, 0, perlerCanvas.width, perlerCanvas.height);
        drawFusedForEditor(ctx, lastMergedGrid, lastGridCols, lastGridRows, cs);
    } else {
        // grid:局部 clearRect + 全量重画(简单稳妥)
        const x = col * cs,
            y = row * cs;
        ctx.clearRect(x - 1, y - 1, cs + 2, cs + 2);
        drawGridForEditor(ctx, lastMergedGrid, lastGridCols, lastGridRows, cs);
    }
}
export function pickSimilarColors(currentColor, palette, n) {
    if (n === undefined) n = 8;
    return palette
        .filter((c) => !c.transparent && c.hex !== currentColor.hex)
        .map((c) => ({
            c,
            d: calculateColorDistance(
                currentColor.r,
                currentColor.g,
                currentColor.b,
                c.r,
                c.g,
                c.b
            ),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map((x) => x.c);
}
export function getRecentCodes(n) {
    if (n === undefined) n = 12;
    const out = recentCodes.slice(0, n);
    if (out.length < n) {
        // 不够补当前 palette 高频色(前 12 项作兜底)
        const palette = currentPalette || [];
        for (const c of palette) {
            if (out.length >= n) break;
            const code = getDisplayCode(c);
            if (!out.includes(code)) out.push(code);
        }
    }
    return out;
}
export function openPicker(row, col) {
    if (!lastMergedGrid) return;
    const cell = lastMergedGrid[row][col];
    if (!cell || cell.transparent) return; // 透明格跳过

    pickerActive.current = { row, col };

    // 当前色
    const code = getDisplayCode(cell);
    const codeEl = document.getElementById('editorCurrentCode');
    const swEl = document.getElementById('editorCurrentSwatch');
    if (codeEl) codeEl.textContent = code;
    if (swEl) swEl.style.backgroundColor = cell.hex;

    // 相似色:8 个
    const simGrid = document.getElementById('editorSimilarGrid');
    if (simGrid) {
        simGrid.innerHTML = '';
        const sims = pickSimilarColors(cell, currentPalette, 8);
        for (const s of sims) {
            const div = document.createElement('div');
            const sw = document.createElement('div');
            sw.className = 'swatch';
            sw.style.backgroundColor = s.hex;
            div.appendChild(sw);
            const sc = getDisplayCode(s);
            div.appendChild(document.createTextNode(sc));
            div.addEventListener('click', () => {
                applyColorChange(row, col, s);
                closePicker();
            });
            simGrid.appendChild(div);
        }
    }

    // 最近色号:12 个候选按钮
    const recentGrid = document.getElementById('editorRecentGrid');
    if (recentGrid) {
        recentGrid.innerHTML = '';
        const codes = getRecentCodes(12);
        for (const c of codes) {
            // 从 palette 反查 hex
            const match = currentPalette.find((p) => getDisplayCode(p) === c);
            const div = document.createElement('div');
            const sw = document.createElement('div');
            sw.className = 'swatch';
            sw.style.backgroundColor = match ? match.hex : '#cccccc';
            div.appendChild(sw);
            div.appendChild(document.createTextNode(c));
            div.addEventListener('click', () => {
                if (!match) return;
                applyColorChange(row, col, match);
                closePicker();
            });
            recentGrid.appendChild(div);
        }
    }

    // 输入框 + 错误清空
    const input = document.getElementById('editorCodeInput');
    const err = document.getElementById('editorCodeError');
    if (input) input.value = '';
    if (err) err.style.display = 'none';

    // 显示 modal
    const modal = document.getElementById('editorModal');
    if (modal) modal.style.display = 'flex';
}

export function closePicker() {
    const modal = document.getElementById('editorModal');
    if (modal) modal.style.display = 'none';
    pickerActive.current = null;
}

export const BeadEditor = {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    applyColorChange,
    pickSimilarColors,
    getRecentCodes,
    openPicker,
    closePicker,
};
