import { describe, it, expect, beforeEach } from 'vitest';

import {
    calculateColorDistance,
    getBlockColorForGrid,
    mergeSimilarColors,
    despeckleIsolatedCells,
    isTransparentCell,
    computeAlphaWeightedMean,
    pickOutlierCluster,
    computeBackgroundSamplesFromGridAuto,
    computeBackgroundSamplesFromGridPoints,
    BeadColor,
} from '../public/js/color.js';
import { rgbToOklab } from '../public/js/oklab.js';
import {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    pickSimilarColors,
} from '../public/js/editor.js';
import {
    setPalette,
    setTempCtx,
    editorHistory,
    editorFuture,
    lastMergedGrid,
    setLastMergedGrid,
    setRepaintCurrentMode,
    setLastGridDims,
} from '../public/js/state.js';
import { BeadPalettes } from '../public/js/palettes.js';

// 测试前初始化 palette(原 ui-core 职责),并在 beforeEach 重置 repaintCurrentMode 为 no-op
setPalette(BeadPalettes.p221, 221);
setRepaintCurrentMode(() => {}); // no-op stub,避免 editor.js undo/redo 报 undefined
setLastGridDims(0, 0);

// 每个 test 模拟的 tempCtx 需在 beforeEach 重置,避免污染
function mockTempCtx(data, w, h) {
    setTempCtx(null, { getImageData: () => ({ data, width: w, height: h }) });
}

// ---- 小工具:把 grid cell 工厂封装(避免每个 test 重复) ----
function mkCell(r, g, b, code) {
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return { r, g, b, hex, code };
}

describe('rgbToOklab', () => {
    it('converts (128,128,128) to near-neutral Oklab', () => {
        const o = rgbToOklab(128, 128, 128);
        expect(o.L).toBeCloseTo(0.598, 2);
        expect(o.a).toBeCloseTo(-0.001, 2);
        expect(o.b).toBeCloseTo(-0.001, 2);
    });
    it('converts primary red (255,0,0) to its Oklab vector', () => {
        const o = rgbToOklab(255, 0, 0);
        expect(o.L).toBeCloseTo(0.628, 2);
        expect(o.a).toBeCloseTo(0.225, 2);
        expect(o.b).toBeCloseTo(0.126, 2);
    });
    it('converts primary green (0,255,0) to its Oklab vector', () => {
        const o = rgbToOklab(0, 255, 0);
        expect(o.L).toBeCloseTo(0.866, 2);
        expect(o.a).toBeCloseTo(-0.234, 2);
        expect(o.b).toBeCloseTo(0.179, 2);
    });
    it('converts primary blue (0,0,255) to its Oklab vector', () => {
        const o = rgbToOklab(0, 0, 255);
        expect(o.L).toBeCloseTo(0.452, 2);
        expect(o.a).toBeCloseTo(-0.032, 2);
        expect(o.b).toBeCloseTo(-0.312, 2);
    });
});

describe('rgbToOklab cache', () => {
    it('returns same reference on repeated calls (cache hit)', () => {
        const a = rgbToOklab(173, 94, 232);
        const b = rgbToOklab(173, 94, 232);
        expect(b).toBe(a); // same reference, cache hit
    });
});

describe('calculateColorDistance', () => {
    it('is symmetric: d(A,B) === d(B,A) for 100 random pairs', () => {
        for (let i = 0; i < 100; i++) {
            const r1 = Math.floor(Math.random() * 256);
            const g1 = Math.floor(Math.random() * 256);
            const b1 = Math.floor(Math.random() * 256);
            const r2 = Math.floor(Math.random() * 256);
            const g2 = Math.floor(Math.random() * 256);
            const b2 = Math.floor(Math.random() * 256);
            const d1 = calculateColorDistance(r1, g1, b1, r2, g2, b2);
            const d2 = calculateColorDistance(r2, g2, b2, r1, g1, b1);
            expect(Math.abs(d1 - d2)).toBeLessThan(1e-9);
        }
    });

    it('returns 0 for identical points', () => {
        const samples = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [128, 128, 128],
            [200, 100, 50],
        ];
        for (const [r, g, b] of samples) {
            expect(calculateColorDistance(r, g, b, r, g, b)).toBe(0);
        }
    });
});

