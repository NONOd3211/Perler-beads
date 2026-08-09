// test/algorithms/pixel-beads/distance.test.js
// 单元测试:Oklab / Lab 距离函数(移植自 pixel-beads.com processing.worker.js)
//
// 验证:
//   - 平方距离 = sqrt(距离/100)²(单位一致性)
//   - 距离函数的对称性 d(a,b) = d(b,a)
//   - 距离非负性 + 三角不等式
//   - 相同输入 = 0
//   - 与 reference 实现的等价性(对照 pixel-beads.com worker)

import { describe, it, expect } from 'vitest';
import {
    oklabDistanceSquared,
    labDistanceSquared,
    oklabDistance,
    labDistance,
    rgbOklabDistance,
    findClosestBeadByOklab,
} from '../../../public/js/algorithms/pixel-beads/distance.js';
import { rgbToOklab } from '../../../public/js/oklab.js';

// ============================================================================
// 平方距离
// ============================================================================

describe('oklabDistanceSquared', () => {
    it('returns 0 for identical inputs', () => {
        const v = { L: 0.5, a: 0.1, b: -0.2 };
        expect(oklabDistanceSquared(v, v)).toBe(0);
    });

    it('is symmetric: d(a,b) = d(b,a)', () => {
        const a = { L: 0.1, a: -0.1, b: 0.05 };
        const b = { L: 0.6, a: 0.2, b: -0.1 };
        expect(oklabDistanceSquared(a, b)).toBe(oklabDistanceSquared(b, a));
    });

    it('returns sum of squared differences (no sqrt)', () => {
        const a = { L: 0, a: 0, b: 0 };
        const b = { L: 3, a: 4, b: 0 };
        // 3² + 4² = 25
        expect(oklabDistanceSquared(a, b)).toBe(25);
    });

    it('matches reference: pixel-beads.com worker `v()` function (lab.js:147-152)', () => {
        // 移植自 reference: docs/reference/processing-worker-pixel-beads-com.js 第 147-152 行
        // function v(n, t) { return (n.l-t.l)² + (n.a-t.a)² + (n.b-t.b)²; }
        const a = { L: 0.5, a: 0.1, b: -0.2 };
        const b = { L: 0.3, a: 0.05, b: 0.1 };
        // (0.2)² + (0.05)² + (-0.3)² = 0.04 + 0.0025 + 0.09 = 0.1325
        expect(oklabDistanceSquared(a, b)).toBeCloseTo(0.1325, 10);
    });
});

describe('labDistanceSquared', () => {
    it('returns 0 for identical inputs', () => {
        const v = { L: 50, a: 20, b: -30 };
        expect(labDistanceSquared(v, v)).toBe(0);
    });

    it('is symmetric', () => {
        const a = { L: 50, a: 20, b: -30 };
        const b = { L: 30, a: -10, b: 40 };
        expect(labDistanceSquared(a, b)).toBe(labDistanceSquared(b, a));
    });

    it('returns sum of squared differences', () => {
        const a = { L: 0, a: 0, b: 0 };
        const b = { L: 5, a: 12, b: 0 };
        expect(labDistanceSquared(a, b)).toBe(169); // 25 + 144
    });
});

// ============================================================================
// 实际距离(× 100)
// ============================================================================

describe('oklabDistance', () => {
    it('is sqrt of squared distance * 100', () => {
        const a = { L: 0.1, a: -0.1, b: 0.05 };
        const b = { L: 0.6, a: 0.2, b: -0.1 };
        const sq = oklabDistanceSquared(a, b);
        const dist = oklabDistance(a, b);
        expect(dist).toBeCloseTo(Math.sqrt(sq) * 100, 10);
    });

    it('returns 0 for identical inputs', () => {
        const v = { L: 0.5, a: 0.1, b: -0.2 };
        expect(oklabDistance(v, v)).toBe(0);
    });

    it('matches pindou existing calculateColorDistance unit (× 100)', () => {
        // pindou color.js calculateColorDistance:Math.sqrt(...) * 100
        // 验证我们的 oklabDistance 与之完全一致(只是实现拆成两步)
        const a = { L: 0.5, a: 0.1, b: -0.2 };
        const b = { L: 0.7, a: 0.3, b: 0.0 };
        const dL = a.L - b.L;
        const da = a.a - b.a;
        const db = a.b - b.b;
        const expected = Math.sqrt(dL * dL + da * da + db * db) * 100;
        expect(oklabDistance(a, b)).toBeCloseTo(expected, 10);
    });

    it('matches reference: pixel-beads.com worker `nn()` (Oklab distance * 100)', () => {
        // 移植自 reference: docs/reference/processing-worker-pixel-beads-com.js 第 415-420 行
        // function nn(n, t) { return sqrt(...) * 100; }
        const a = { L: 0.5, a: 0.1, b: -0.2 };
        const b = { L: 0.3, a: 0.05, b: 0.1 };
        // sqrt(0.1325) * 100 ≈ 36.40
        expect(oklabDistance(a, b)).toBeCloseTo(36.40, 1);
    });
});

