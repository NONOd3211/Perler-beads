// editor.applyColorChange 回归测试
// 复现背景:曾因 recentCodes 直接赋值 ESM 只读 binding 抛 TypeError,导致改色无反应。
// jsdom 不实现 canvas,用 Proxy 把 ctx 任意方法/属性 mock 成 no-op。

import { describe, it, expect, beforeEach, vi } from 'vitest';
// render-bus 是 canvas 渲染边界,单元测试 mock 掉避免真实绘制
vi.mock('../public/js/render-bus.js', () => ({
    repaintCurrentMode: vi.fn(),
    recomputePreservingRefine: vi.fn(),
}));
import {
    attachDomRefs,
    setPalette,
    setBrand,
    setLastCellSize,
    setLastGridDims,
    setLastMergedGrid,
    clearManualRefine,
    recentCodes,
} from '../public/js/state.js';
import { BeadPalettes } from '../public/js/palettes.js';
import { applyColorChange } from '../public/js/editor.js';
import { getDisplayCode } from '../public/js/color.js';

function makeMockCtx() {
    const noop = () => {};
    return new Proxy(
        {},
        {
            get: (t, p) => (p in t ? t[p] : noop),
            set: (t, p, v) => {
                t[p] = v;
                return true;
            },
        }
    );
}
const mockCanvas = { width: 200, height: 200, getContext: () => makeMockCtx() };

function freshGrid() {
    return [
        [BeadPalettes.p221[0], BeadPalettes.p221[1]],
        [BeadPalettes.p221[2], BeadPalettes.p221[3]],
    ];
}

beforeEach(() => {
    attachDomRefs({ perlerCanvas: mockCanvas });
    setPalette(BeadPalettes.p221, 221);
    setBrand('MARD');
    setLastCellSize(20);
    setLastGridDims(2, 2);
    clearManualRefine();
});

describe('applyColorChange', () => {
    it('改写目标格颜色且不抛错', () => {
        const grid = freshGrid();
        setLastMergedGrid(grid);
        const newColor = BeadPalettes.p221[10];
        expect(() => applyColorChange(0, 0, newColor)).not.toThrow();
        expect(grid[0][0]).toBe(newColor);
    });

    it('把新色号推入最近色号列表', () => {
        const grid = freshGrid();
        setLastMergedGrid(grid);
        const newColor = BeadPalettes.p221[10];
        applyColorChange(0, 0, newColor);
        const code = getDisplayCode(BeadPalettes.p221[10], 'MARD');
        expect(recentCodes[0]).toBe(code);
    });

    it('连续改两格不互相破坏', () => {
        const grid = freshGrid();
        setLastMergedGrid(grid);
        applyColorChange(0, 0, BeadPalettes.p221[10]);
        applyColorChange(1, 1, BeadPalettes.p221[20]);
        expect(grid[0][0]).toBe(BeadPalettes.p221[10]);
        expect(grid[1][1]).toBe(BeadPalettes.p221[20]);
    });
});