describe('getBlockColorForGrid', () => {
    // 测试间隔离:每次重置 tempCtx
    beforeEach(() => {
        // 不在此 beforeEach 重置 currentPalette — empty-palette 测试自己处理
    });

    it('returns { transparent: true } for fully-transparent cell (all α=0)', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4); // all 0
        const saved = mockSaveCtx();
        mockTempCtx(data, 4, 4);
        try {
            const result = getBlockColorForGrid(0, 0, 4, 4, 'dominant');
            expect(result.transparent).toBe(true);
        } finally {
            mockRestoreCtx(saved);
        }
    });

    it('returns α-weighted dominant for opaque cell (200 white vs 100 red → white)', () => {
        const data = new Uint8ClampedArray(300 * 4);
        for (let i = 0; i < 200; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 255;
        }
        for (let i = 200; i < 300; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }
        const saved = mockSaveCtx();
        mockTempCtx(data, 300, 1);
        try {
            const result = getBlockColorForGrid(0, 0, 300, 1, 'dominant');
            expect(result.transparent).not.toBe(true);
            expect(result.r).toBeGreaterThan(200);
            expect(result.g).toBeGreaterThan(200);
            expect(result.b).toBeGreaterThan(200);
        } finally {
            mockRestoreCtx(saved);
        }
    });

    it('returns k-means outlier for alpha-weighted mode on edge cell', () => {
        // 边格:大面积 white + 小块 red,outlier 选红(距 white globalMean Oklab 距离最大)
        const data = new Uint8ClampedArray(450 * 4);
        for (let i = 0; i < 200; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 255;
        }
        for (let i = 200; i < 400; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 64;
        }
        for (let i = 400; i < 450; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }
        const saved = mockSaveCtx();
        mockTempCtx(data, 450, 1);
        try {
            const result = getBlockColorForGrid(0, 0, 450, 1, 'alpha-weighted');
            expect(result.transparent).not.toBe(true);
            const maxChroma = Math.max(
                Math.abs(result.r - result.g),
                Math.abs(result.g - result.b),
                Math.abs(result.r - result.b)
            );
            expect(maxChroma).toBeGreaterThan(30); // not neutral gray
        } finally {
            mockRestoreCtx(saved);
        }
    });

    it('logs to console.error and falls back to dominant for unknown mode', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 100;
            data[i + 1] = 150;
            data[i + 2] = 200;
            data[i + 3] = 255;
        }
        const savedCtx = mockSaveCtx();
        const originalError = console.error;
        let captured = null;
        console.error = (...args) => {
            captured = args;
        };
        mockTempCtx(data, 4, 4);
        try {
            const result = getBlockColorForGrid(0, 0, 4, 4, 'bogus-mode');
            expect(captured).not.toBeNull();
            expect(String(captured[0])).toContain('未知的 mode');
            expect(result.transparent).not.toBe(true);
            expect(typeof result.r).toBe('number');
        } finally {
            console.error = originalError;
            mockRestoreCtx(savedCtx);
        }
    });

    it('returns { transparent: true } for null palette (defensive default)', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 100;
            data[i + 1] = 150;
            data[i + 2] = 200;
            data[i + 3] = 255;
        }
        const savedCtx = mockSaveCtx();
        const savedPalette = (BeadPalettes && BeadPalettes.p221) || null;
        mockTempCtx(data, 4, 4);
        setPalette(null);
        try {
            const result = getBlockColorForGrid(0, 0, 4, 4, 'dominant');
            expect(result).toEqual({ transparent: true });
        } finally {
            mockRestoreCtx(savedCtx);
            setPalette(savedPalette, 221);
        }
    });

    it('sourceImageData 路径:整图 subarray 与旧路径等价 + 切片反映 (x0, y0, w, h)', () => {
        // 4x4 整图:左上 2x2 红色,其他全透明
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const i = (y * 4 + x) * 4;
                if (x < 2 && y < 2) {
                    data[i] = 255;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                    data[i + 3] = 255; // 红 α=255
                } else {
                    data[i + 3] = 0; // 透明(全 0)
                }
            }
        }
        const sourceImageData = { data, width: 4, height: 4 };

        // 旧路径(整图 4x4):mock 返回整 4x4 buffer(64 字节)→ 遍历 16 像素,
        // 4 红 + 12 透明(α=0 跳过)→ dominant 红
        const saved = mockSaveCtx();
        mockTempCtx(data, 4, 4);
        let resultOld;
        try {
            resultOld = getBlockColorForGrid(0, 0, 4, 4, 'dominant');
        } finally {
            mockRestoreCtx(saved);
        }

        // 新路径(全图):subarray(0, 64) = 整 data,应当与旧路径结果一致
        const resultFull = getBlockColorForGrid(0, 0, 4, 4, 'dominant', sourceImageData);
        expect(resultFull.r).toBe(resultOld.r);
        expect(resultFull.g).toBe(resultOld.g);
        expect(resultFull.b).toBe(resultOld.b);
        expect(resultFull.code).toBe(resultOld.code);

        // 新路径(左上 2x2):subarray(0, 16) = 4 像素全红 → 红色 bead
        const resultTL = getBlockColorForGrid(0, 0, 2, 2, 'dominant', sourceImageData);
        expect(resultTL.r).toBeGreaterThan(200); // 红色 bead 的 r 高
        expect(resultTL.transparent).toBeUndefined(); // bead color 没有 transparent 字段

        // 新路径(右下 2x2):subarray(40, 56) = 4 像素全透明 → { transparent: true }
        const resultBR = getBlockColorForGrid(2, 2, 2, 2, 'dominant', sourceImageData);
        expect(resultBR.transparent).toBe(true);

        // 切片必须反映 cell 位置:左上(bead) ≠ 右下(transparent) → code 字段不同
        expect(resultTL.code).toBeDefined();
        expect(resultTL.code).not.toBe(resultBR.code);
    });

    it('sourceImageData 路径:跨行 cell 不读到下一行开头(避免整图颜色错乱)', () => {
        // 8x2 图:行 0 全红,行 1 全蓝
        // cell (x0=6, y0=0, w=4, h=2) 期望 = 行 0 x=6-7 (2 红) + 行 1 x=6-7 (2 蓝) → 平局
        // 旧实现直接 subarray(start, start+w*h*4) 会跨过行边界把行 1 x=0-5 (6 蓝) 错算进来 → 蓝胜
        const W = 8,
            H = 2;
        const data = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                data[i + 3] = 255;
                if (y === 0) {
                    data[i] = 255;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                } else {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 255;
                }
            }
        const sourceImageData = { data, width: W, height: H };

        // 与 tempCtx 旧路径对比 — 旧路径用模拟 canvas getImageData 越界读默认 α=0
        const saved = mockSaveCtx();
        mockTempCtx(data, W, H);
        let rOld;
        try {
            rOld = getBlockColorForGrid(6, 0, 4, 2, 'dominant');
        } finally {
            mockRestoreCtx(saved);
        }
        const rNew = getBlockColorForGrid(6, 0, 4, 2, 'dominant', sourceImageData);

        // 跨行 cell 必须与旧路径一致(2 红 + 2 蓝 → Map 顺序稳定 → 红胜)
        expect(rNew.code).toBe(rOld.code);
        expect(rNew.r).toBe(rOld.r);
        expect(rNew.g).toBe(rOld.g);
        expect(rNew.b).toBe(rOld.b);

        // 行尾越界 cell (x0=7, w=3):期望 1 红 + 2 透明 → 红 bead
        // 旧实现 subarray 会读到行 1 x=0-1 的 2 蓝 → 蓝胜
        const saved2 = mockSaveCtx();
        mockTempCtx(data, W, H);
        let rOldOOB;
        try {
            rOldOOB = getBlockColorForGrid(7, 0, 3, 1, 'dominant');
        } finally {
            mockRestoreCtx(saved2);
        }
        const rNewOOB = getBlockColorForGrid(7, 0, 3, 1, 'dominant', sourceImageData);
        expect(rNewOOB.code).toBe(rOldOOB.code);
        expect(rNewOOB.transparent).toBeUndefined(); // 1 红 α=255 不透明
    });
});

