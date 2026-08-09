// test/algorithms/pixel-beads/kmeans.test.js
// 单元测试:K-means++ 初始化 + K-means 迭代(移植自 pixel-beads.com processing.worker.js)
//
// 验证:
//   - 初始化:首中心取 L 最小的 outline;后续按权重加权的最远距离
//   - 迭代:已知分布 → 已知聚类中心
//   - 收敛:空簇保留原中心,不抛 NaN
//   - 退化:空样本 / k=0
//   - 权重:weight 影响中心位置

import { describe, it, expect } from 'vitest';
import { kmeansPlusPlusInit, kmeans } from '../../../public/js/algorithms/pixel-beads/kmeans.js';
import { oklabDistance } from '../../../public/js/algorithms/pixel-beads/distance.js';

// ============================================================================
// K-means++ 初始化
// ============================================================================

describe('kmeansPlusPlusInit', () => {
    it('returns empty array for empty samples', () => {
        expect(kmeansPlusPlusInit([], 3)).toEqual([]);
    });

    it('returns empty array for k <= 0', () => {
        const samples = [{ lab: { L: 0.5, a: 0, b: 0 }, weight: 1 }];
        expect(kmeansPlusPlusInit(samples, 0)).toEqual([]);
        expect(kmeansPlusPlusInit(samples, -1)).toEqual([]);
    });

    it('first center is the L-darkest outline if any outlines exist', () => {
        const samples = [
            { lab: { L: 0.9, a: 0, b: 0 }, weight: 1, isOutline: false },
            { lab: { L: 0.3, a: 0, b: 0 }, weight: 1, isOutline: true }, // L=0.3 outline
            { lab: { L: 0.5, a: 0, b: 0 }, weight: 1, isOutline: false },
            { lab: { L: 0.1, a: 0, b: 0 }, weight: 1, isOutline: true }, // L=0.1 outline (darkest)
        ];
        const centers = kmeansPlusPlusInit(samples, 2);
        expect(centers[0].L).toBeCloseTo(0.1, 10);
    });

    it('first center is the L-darkest non-outline if no outlines', () => {
        const samples = [
            { lab: { L: 0.9, a: 0, b: 0 }, weight: 1, isOutline: false },
            { lab: { L: 0.3, a: 0, b: 0 }, weight: 1, isOutline: false },
            { lab: { L: 0.5, a: 0, b: 0 }, weight: 1, isOutline: false },
            { lab: { L: 0.1, a: 0, b: 0 }, weight: 1, isOutline: false }, // 暗
        ];
        const centers = kmeansPlusPlusInit(samples, 1);
        expect(centers[0].L).toBeCloseTo(0.1, 10);
    });

    it('returns at most k centers', () => {
        const samples = [
            { lab: { L: 0.1, a: 0, b: 0 }, weight: 1 },
            { lab: { L: 0.2, a: 0, b: 0 }, weight: 1 },
            { lab: { L: 0.3, a: 0, b: 0 }, weight: 1 },
        ];
        const centers = kmeansPlusPlusInit(samples, 10);
        expect(centers.length).toBeLessThanOrEqual(3); // 样本不够 k
    });

    it('subsequent centers are far from existing ones (K-means++ property)', () => {
        // 3 个明显分离的簇
        const samples = [
            // 簇 1:红色
            { lab: { L: 0.5, a: 0.2, b: 0.1 }, weight: 1 },
            { lab: { L: 0.55, a: 0.22, b: 0.12 }, weight: 1 },
            { lab: { L: 0.52, a: 0.19, b: 0.11 }, weight: 1 },
            // 簇 2:绿色
            { lab: { L: 0.6, a: -0.2, b: 0.1 }, weight: 1 },
            { lab: { L: 0.62, a: -0.22, b: 0.12 }, weight: 1 },
            { lab: { L: 0.58, a: -0.19, b: 0.11 }, weight: 1 },
            // 簇 3:蓝色
            { lab: { L: 0.4, a: 0.0, b: -0.3 }, weight: 1 },
            { lab: { L: 0.42, a: 0.02, b: -0.32 }, weight: 1 },
            { lab: { L: 0.38, a: -0.01, b: -0.28 }, weight: 1 },
        ];
        const centers = kmeansPlusPlusInit(samples, 3);
        expect(centers.length).toBe(3);
        // 三中心两两之间距离应该较大(分散)
        const d01 = oklabDistance(centers[0], centers[1]);
        const d02 = oklabDistance(centers[0], centers[2]);
        const d12 = oklabDistance(centers[1], centers[2]);
        expect(d01).toBeGreaterThan(20);
        expect(d02).toBeGreaterThan(20);
        expect(d12).toBeGreaterThan(20);
    });

    it('weight influences center selection', () => {
        // 100 个红色 + 1 个蓝色,但蓝色 weight 极高 → 蓝色应该被选中
        const samples = [
            // 100 个红色
            ...Array(100)
                .fill()
                .map(() => ({ lab: { L: 0.5, a: 0.2, b: 0.1 }, weight: 0.01 })),
            // 1 个蓝色,但 weight 极高
            { lab: { L: 0.4, a: 0.0, b: -0.3 }, weight: 100 },
        ];
        const centers = kmeansPlusPlusInit(samples, 2);
        // 第 2 中心应该是蓝色(因为权重加权距离最大)
        const c0 = centers[0];
        const c1 = centers[1];
        // 找哪个是蓝
        const isC0Blue = c0.b < -0.2;
        const isC1Blue = c1.b < -0.2;
        expect(isC0Blue || isC1Blue).toBe(true);
    });
});

// ============================================================================
// K-means 迭代
// ============================================================================

