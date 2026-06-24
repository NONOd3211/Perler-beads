// js/fuse-effects/_shared.js — 共享工具:画一个圆角方块(模拟熨烫融合后的珠子形状)
// 边长 = cellSize * 1.1(让相邻方块重叠 10%,模拟融合)
// 圆角半径 = cellSize * 0.25(保留珠子感)
// 优先用 ctx.roundRect(现代浏览器),不支持时回退到 fillRect(实心方块,无圆角)

export function drawRoundRect(ctx, cx, cy, cellSize, fillStyle) {
    const size = cellSize * 1.1;
    const radius = cellSize * 0.25;
    const useRoundRect = typeof ctx.roundRect === 'function';
    ctx.fillStyle = fillStyle;
    if (useRoundRect) {
        ctx.beginPath();
        ctx.roundRect(cx - size / 2, cy - size / 2, size, size, radius);
        ctx.fill();
    } else {
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    }
}

export const BeadFuseShared = { drawRoundRect };