describe('BeadEditor.pickSimilarColors', () => {
    it('returns up to N colors sorted by ascending Oklab distance, excluding the input color', () => {
        const palette = BeadPalettes.p291;
        const a04 = palette.find((c) => c.code === 'A04') || palette[0];
        const result = pickSimilarColors(a04, palette, 8);
        expect(result).toHaveLength(8);
        for (const c of result) {
            expect(c.hex).not.toBe(a04.hex);
            expect(c.transparent).not.toBe(true);
        }
        for (let i = 1; i < result.length; i++) {
            const dPrev = calculateColorDistance(
                a04.r,
                a04.g,
                a04.b,
                result[i - 1].r,
                result[i - 1].g,
                result[i - 1].b
            );
            const dCurr = calculateColorDistance(
                a04.r,
                a04.g,
                a04.b,
                result[i].r,
                result[i].g,
                result[i].b
            );
            expect(dPrev).toBeLessThanOrEqual(dCurr);
        }
    });
});

describe('pickOutlierCluster', () => {
    it('returns the single cluster when only one is given', () => {
        const c = { center: { r: 255, g: 255, b: 255 }, alphaWeight: 100, pixelCount: 10 };
        const gm = { r: 255, g: 255, b: 255 };
        expect(pickOutlierCluster([c], gm)).toBe(c);
    });

    it('falls back to max α-weight cluster when outlier < 1% threshold', () => {
        // white cluster α 占 99.87%,red 占 0.13%(< 1%)→ 回退到 white
        const whiteCluster = {
            center: { r: 255, g: 255, b: 255 },
            alphaWeight: 101445,
            pixelCount: 399,
        };
        const redCluster = { center: { r: 255, g: 0, b: 0 }, alphaWeight: 128, pixelCount: 1 };
        const data = new Uint8ClampedArray(400 * 4);
        for (let i = 0; i < 399; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 255;
        }
        for (let i = 399; i < 400; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 128;
        }
        const realGm = computeAlphaWeightedMean(data);
        const result = pickOutlierCluster([whiteCluster, redCluster], realGm);
        expect(result).toBe(whiteCluster);
    });
});

