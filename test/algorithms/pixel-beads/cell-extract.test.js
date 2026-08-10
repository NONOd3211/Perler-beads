// test/algorithms/pixel-beads/cell-extract.test.js
// 单元测试:cell 特征提取 + isOutline 判定(移植自 pixel-beads.com processing.worker.js)
//
// 验证:
//   - 透明像素被跳过(α < 16)
//   - 背景 mask 像素被跳过
//   - coverage < minimumForegroundCoverage 返回 null
//   - isOutline 正确判定(暗像素多 + luminance range 大 OR 平均暗)
//   - outline cell 的代表色仅来自暗像素
//   - 5 档预设参数完整且合理

import { describe, it, expect } from 'vitest';
import { extractCellFeatures, PRESETS } from '../../../public/js/algorithms/pixel-beads/cell-extract.js';

// ============================================================================
// 测试 fixtures
// ============================================================================

/**
 * 构造一张 4x4 像素的图,每像素 RGBA
 */
function makeImageData(pixels) {
    // pixels: 2D array [[r,g,b,a], ...]
    const flat = new Uint8ClampedArray(pixels.flat());
    return { data: flat, width: Math.sqrt(pixels.length) | 0, height: Math.sqrt(pixels.length) | 0 };
}

// ============================================================================
// Cell 提取核心
// ============================================================================

describe('extractCellFeatures', () => {
    it('returns empty array for invalid target dimensions', () => {
        const img = makeImageData([
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ]);
        expect(extractCellFeatures({ imageData: img.data, ...img, targetWidth: 0, targetHeight: 0, preset: PRESETS.detailed })).toEqual([]);
        expect(extractCellFeatures({ imageData: img.data, ...img, targetWidth: -1, targetHeight: 5, preset: PRESETS.detailed })).toEqual([]);
    });

    it('returns null for cell with all transparent pixels', () => {
        // 4x4 全 α=0
        const pixels = Array(16).fill([0, 0, 0, 0]);
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 2,
            targetHeight: 2,
            preset: PRESETS.detailed,
        });
        // 4 个 cell 都是背景
        expect(result).toHaveLength(4);
        expect(result.every((c) => c === null)).toBe(true);
    });

    it('returns null for cell with coverage below threshold', () => {
        // 4x4 图,2x2 网格 = 每 cell 4 像素
        // 一个 cell:3 透明 + 1 前景 = coverage 0.25 < detailed 的 0.12(OK)
        // 让我们用 simplified(0.28)
        // 一个 cell:4 像素全前景 + 一些透明 → coverage 低
        const pixels = [
            [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0],
            [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0],
            [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0],
            [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 0],
        ];
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 1,
            targetHeight: 1,
            preset: { ...PRESETS.simplified }, // minimumForegroundCoverage: 0.28
        });
        // 1 个 cell:4 前景(α=255) + 12 透明(α=0) → coverage = 4/16 = 0.25 < 0.28 → null
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(null);
    });

    it('returns correct rgb for solid-color cell (no outline)', () => {
        // 4x4 全亮黄 (高 luminance,BT.709 = 0.886) → 不是 outline
        // 注意:纯红 (255,0,0) BT.709 luminance = 0.21,会被 detailed 判定为 outline
        //      这是 reference 的真实行为,不要"修"算法,改测试输入
        const pixels = Array(16).fill([255, 255, 200, 255]);
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 1,
            targetHeight: 1,
            preset: PRESETS.detailed,
        });
        expect(result).toHaveLength(1);
        expect(result[0]).not.toBe(null);
        expect(result[0].rgb).toEqual({ r: 255, g: 255, b: 200 });
        expect(result[0].coverage).toBe(1);
        expect(result[0].isOutline).toBe(false); // 亮黄无暗部
    });

    it('detects isOutline when dark pixel ratio is high + range is large', () => {
        // 2x2 像素,1 个 cell:3 暗(黑) + 1 亮(白) → darkRatio=0.75,range=1
        // preset.detailed:outlineDarkRatio=0.3,outlineContrast=0.22,outlineDarkLuminance=0.28
        // 黑色 (0,0,0) luminance = 0,白色 (255,255,255) luminance = 1
        // darkRatio=0.75 ≥ 0.3 ✓ AND luminanceRange=1 ≥ 0.22 ✓ → isOutline=true
        // outline 时代表色只算暗像素均值(0,0,0)
        const pixels = [
            [0, 0, 0, 255], [255, 255, 255, 255],
            [0, 0, 0, 255], [0, 0, 0, 255],
        ];
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 2,
            imageHeight: 2,
            targetWidth: 1,
            targetHeight: 1,
            preset: PRESETS.detailed,
        });
        expect(result[0].isOutline).toBe(true);
        // outline 时只算暗像素均值 → 黑色
        expect(result[0].rgb).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('does NOT detect isOutline when range is small (uniform color)', () => {
        // 1 个 cell:全中灰 (128,128,128) → luminance ≈ 0.501,range=0
        const pixels = Array(16).fill([128, 128, 128, 255]);
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 1,
            targetHeight: 1,
            preset: PRESETS.detailed,
        });
        // darkRatio = 0 (luminance 0.501 > 0.28),所以 isOutline = false
        expect(result[0].isOutline).toBe(false);
    });

    it('isOutline is true when mean luminance is very dark (even without large range)', () => {
        // 全 dark gray (50,50,50) → luminance ≈ 0.196, ≤ 0.28
        // preset.detailed:darkRatio=1 (all dark),meanLum=0.196 ≤ 0.28 → isOutline=true
        const pixels = Array(16).fill([50, 50, 50, 255]);
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 1,
            targetHeight: 1,
            preset: PRESETS.detailed,
        });
        expect(result[0].isOutline).toBe(true);
        expect(result[0].rgb).toEqual({ r: 50, g: 50, b: 50 });
    });

    it('skips pixels marked as background by backgroundMask', () => {
        // 4x4 像素,1 个 cell
        // 前 8 像素 = 前景(红),后 8 像素 = 应被 mask 跳过(也设成红以便看效果)
        const pixels = Array(16).fill([255, 0, 0, 255]);
        const img = makeImageData(pixels);
        // 标记后 8 像素为背景
        const mask = new Uint8Array(16);
        for (let i = 8; i < 16; i++) mask[i] = 1;
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 1,
            targetHeight: 1,
            backgroundMask: mask,
            preset: { ...PRESETS.detailed }, // minimumForegroundCoverage: 0.12
        });
        // coverage = 8/16 = 0.5 ≥ 0.12 → not null
        expect(result[0]).not.toBe(null);
        // 代表色只来自前 8 前景像素(都是红)
        expect(result[0].rgb).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('multiple cells: each cell processes its own region', () => {
        // 4x4 像素,2x2 网格
        // 左上 = 红,右上 = 绿,左下 = 蓝,右下 = 黄
        const pixels = [
            [255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255],
            [255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255],
            [0, 0, 255, 255], [0, 0, 255, 255], [255, 255, 0, 255], [255, 255, 0, 255],
            [0, 0, 255, 255], [0, 0, 255, 255], [255, 255, 0, 255], [255, 255, 0, 255],
        ];
        const img = makeImageData(pixels);
        const result = extractCellFeatures({
            imageData: img.data,
            imageWidth: 4,
            imageHeight: 4,
            targetWidth: 2,
            targetHeight: 2,
            preset: { ...PRESETS.detailed, minimumForegroundCoverage: 0.5 },
        });
        expect(result).toHaveLength(4);
        // [0,0] 红, [0,1] 绿, [1,0] 蓝, [1,1] 黄
        expect(result[0].rgb).toEqual({ r: 255, g: 0, b: 0 });
        expect(result[1].rgb).toEqual({ r: 0, g: 255, b: 0 });
        expect(result[2].rgb).toEqual({ r: 0, g: 0, b: 255 });
        expect(result[3].rgb).toEqual({ r: 255, g: 255, b: 0 });
    });
});

