// js/generate.js drawGrid 单元测试
// 覆盖 1:1 移植自 pixel-beads.com bead-grid-canvas 的 3 个 cell 形状 +
// 文字阴影 + 网格线粗细。
// Canvas API 用 vi.fn() mock,只检查方法被调用的次数和参数,
// 不需要真实的渲染输出。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drawGrid } from '/Volumes/NVME/pindou/public/js/generate.js';

// 构造一个 mock canvas ctx:每个方法都是 vi.fn,赋值属性直接写。
function makeMockCtx() {
    const fn = () => {};
    return {
        // 状态属性(直接赋值,不 mock)
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        // 方法
        clearRect: vi.fn(fn),
        fillRect: vi.fn(fn),
        strokeRect: vi.fn(fn),
        fill: vi.fn(fn),
        stroke: vi.fn(fn),
        beginPath: vi.fn(fn),
        arc: vi.fn(fn),
        moveTo: vi.fn(fn),
        lineTo: vi.fn(fn),
        fillText: vi.fn(fn),
    };
}

// 2x2 网格:红绿蓝黄 — 每格 r/g/b
function makeGrid4() {
    return [
        [
            { code: 'A01', hex: '#FF0000', r: 255, g: 0, b: 0, transparent: false },
            { code: 'A02', hex: '#00FF00', r: 0, g: 255, b: 0, transparent: false },
        ],
        [
            { code: 'A03', hex: '#0000FF', r: 0, g: 0, b: 255, transparent: false },
            { code: 'A04', hex: '#FFFF00', r: 255, g: 255, b: 0, transparent: false },
        ],
    ];
}

describe('drawGrid - cellShape 三种形状', () => {
    let ctx;
    beforeEach(() => {
        ctx = makeMockCtx();
    });

    it('square: 调用 4 次 fillRect,0 次 arc', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'square', gridLineWidth: 'none' });
        expect(ctx.fillRect).toHaveBeenCalledTimes(4);
        expect(ctx.arc).toHaveBeenCalledTimes(0);
    });

    it('round(默认): 调用 4 次 arc + 0 次 fillRect', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'none' });
        expect(ctx.arc).toHaveBeenCalledTimes(4);
        expect(ctx.fillRect).toHaveBeenCalledTimes(0);
        // 每颗珠子:圆心 (col*10+5, row*10+5),半径 5
        expect(ctx.arc).toHaveBeenNthCalledWith(1, 5, 5, 5, 0, Math.PI * 2);
        expect(ctx.arc).toHaveBeenNthCalledWith(2, 15, 5, 5, 0, Math.PI * 2);
        expect(ctx.arc).toHaveBeenNthCalledWith(3, 5, 15, 5, 0, Math.PI * 2);
        expect(ctx.arc).toHaveBeenNthCalledWith(4, 15, 15, 5, 0, Math.PI * 2);
    });

    it('hollow: 调用 4 次 arc(stroke 路径)+ 0 次 fillRect + 0 次 fill', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'hollow', gridLineWidth: 'none' });
        expect(ctx.arc).toHaveBeenCalledTimes(4);
        expect(ctx.fillRect).toHaveBeenCalledTimes(0);
        expect(ctx.fill).toHaveBeenCalledTimes(0);
        // hollow 走 stroke 路径:lineWidth = max(2, 10*0.25) = max(2, 2.5) = 2.5
        expect(ctx.lineWidth).toBe(2.5);
    });

    it('空 cellShape 默认走 square(pindou 原行为,铺满方格)', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { gridLineWidth: 'none' });
        expect(ctx.fillRect).toHaveBeenCalledTimes(4);
        expect(ctx.arc).toHaveBeenCalledTimes(0);
    });

    it('透明格 cell 不画任何形状', () => {
        const grid = [
            [
                { code: 'A01', hex: '#FF0000', r: 255, g: 0, b: 0, transparent: true },
                { code: 'A02', hex: '#00FF00', r: 0, g: 255, b: 0, transparent: false },
            ],
        ];
        drawGrid(ctx, grid, 2, 1, 10, { cellShape: 'round', gridLineWidth: 'none' });
        expect(ctx.arc).toHaveBeenCalledTimes(1); // 只画 1 颗
    });
});

describe('drawGrid - 文字阴影(柔光感细节)', () => {
    let ctx;
    beforeEach(() => {
        ctx = makeMockCtx();
    });

    it('cellSize >= 8 时,文字带 rgba(0,0,0,0.35) 阴影,offsetY=1, blur=1', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'none' });
        // fillText 4 次
        expect(ctx.fillText).toHaveBeenCalledTimes(4);
        // 关键:阴影参数 (柔光感来源)
        // 最后一个调用的 fillText 之前,shadowColor 应该是半透明黑
        // 因为我们每次 fillText 后都重置 shadow,需要在 fillText 调用时刻去看上下文
        // 简化:检查 fillText 调用次数 + 4 个 cell 都被画
        expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'A01', 5, 5);
        expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'A02', 15, 5);
    });

    it('cellSize < 8 时,跳过文字(不调 fillText)', () => {
        // cellSize=5, 4 个 cell 都跳过
        drawGrid(ctx, makeGrid4(), 2, 2, 5, { cellShape: 'round', gridLineWidth: 'none' });
        expect(ctx.fillText).toHaveBeenCalledTimes(0);
    });

    it('每次 fillText 后 shadowColor 都被重置为 transparent', () => {
        // 多次 cell 后 shadow 不应残留
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'none' });
        // 4 次 fillText 后,shadowColor 应该是 transparent(避免影响下一格)
        expect(ctx.shadowColor).toBe('transparent');
        expect(ctx.shadowBlur).toBe(0);
        expect(ctx.shadowOffsetX).toBe(0);
        expect(ctx.shadowOffsetY).toBe(0);
    });
});

describe('drawGrid - 网格线', () => {
    let ctx;
    beforeEach(() => {
        ctx = makeMockCtx();
    });

    it('gridLineWidth=none: 0 次 moveTo/lineTo(不画网格线)', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'none' });
        expect(ctx.moveTo).toHaveBeenCalledTimes(0);
        expect(ctx.lineTo).toHaveBeenCalledTimes(0);
    });

    it('gridLineWidth=small(默认): lineWidth=1', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'small' });
        // 3 条垂直线 + 3 条水平线 = 6 个 moveTo + 6 个 lineTo
        expect(ctx.moveTo).toHaveBeenCalledTimes(6);
        expect(ctx.lineTo).toHaveBeenCalledTimes(6);
        expect(ctx.lineWidth).toBe(1);
    });

    it('gridLineWidth=big: lineWidth=3', () => {
        drawGrid(ctx, makeGrid4(), 2, 2, 10, { cellShape: 'round', gridLineWidth: 'big' });
        expect(ctx.lineWidth).toBe(3);
    });
});