describe('isTransparentCell', () => {
    it('returns true when α_max < 30', () => {
        const data = new Uint8ClampedArray(2 * 2 * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 20;
        }
        expect(isTransparentCell(data)).toBe(true);
    });
    it('returns false at α_max=30 boundary', () => {
        const data = new Uint8ClampedArray(2 * 2 * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 30;
        }
        expect(isTransparentCell(data)).toBe(false);
    });
});

describe('BeadEditor history', () => {
    beforeEach(() => {
        editorHistory.length = 0;
        editorFuture.length = 0;
        setLastMergedGrid(null);
        setRepaintCurrentMode(() => {}); // no-op stub
    });

    it('canUndo/canRedo reflect stack state', () => {
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(false);
        // diff 形式:{row, col, oldCell, newCell}
        editorHistory.push({
            row: 0,
            col: 0,
            oldCell: mkCell(1, 1, 1, 'X'),
            newCell: mkCell(2, 2, 2, 'Y'),
        });
        expect(canUndo()).toBe(true);
        expect(canRedo()).toBe(false);
    });

    it('pushHistory caps history at 50 entries (FIFO shift)', () => {
        for (let i = 0; i < 55; i++) {
            pushHistory(0, 0, mkCell(i, i, i, 'OLD' + i), mkCell(i, i, i, 'NEW' + i));
        }
        expect(editorHistory).toHaveLength(50);
        // 前 5 条被 shift 掉,新第 0 条是第 5 次推入的(对应 i=5)
        expect(editorHistory[0].newCell.code).toBe('NEW5');
    });

    it('pushHistory clears redo (new edit invalidates redo path)', () => {
        editorFuture.push({
            row: 0,
            col: 0,
            oldCell: mkCell(1, 1, 1, 'OLD'),
            newCell: mkCell(2, 2, 2, 'NEW'),
        });
        pushHistory(0, 0, mkCell(3, 3, 3, 'A'), mkCell(4, 4, 4, 'B'));
        expect(editorFuture).toHaveLength(0);
    });

    it('undo pops history, writes oldCell back, pushes current diff to future', () => {
        // 用户应用 newColor 后,grid = [[NEW]]
        setLastMergedGrid([[mkCell(99, 99, 99, 'NEW')]]);
        // 推 diff(模拟 applyColorChange 刚调过)
        pushHistory(0, 0, mkCell(1, 1, 1, 'OLD'), mkCell(99, 99, 99, 'NEW'));
        undo();
        // undo 后 grid 应回到 OLD
        expect(lastMergedGrid[0][0].code).toBe('OLD');
        // future 应当推入 diff(允许 redo 反向)
        expect(editorFuture).toHaveLength(1);
        expect(editorFuture[0].row).toBe(0);
        expect(editorFuture[0].col).toBe(0);
        expect(editorFuture[0].oldCell.code).toBe('OLD');
        expect(editorFuture[0].newCell.code).toBe('NEW');
        // history 已 pop
        expect(editorHistory).toHaveLength(0);
    });

    it('redo pops future, writes newCell back, pushes diff to history', () => {
        // undo 后的状态:grid = [[OLD]],future = [diff]
        setLastMergedGrid([[mkCell(1, 1, 1, 'OLD')]]);
        editorFuture.push({
            row: 0,
            col: 0,
            oldCell: mkCell(1, 1, 1, 'OLD'),
            newCell: mkCell(99, 99, 99, 'NEW'),
        });
        redo();
        // redo 后 grid 应回到 NEW
        expect(lastMergedGrid[0][0].code).toBe('NEW');
        // history 推回 diff
        expect(editorHistory).toHaveLength(1);
        expect(editorHistory[0].newCell.code).toBe('NEW');
        expect(editorFuture).toHaveLength(0);
    });

    it('undo/redo on empty stacks are no-ops', () => {
        setLastMergedGrid([[mkCell(1, 2, 3, 'STAY')]]);
        let calls = 0;
        setRepaintCurrentMode(() => {
            calls++;
        });
        undo();
        redo();
        expect(lastMergedGrid[0][0].code).toBe('STAY');
        expect(calls).toBe(0);
    });
});