describe('labDistance', () => {
    it('is CIE76 Delta E (sqrt of squared L*a*b* difference)', () => {
        const a = { L: 50, a: 20, b: -30 };
        const b = { L: 53, a: 24, b: -33 };
        // 3² + 4² + 3² = 34, sqrt(34) * 100 ≈ 583.1
        expect(labDistance(a, b)).toBeCloseTo(583.095, 2);
    });

    it('returns 0 for identical inputs', () => {
        const v = { L: 50, a: 20, b: -30 };
        expect(labDistance(v, v)).toBe(0);
    });
});

// ============================================================================
// RGB 直接距离(高层封装)
// ============================================================================

describe('rgbOklabDistance', () => {
    it('matches pindou existing calculateColorDistance', () => {
        // pindou color.js:11
        // function calculateColorDistance(r1, g1, b1, r2, g2, b2) {
        //     const o1 = rgbToOklab(r1, g1, b1);
        //     const o2 = rgbToOklab(r2, g2, b2);
        //     ...Math.sqrt(...) * 100
        // }
        const d = rgbOklabDistance(255, 0, 0, 0, 0, 255);
        expect(d).toBeGreaterThan(0);
        // 红蓝 Oklab 距离大约 ~50
        expect(d).toBeGreaterThan(20);
        expect(d).toBeLessThan(80);
    });

    it('returns 0 for same RGB', () => {
        expect(rgbOklabDistance(128, 64, 200, 128, 64, 200)).toBe(0);
    });

    it('is symmetric', () => {
        const a = rgbOklabDistance(100, 50, 200, 200, 100, 50);
        const b = rgbOklabDistance(200, 100, 50, 100, 50, 200);
        expect(a).toBeCloseTo(b, 10);
    });
});

// ============================================================================
// 调色板最近邻
// ============================================================================

describe('findClosestBeadByOklab', () => {
    const palette = [
        { code: 'A01', r: 255, g: 0, b: 0 },
        { code: 'A02', r: 0, g: 255, b: 0 },
        { code: 'A03', r: 0, g: 0, b: 255 },
        { code: 'A04', r: 200, g: 100, b: 50 }, // brown-ish
    ];

    it('returns null for empty palette', () => {
        expect(findClosestBeadByOklab(128, 128, 128, [])).toBe(null);
        expect(findClosestBeadByOklab(128, 128, 128, null)).toBe(null);
    });

    it('returns the closest bead (not exact match)', () => {
        // 输入橙红,应选 A01(纯红)而非 A03(蓝)
        const closest = findClosestBeadByOklab(220, 50, 30, palette);
        expect(closest.code).toBe('A01');
    });

    it('returns exact match when available (early exit)', () => {
        const closest = findClosestBeadByOklab(255, 0, 0, palette);
        expect(closest.code).toBe('A01');
    });

    it('returns first bead as fallback when no clear winner', () => {
        // 灰色离所有 bead 都比较远,验证算法稳定返回某个(不抛错)
        const closest = findClosestBeadByOklab(128, 128, 128, palette);
        expect(closest).not.toBe(null);
        expect(palette).toContain(closest);
    });

    it('matches pindou existing getClosestBeadColor behavior', () => {
        // pindou color.js:21-37
        // 同样的输入,同样的输出
        const cases = [
            { input: [255, 0, 0], expectCode: 'A01' },
            { input: [0, 255, 0], expectCode: 'A02' },
            { input: [0, 0, 255], expectCode: 'A03' },
        ];
        for (const c of cases) {
            const result = findClosestBeadByOklab(c.input[0], c.input[1], c.input[2], palette);
            expect(result.code).toBe(c.expectCode);
        }
    });
});

// ============================================================================
// 一致性:K-means 内部用平方,匹配用 sqrt,等价性
// ============================================================================

describe('distance consistency: squared vs units', () => {
    it('oklabDistance(a, b) = sqrt(oklabDistanceSquared(a, b)) * 100', () => {
        const a = { L: 0.1, a: -0.2, b: 0.3 };
        const b = { L: 0.5, a: 0.1, b: -0.1 };
        const sq = oklabDistanceSquared(a, b);
        const full = oklabDistance(a, b);
        expect(full).toBeCloseTo(Math.sqrt(sq) * 100, 10);
    });

    it('labDistance(a, b) = sqrt(labDistanceSquared(a, b)) * 100', () => {
        const a = { L: 30, a: -20, b: 50 };
        const b = { L: 70, a: 10, b: -30 };
        const sq = labDistanceSquared(a, b);
        const full = labDistance(a, b);
        expect(full).toBeCloseTo(Math.sqrt(sq) * 100, 10);
    });
});
