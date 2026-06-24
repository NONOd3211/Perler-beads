// js/fuse-effects/towel.js — 毛巾烫:基础圆角方块 + 毛绒噪点叠加
// 噪点参数:每格 28 个,噪点尺寸 = max(1, cellSize * 0.1)
// 确定性伪随机:同一位置每次重绘噪点位置一致,避免闪烁

import { BeadFuseEffects } from './index.js';
import { BeadFuseShared } from './_shared.js';

function noiseRand(seed) {
    let h = seed | 0;
    h = (h ^ (h << 13)) | 0;
    h = (h * 15731 + 789221) | 0;
    h = (h ^ (h >>> 16)) | 0;
    return ((h & 0x7fffffff) % 1000) / 1000;
}

export function drawFusedTowel(ctx, grid, cols, rows, cellSize) {
    const noiseCount = 28;
    const noiseSize = Math.max(1, cellSize * 0.1);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = grid[row][col];
            if (cell.transparent) continue;
            const cx = col * cellSize + cellSize / 2;
            const cy = row * cellSize + cellSize / 2;
            const baseR = cell.r,
                baseG = cell.g,
                baseB = cell.b;

            BeadFuseShared.drawRoundRect(ctx, cx, cy, cellSize, cell.hex);

            for (let i = 0; i < noiseCount; i++) {
                const seed = (col * 73856093) ^ (row * 19349663) ^ (i * 83492791);
                const rx = noiseRand(seed);
                const ry = noiseRand(seed + 1);
                const rb = noiseRand(seed + 2);
                const nx = col * cellSize + rx * cellSize;
                const ny = row * cellSize + ry * cellSize;
                const offset = rb < 0.7 ? -22 : 14;
                const r = Math.max(0, Math.min(255, baseR + offset));
                const g = Math.max(0, Math.min(255, baseG + offset));
                const b = Math.max(0, Math.min(255, baseB + offset));
                ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                ctx.fillRect(nx, ny, noiseSize, noiseSize);
            }
        }
    }
}

BeadFuseEffects.towel = drawFusedTowel;
