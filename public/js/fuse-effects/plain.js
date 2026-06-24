// js/fuse-effects/plain.js — 普通烫:只画基础圆角方块,无附加纹理
import { BeadFuseEffects } from './index.js';
import { BeadFuseShared } from './_shared.js';

export function drawFusedPlain(ctx, grid, cols, rows, cellSize) {
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = grid[row][col];
            if (cell.transparent) continue;
            const cx = col * cellSize + cellSize / 2;
            const cy = row * cellSize + cellSize / 2;
            BeadFuseShared.drawRoundRect(ctx, cx, cy, cellSize, cell.hex);
        }
    }
}

BeadFuseEffects.plain = drawFusedPlain;