describe('mergeSimilarColors', () => {
    it('threshold=0 produces output === input (modulo transparent)', () => {
        const A = mkCell(255, 0, 0, 'A');
        const B = mkCell(0, 255, 0, 'B');
        const C = mkCell(0, 0, 255, 'C');
        const D = mkCell(255, 255, 0, 'D');
        const E = mkCell(0, 255, 255, 'E');
        const F = mkCell(255, 0, 255, 'F');
        const grid = [
            [A, A, B, B],
            [A, C, B, D],
            [E, C, F, D],
            [E, E, F, D],
        ];
        const out1 = mergeSimilarColors(grid, 4, 4, 0);
        const out2 = mergeSimilarColors(grid, 4, 4, 0);
        // 双向:输出 JSON 等价输入
        expect(JSON.stringify(out1)).toBe(JSON.stringify(grid));
        // 确定性
        expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
});

describe('despeckleIsolatedCells', () => {
    it('leaves grid unchanged when no cell has 4 same-color neighbors', () => {
        // 3x3: 全部不同 code → 没有 4 邻居,也不会有 3+ 一致
        const grid = [
            [mkCell(255, 0, 0, 'A'), mkCell(0, 255, 0, 'B'), mkCell(0, 0, 255, 'C')],
            [mkCell(255, 255, 0, 'D'), mkCell(0, 255, 255, 'E'), mkCell(255, 0, 255, 'F')],
            [mkCell(128, 64, 32, 'G'), mkCell(64, 32, 128, 'H'), mkCell(32, 128, 64, 'I')],
        ];
        const result = despeckleIsolatedCells(grid, 3, 3);
        expect(JSON.stringify(result)).toBe(JSON.stringify(grid));
    });
});

describe('BeadColor.averageColor removed', () => {
    it('averageColor is undefined (D9: hard-removed in earlier change)', () => {
        expect(BeadColor.averageColor).toBeUndefined();
    });
});

describe('α-weighted dominant — distinguishing edge case', () => {
    it('200 red@255 + 1 white@255 + 1000 white@127 → picks white (α-weighted)', () => {
        // 旧实现(a<128 过滤)会选 red;α 加权应选 white
        const data = new Uint8ClampedArray(1201 * 4);
        for (let i = 0; i < 200; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
            data[i * 4 + 3] = 255;
        }
        for (let i = 200; i < 201; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 255;
        }
        for (let i = 201; i < 1201; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 127;
        }
        const saved = mockSaveCtx();
        mockTempCtx(data, 1201, 1);
        try {
            const result = getBlockColorForGrid(0, 0, 1201, 1, 'dominant');
            expect(result.transparent).not.toBe(true);
            expect(result.r).toBeGreaterThan(200);
            expect(result.g).toBeGreaterThan(200);
            expect(result.b).toBeGreaterThan(200);
        } finally {
            mockRestoreCtx(saved);
        }
    });
});

// ---- helpers:tempCtx 保存/恢复(原 IIFE 桥接靠 window.tempCtx 直接赋值;ESM 化后改为 setTempCtx) ----
function mockSaveCtx() {
    // 保存当前 ctx 以便 finally 还原(简化:直接调 setTempCtx(null,null),因为 mockTempCtx 会重新设置)
    return null; // 本测试套件每个 test 都自管 mockTempCtx,无需保存
}
function mockRestoreCtx(_saved) {
    setTempCtx(null, null);
}

describe('computeBackgroundSamplesFromGridAuto', () => {
    function mkCell(r, g, b) {
        return { r, g, b, transparent: false, hex: '#000', code: 'X' };
    }
    function mkTransparent() {
        return { transparent: true };
    }
    function mkUniformGrid(cols, rows, color) {
        const grid = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => mkCell(color.r, color.g, color.b))
        );
        return grid;
    }

    it('4 角同色 grid:返回 [{r,g,b}] 单色', () => {
        const grid = mkUniformGrid(52, 52, { r: 255, g: 255, b: 255 });
        const samples = computeBackgroundSamplesFromGridAuto(grid, 52, 52);
        expect(samples).toHaveLength(1);
        expect(samples[0].r).toBe(255);
        expect(samples[0].g).toBe(255);
        expect(samples[0].b).toBe(255);
    });

    it('1 角被占(左上红):返回 1 个白样本(白色 count=3 >=2)', () => {
        // 4 角:左上红,其他白 → 红 count=1,白 count=3 → 只返回 [白]
        const grid = mkUniformGrid(52, 52, { r: 255, g: 255, b: 255 });
        grid[0][0] = mkCell(255, 0, 0); // 左上红
        const samples = computeBackgroundSamplesFromGridAuto(grid, 52, 52);
        expect(samples).toHaveLength(1);
        expect(samples[0].r).toBe(255);
        expect(samples[0].g).toBe(255);
        expect(samples[0].b).toBe(255);
    });

    it('4 角全异色:fallback 返回 4 个角单色', () => {
        // 4 角:红/绿/蓝/黄 → 各 count=1 → fallback 全部 4 角
        const grid = mkUniformGrid(52, 52, { r: 0, g: 0, b: 0 });
        grid[0][0] = mkCell(255, 0, 0); // 左上红
        grid[0][51] = mkCell(0, 255, 0); // 右上绿
        grid[51][0] = mkCell(0, 0, 255); // 左下蓝
        grid[51][51] = mkCell(255, 255, 0); // 右下黄
        const samples = computeBackgroundSamplesFromGridAuto(grid, 52, 52);
        expect(samples).toHaveLength(4);
    });

    it('α 透明角被过滤:3 白 + 1 透明 → 返回 [白]', () => {
        const grid = mkUniformGrid(52, 52, { r: 255, g: 255, b: 255 });
        grid[0][0] = mkTransparent(); // 左上透明
        const samples = computeBackgroundSamplesFromGridAuto(grid, 52, 52);
        expect(samples).toHaveLength(1);
        expect(samples[0].r).toBe(255);
    });

    it('全透明 grid:返回 []', () => {
        const grid = Array.from({ length: 10 }, () =>
            Array.from({ length: 10 }, () => mkTransparent())
        );
        const samples = computeBackgroundSamplesFromGridAuto(grid, 10, 10);
        expect(samples).toEqual([]);
    });
});