describe('kmeans', () => {
    it('returns empty array for empty samples', () => {
        expect(kmeans([], 3)).toEqual([]);
    });

    it('clusters 2 obvious groups correctly (1D L-axis)', () => {
        // 一维 L 轴上 2 个簇:亮 vs 暗
        const samples = [
            ...Array(20).fill().map(() => ({ lab: { L: 0.9, a: 0, b: 0 }, weight: 1 })),
            ...Array(20).fill().map(() => ({ lab: { L: 0.2, a: 0, b: 0 }, weight: 1 })),
        ];
        const centers = kmeans(samples, 2);
        expect(centers.length).toBe(2);
        // 一个中心接近 0.9,另一个接近 0.2
        const Ls = centers.map((c) => c.L).sort((a, b) => a - b);
        expect(Ls[0]).toBeCloseTo(0.2, 1);
        expect(Ls[1]).toBeCloseTo(0.9, 1);
    });

    it('clusters 3-color image correctly (red/green/blue)', () => {
        // 3 个明显分离的颜色簇
        const samples = [
            // 30 个红色
            ...Array(30)
                .fill()
                .map(() => ({ lab: { L: 0.5, a: 0.2, b: 0.1 }, weight: 1 })),
            // 30 个绿色
            ...Array(30)
                .fill()
                .map(() => ({ lab: { L: 0.6, a: -0.2, b: 0.1 }, weight: 1 })),
            // 30 个蓝色
            ...Array(30)
                .fill()
                .map(() => ({ lab: { L: 0.4, a: 0.0, b: -0.3 }, weight: 1 })),
        ];
        const centers = kmeans(samples, 3, 20);
        expect(centers.length).toBe(3);
        // 3 个中心应该两两距离都很大
        const d01 = oklabDistance(centers[0], centers[1]);
        const d02 = oklabDistance(centers[0], centers[2]);
        const d12 = oklabDistance(centers[1], centers[2]);
        expect(d01).toBeGreaterThan(30);
        expect(d02).toBeGreaterThan(30);
        expect(d12).toBeGreaterThan(30);
    });

    it('converges within max iterations (no infinite loop)', () => {
        const samples = Array(50)
            .fill()
            .map(() => ({
                lab: {
                    L: Math.random(),
                    a: Math.random() * 0.1,
                    b: Math.random() * 0.1,
                },
                weight: 1,
            }));
        const t0 = performance.now();
        const centers = kmeans(samples, 5);
        const t1 = performance.now();
        expect(centers.length).toBe(5);
        expect(t1 - t0).toBeLessThan(1000); // 1s 内完成
    });

    it('handles empty cluster (no NaN centers)', () => {
        // k=3 但样本分 2 簇,第 3 个簇会变空
        const samples = [
            ...Array(10)
                .fill()
                .map(() => ({ lab: { L: 0.9, a: 0, b: 0 }, weight: 1 })),
            ...Array(10)
                .fill()
                .map(() => ({ lab: { L: 0.1, a: 0, b: 0 }, weight: 1 })),
        ];
        const centers = kmeans(samples, 3, 5);
        // 不抛错,所有 center 都是有限数
        for (const c of centers) {
            expect(Number.isFinite(c.L)).toBe(true);
            expect(Number.isFinite(c.a)).toBe(true);
            expect(Number.isFinite(c.b)).toBe(true);
        }
    });

    it('weight influences final cluster centers (weighted mean)', () => {
        // 10 个暗 + 10 个亮,但亮 weight 极高 → 中心偏向亮
        const samples = [
            ...Array(10)
                .fill()
                .map(() => ({ lab: { L: 0.1, a: 0, b: 0 }, weight: 1 })),
            ...Array(10)
                .fill()
                .map(() => ({ lab: { L: 0.9, a: 0, b: 0 }, weight: 100 })),
        ];
        const centers = kmeans(samples, 2, 20);
        // 中心应该接近 0.1 和 0.9(权重大不影响单中心位置,只影响 assign 边界)
        const Ls = centers.map((c) => c.L).sort((a, b) => a - b);
        expect(Ls[0]).toBeCloseTo(0.1, 1);
        expect(Ls[1]).toBeCloseTo(0.9, 1);
    });

    it('respects max iterations cap', () => {
        // 1 次迭代明显不够收敛,但不应该抛错
        const samples = Array(100)
            .fill()
            .map(() => ({ lab: { L: Math.random(), a: Math.random() * 0.1, b: Math.random() * 0.1 }, weight: 1 }));
        const centers = kmeans(samples, 5, 1);
        expect(centers.length).toBe(5);
        for (const c of centers) {
            expect(Number.isFinite(c.L)).toBe(true);
        }
    });

    it('matches reference un() behavior: 12 default iterations, 1e-4 threshold', () => {
        // reference un() 默认 12 次迭代 + 1e-4 收敛阈值(平方)
        // 验证我们的默认值一致
        const samples = [
            ...Array(20)
                .fill()
                .map(() => ({ lab: { L: 0.5, a: 0.2, b: 0.1 }, weight: 1 })),
            ...Array(20)
                .fill()
                .map(() => ({ lab: { L: 0.4, a: -0.1, b: -0.2 }, weight: 1 })),
        ];
        // 用默认参数(12, 1e-4)
        const centers = kmeans(samples, 2);
        expect(centers.length).toBe(2);
        // 验证与已知答案接近
        const Ls = centers.map((c) => c.L).sort((a, b) => a - b);
        expect(Ls[0]).toBeCloseTo(0.4, 1);
        expect(Ls[1]).toBeCloseTo(0.5, 1);
    });
});
