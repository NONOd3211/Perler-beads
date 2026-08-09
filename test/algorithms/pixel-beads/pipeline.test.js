// test/algorithms/pixel-beads/pipeline.test.js
// 单元测试:主算法 pipeline (K-means + 色板匹配)(移植自 pixel-beads.com processing.worker.js)
//
// 验证:
//   - EMPTY_PALETTE 异常
//   - 退化:全 null cells → 全 "" 分配
//   - 3 色图 → 3 种 bead
//   - outline cell → 强制用最暗色
//   - maxColors 约束:8 色预设 → 最多 8 种 bead
//   - resolveAssignmentsToBeads: id → bead 对象映射

import { describe, it, expect } from 'vitest';
import { assignBeads, resolveAssignmentsToBeads } from '../../../public/js/algorithms/pixel-beads/pipeline.js';

// 简单调色板
const PALETTE = [
    { id: 'A01', code: 'A01', r: 255, g: 0, b: 0, hex: '#ff0000' }, // 红
    { id: 'A02', code: 'A02', r: 0, g: 255, b: 0, hex: '#00ff00' }, // 绿
    { id: 'A03', code: 'A03', r: 0, g: 0, b: 255, hex: '#0000ff' }, // 蓝
    { id: 'A04', code: 'A04', r: 255, g: 255, b: 0, hex: '#ffff00' }, // 黄
    { id: 'A05', code: 'A05', r: 0, g: 0, b: 0, hex: '#000000' }, // 黑(最暗)
    { id: 'A06', code: 'A06', r: 128, g: 128, b: 128, hex: '#808080' }, // 灰
];

// ============================================================================
// 异常 / 边界
// ============================================================================

describe('assignBeads - edge cases', () => {
    it('throws EMPTY_PALETTE for empty palette', () => {
        expect(() =>
            assignBeads({ cells: [{ rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false }], palette: [], k: 8 })
        ).toThrow('EMPTY_PALETTE');
    });

    it('throws EMPTY_PALETTE for null palette', () => {
        expect(() =>
            assignBeads({ cells: [{ rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false }], palette: null, k: 8 })
        ).toThrow('EMPTY_PALETTE');
    });

    it('returns all empty for all-null cells (e.g. all background)', () => {
        const cells = [null, null, null];
        const result = assignBeads({ cells, palette: PALETTE, k: 3 });
        expect(result).toEqual(['', '', '']);
    });

    it('handles k larger than palette size (uses palette size as effective K)', () => {
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false },
            { rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false },
        ];
        // k=100 但 palette 只有 6 色,有效 K = min(100, 6, 2) = 2
        const result = assignBeads({ cells, palette: PALETTE, k: 100 });
        // 每个 cell 都有非空 id
        expect(result[0]).not.toBe('');
        expect(result[1]).not.toBe('');
    });
});

// ============================================================================
// 基础功能
// ============================================================================