describe('computeBackgroundSamplesFromGridPoints', () => {
    function mkCell(r, g, b) {
        return { r, g, b, transparent: false, hex: '#000', code: 'X' };
    }
    function mkTransparent() {
        return { transparent: true };
    }
    function mkUniformGrid(cols, rows, color) {
        const grid = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => mkCell(color.r, color.g, color.b))
        );
        return grid;
    }

    it('单点击白区 cell:返回 [{255,255,255}]', () => {
        const grid = mkUniformGrid(20, 20, { r: 255, g: 255, b: 255 });
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [{ col: 5, row: 5 }],
            12,
            20,
            20
        );
        expect(samples).toHaveLength(1);
        expect(samples[0].r).toBeGreaterThan(200);
    });

    it('BFS 不跨色界:左白右红 grid,点在白侧 → 仅白样本', () => {
        // 20x5 grid:col < 10 白,col >= 10 红
        const grid = Array.from({ length: 5 }, () =>
            Array.from({ length: 20 }, (__, c) => {
                if (c < 10) return mkCell(255, 255, 255);
                return mkCell(255, 0, 0);
            })
        );
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [{ col: 2, row: 2 }],
            12,
            20,
            5
        );
        expect(samples).toHaveLength(1);
        expect(samples[0].r).toBeGreaterThan(200);
        expect(samples[0].g).toBeGreaterThan(200);
        expect(samples[0].b).toBeGreaterThan(200);
    });

    it('重复点 dedup:3 个同点 → 只 1 个样本', () => {
        const grid = mkUniformGrid(20, 20, { r: 200, g: 200, b: 200 });
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [
                { col: 5, row: 5 },
                { col: 5, row: 5 },
                { col: 5, row: 5 },
            ],
            12,
            20,
            20
        );
        expect(samples).toHaveLength(1);
    });

    it('越界点 clip:col=-1,row=999 → 跳过(无效)', () => {
        const grid = mkUniformGrid(10, 10, { r: 100, g: 100, b: 100 });
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [
                { col: -1, row: 5 },
                { col: 5, row: 999 },
            ],
            12,
            10,
            10
        );
        expect(samples).toEqual([]);
    });

    it('透明种子:跳过该点', () => {
        const grid = Array.from({ length: 10 }, () =>
            Array.from({ length: 10 }, () => mkTransparent())
        );
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [
                { col: 5, row: 5 },
                { col: 3, row: 3 },
            ],
            12,
            10,
            10
        );
        expect(samples).toEqual([]);
    });

    it('BFS 5000 上限:大 grid 触发 alert("采样区过大")', () => {
        // 100x100 全同色 grid,点击中心 → BFS 收集 ≥ 5000 cells → alert
        const grid = mkUniformGrid(100, 100, { r: 255, g: 255, b: 255 });
        const originalAlert = global.alert;
        let alerted = null;
        global.alert = (msg) => {
            alerted = msg;
        };
        try {
            const samples = computeBackgroundSamplesFromGridPoints(
                grid,
                [{ col: 50, row: 50 }],
                12,
                100,
                100
            );
            // 100x100 = 10000 cells,> 5000 → 触发 alert
            expect(alerted).toBe('采样区过大');
            expect(samples.length).toBeGreaterThan(0);
        } finally {
            global.alert = originalAlert;
        }
    });

    it('多不同色点:返回多个样本(白/红/蓝各 1)', () => {
        // 30x10 grid:col 0-9 白,col 10-19 红,col 20-29 蓝
        const grid = Array.from({ length: 10 }, () =>
            Array.from({ length: 30 }, (__, c) => {
                if (c < 10) return mkCell(255, 255, 255);
                if (c < 20) return mkCell(255, 0, 0);
                return mkCell(0, 0, 255);
            })
        );
        const samples = computeBackgroundSamplesFromGridPoints(
            grid,
            [
                { col: 2, row: 5 },
                { col: 15, row: 5 },
                { col: 25, row: 5 },
            ],
            12,
            30,
            10
        );
        expect(samples).toHaveLength(3);
    });
});