// ============================================================================
// 预设参数
// ============================================================================

describe('PRESETS', () => {
    it('has 5 presets: legacy, zippland, simplified, standard, detailed', () => {
        expect(Object.keys(PRESETS).sort()).toEqual(['detailed', 'legacy', 'simplified', 'standard', 'zippland']);
    });

    it('legacy and zippland have outline-disabled parameters', () => {
        // 这两档基本不识别 outline
        for (const id of ['legacy', 'zippland']) {
            expect(PRESETS[id].outlineDarkRatio).toBe(1);
            expect(PRESETS[id].outlineContrast).toBe(1);
            expect(PRESETS[id].outlineDarkLuminance).toBe(0);
            expect(PRESETS[id].minimumForegroundCoverage).toBe(0);
        }
    });

    it('detailed has the most colors and lowest coverage threshold', () => {
        expect(PRESETS.detailed.maxColors).toBe(16);
        expect(PRESETS.detailed.minimumForegroundCoverage).toBe(0.12);
    });

    it('simplified has the fewest colors and highest coverage threshold', () => {
        expect(PRESETS.simplified.maxColors).toBe(8);
        expect(PRESETS.simplified.minimumForegroundCoverage).toBe(0.28);
    });

    it('standard is between simplified and detailed', () => {
        expect(PRESETS.standard.maxColors).toBe(10);
        expect(PRESETS.standard.minimumForegroundCoverage).toBe(0.2);
    });

    it('each preset has all required fields', () => {
        const requiredFields = [
            'id',
            'maxColors',
            'minimumForegroundCoverage',
            'outlineDarkLuminance',
            'outlineDarkRatio',
            'outlineContrast',
            'outlineWeight',
            'backgroundSeedDeltaE',
            'backgroundFillDeltaE',
            'backgroundMinimumConfidence',
            'cleanupMinimumNeighbors',
        ];
        for (const [name, preset] of Object.entries(PRESETS)) {
            for (const field of requiredFields) {
                expect(preset).toHaveProperty(field);
            }
        }
    });

    it('matches reference: PRESETS values equal reference fn object', () => {
        // 移植自 reference processing.worker.js fn 对象
        // 验证数值精确一致
        expect(PRESETS.zippland.maxColors).toBe(null);
        expect(PRESETS.zippland.cleanupMinimumNeighbors).toBe(null);
        expect(PRESETS.simplified.maxColors).toBe(8);
        expect(PRESETS.simplified.outlineWeight).toBe(3);
        expect(PRESETS.standard.maxColors).toBe(10);
        expect(PRESETS.standard.outlineWeight).toBe(2.5);
        expect(PRESETS.detailed.maxColors).toBe(16);
        expect(PRESETS.detailed.outlineWeight).toBe(1.5);
    });
});