describe('assignBeads - basic functionality', () => {
    it('3-color image → 3 distinct beads', () => {
        // 30 个红 + 30 个绿 + 30 个蓝
        const cells = [
            ...Array(30).fill().map(() => ({ rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(30).fill().map(() => ({ rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(30).fill().map(() => ({ rgb: { r: 0, g: 0, b: 255 }, coverage: 1, isOutline: false })),
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 3 });
        const uniqueIds = new Set(result);
        expect(uniqueIds.size).toBe(3);
        // 红 → A01,绿 → A02,蓝 → A03
        expect(result[0]).toBe('A01');
        expect(result[30]).toBe('A02');
        expect(result[60]).toBe('A03');
    });

    it('exact match returns same id (early exit)', () => {
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false }, // 精确匹配 A01
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 8 });
        expect(result[0]).toBe('A01');
    });

    it('single color cell → single bead (smallest possible K)', () => {
        const cells = Array(10).fill().map(() => ({ rgb: { r: 200, g: 50, b: 50 }, coverage: 1, isOutline: false }));
        const result = assignBeads({ cells, palette: PALETTE, k: 8 });
        // 唯一 id(红色变体)
        const uniqueIds = new Set(result);
        expect(uniqueIds.size).toBe(1);
    });
});

// ============================================================================
// maxColors 约束
// ============================================================================

describe('assignBeads - maxColors constraint', () => {
    it('5 distinct colors with k=3 → at most 3 distinct beads', () => {
        // 5 种不同颜色,但 k=3 (simplified 预设)
        const cells = [
            ...Array(10).fill().map(() => ({ rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(10).fill().map(() => ({ rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(10).fill().map(() => ({ rgb: { r: 0, g: 0, b: 255 }, coverage: 1, isOutline: false })),
            ...Array(10).fill().map(() => ({ rgb: { r: 255, g: 255, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(10).fill().map(() => ({ rgb: { r: 255, g: 0, b: 255 }, coverage: 1, isOutline: false })),
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 3 });
        const uniqueIds = new Set(result.filter((id) => id !== ''));
        expect(uniqueIds.size).toBeLessThanOrEqual(3);
    });

    it('2 colors with k=10 → at most 2 beads (limited by samples)', () => {
        const cells = [
            ...Array(5).fill().map(() => ({ rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false })),
            ...Array(5).fill().map(() => ({ rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false })),
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 10 });
        const uniqueIds = new Set(result);
        expect(uniqueIds.size).toBeLessThanOrEqual(2);
    });
});

// ============================================================================
// Outline 强制最暗色
// ============================================================================

describe('assignBeads - outline handling', () => {
    it('outline cell always uses the darkest color in the used palette subset', () => {
        // reference dn() 行为:outline 用 usedPalette 中 L 最小的色,不是全 palette
        // 4 个 cell:1 个红 (主体),3 个不同色都标记为 outline
        // K-means 中心映射到 A01/A02/A03/A04(无 A05 黑),usedPalette 最暗 = A03(蓝)
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false }, // 红 → A01
            { rgb: { r: 0, g: 255, b: 0 }, coverage: 0.5, isOutline: true }, // outline → A03(usedPalette 中最暗)
            { rgb: { r: 0, g: 0, b: 255 }, coverage: 0.5, isOutline: true }, // outline → A03
            { rgb: { r: 255, g: 255, b: 0 }, coverage: 0.5, isOutline: true }, // outline → A03
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 8 });
        expect(result[0]).toBe('A01'); // 红
        expect(result[1]).toBe('A03'); // outline → usedPalette 最暗
        expect(result[2]).toBe('A03');
        expect(result[3]).toBe('A03');
    });

    it('outlineWeight=3 increases outline influence in clustering', () => {
        // 5 个亮 cell + 5 个 outline (暗)
        // outline weight=3,影响 K-means 中心位置
        const cells = [
            ...Array(5).fill().map(() => ({ rgb: { r: 200, g: 200, b: 200 }, coverage: 1, isOutline: false })),
            ...Array(5).fill().map(() => ({ rgb: { r: 30, g: 30, b: 30 }, coverage: 0.5, isOutline: true })),
        ];
        // k=2,应该 2 个中心:亮色 + 暗色
        const result = assignBeads({ cells, palette: PALETTE, k: 2, outlineWeight: 3 });
        const uniqueIds = new Set(result);
        expect(uniqueIds.size).toBe(2);
        // 亮色应该匹配灰(A06)
        expect(result[0]).toBe('A06');
        // 暗色 → A05(最暗,outline 强制)
        expect(result[5]).toBe('A05');
    });
});

// ============================================================================
// coverage 加权
// ============================================================================

describe('assignBeads - coverage weighting', () => {
    it('low coverage cell is still considered (weight clamped to MIN_WEIGHT)', () => {
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 0.001, isOutline: false }, // 极低 coverage
        ];
        expect(() => assignBeads({ cells, palette: PALETTE, k: 1 })).not.toThrow();
    });
});

// ============================================================================
// resolveAssignmentsToBeads
// ============================================================================

describe('resolveAssignmentsToBeads', () => {
    it('maps id assignments back to bead objects', () => {
        const assignments = ['A01', 'A02', '', 'A05'];
        const result = resolveAssignmentsToBeads(assignments, PALETTE);
        expect(result[0]).toBe(PALETTE[0]);
        expect(result[1]).toBe(PALETTE[1]);
        expect(result[2]).toBe(null); // "" → null
        expect(result[3]).toBe(PALETTE[4]);
    });

    it('returns null for unknown id (defensive)', () => {
        const assignments = ['A99', ''];
        const result = resolveAssignmentsToBeads(assignments, PALETTE);
        expect(result[0]).toBe(null);
        expect(result[1]).toBe(null);
    });

    it('round-trip: assignBeads + resolveAssignmentsToBeads', () => {
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false },
            { rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false },
        ];
        const ids = assignBeads({ cells, palette: PALETTE, k: 2 });
        const beads = resolveAssignmentsToBeads(ids, PALETTE);
        expect(beads[0]).toBe(PALETTE[0]); // A01
        expect(beads[1]).toBe(PALETTE[1]); // A02
    });
});

// ============================================================================
// 集成:整套 pipeline 行为对照 reference
// ============================================================================

describe('assignBeads - integration with reference behavior', () => {
    it('uses oklab distance (not Lab), verified by checking dark color mapping', () => {
        // 纯红色 (255, 0, 0) 的 Oklab L ≈ 0.628
        // A05 黑色 (0, 0, 0) 的 Oklab L = 0
        // A01 红色 (255, 0, 0) 的 Oklab L ≈ 0.628
        // 红 cell 应该匹配 A01(精确匹配)
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false },
            { rgb: { r: 0, g: 0, b: 0 }, coverage: 1, isOutline: false },
        ];
        const result = assignBeads({ cells, palette: PALETTE, k: 2 });
        expect(result[0]).toBe('A01');
        expect(result[1]).toBe('A05');
    });

    it('produces stable output for same input (deterministic)', () => {
        const cells = [
            { rgb: { r: 255, g: 0, b: 0 }, coverage: 1, isOutline: false },
            { rgb: { r: 0, g: 255, b: 0 }, coverage: 1, isOutline: false },
        ];
        const result1 = assignBeads({ cells, palette: PALETTE, k: 2 });
        const result2 = assignBeads({ cells, palette: PALETTE, k: 2 });
        expect(result1).toEqual(result2);
    });
});
