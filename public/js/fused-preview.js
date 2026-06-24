// js/fused-preview.js — 渲染调度层 — 查 BeadFuseEffects 注册表调用对应效果
// 各效果(plain / towel / 未来新效果)在 js/fuse-effects/<name>.js 自注册
// 对外接口:drawFused / repaintFused

import { BeadFuseEffects } from './fuse-effects/index.js';
import {
    fuseEffect,
    lastMergedGrid,
    lastCellSize,
    lastGridCols,
    lastGridRows,
    dom as stateDom,
} from './state.js';

export function drawFused(ctx, grid, cols, rows, cellSize) {
    const effect = fuseEffect || 'plain';
    const fn = BeadFuseEffects[effect] || BeadFuseEffects.plain;
    if (fn) fn(ctx, grid, cols, rows, cellSize);
}

export function repaintFused() {
    if (!lastMergedGrid) return;
    const perlerCanvas = stateDom.perlerCanvas;
    const ctx = perlerCanvas.getContext('2d');
    ctx.clearRect(0, 0, perlerCanvas.width, perlerCanvas.height);
    drawFused(ctx, lastMergedGrid, lastGridCols, lastGridRows, lastCellSize);
}

export const BeadFusedPreview = { drawFused, repaintFused };
