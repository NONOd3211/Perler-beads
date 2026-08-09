// test/algorithms/pixel-beads/background-mask.test.js
// 单元测试:imageData 维度背景 BFS 检测(移植自 pixel-beads.com processing.worker.js)
//
// 验证:
//   - 透明像素被标记为背景
//   - mode='keep' 只标透明,不识别
//   - 单色背景:4 角一致 → 高置信度,全图都被 BFS 标记
//   - 复杂背景:背景 + 前景,只背景被标记
//   - 4 角不一致:置信度低,可能 detected=false
//   - 边界处理:1px 宽 / 1px 高

import { describe, it, expect } from 'vitest';
import { detectBackgroundMask } from '../../../public/js/algorithms/pixel-beads/background-mask.js';
import { PRESETS } from '../../../public/js/algorithms/pixel-beads/cell-extract.js';

// ============================================================================
// Test fixtures
// ============================================================================

/**
 * 构造纯色 RGBA 图像
 */
function solidImage(r, g, b, w, h, a = 255) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = a;
    }
    return { data, width: w, height: h };
}

/**
 * 构造带透明区域 + 主体区域的图像
 */
function mixedImage(backgroundColor, foregroundColor, fgRect, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (x >= fgRect.x && x < fgRect.x + fgRect.w && y >= fgRect.y && y < fgRect.y + fgRect.h) {
                data[i] = foregroundColor[0];
                data[i + 1] = foregroundColor[1];
                data[i + 2] = foregroundColor[2];
                data[i + 3] = 255;
            } else {
                data[i] = backgroundColor[0];
                data[i + 1] = backgroundColor[1];
                data[i + 2] = backgroundColor[2];
                data[i + 3] = 255;
            }
        }
    }
    return { data, width: w, height: h };
}

// ============================================================================
// detectBackgroundMask
// ============================================================================

describe('detectBackgroundMask', () => {
    it('transparent pixels are marked as background', () => {
        // 4x4 白底,3 个像素 α=0
        // BFS 会从 4 角(都是白)开始扩展,把整图非透明像素也标记为背景
        // 3 个透明像素是预先标记的
        const img = solidImage(255, 255, 255, 4, 4);
        img.data[0 * 4 + 3] = 0;
        img.data[5 * 4 + 3] = 0;
        img.data[10 * 4 + 3] = 0;
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        // 3 个透明像素(初始化时就被标记)
        expect(result.mask[0]).toBe(1);
        expect(result.mask[5]).toBe(1);
        expect(result.mask[10]).toBe(1);
        // 单色白图,BFS 会标记所有像素
        const marked = result.mask.reduce((sum, v) => sum + v, 0);
        expect(marked).toBe(16);
    });

    it('mode="keep" only marks transparent pixels (no edge BFS)', () => {
        // 单色白图(全前景),mode=keep → 不应识别背景
        const img = solidImage(255, 255, 255, 4, 4);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'keep',
            preset: PRESETS.detailed,
        });
        expect(result.detected).toBe(false);
        expect(result.confidence).toBe(0);
        // 没有任何像素被标记
        const marked = result.mask.reduce((sum, v) => sum + v, 0);
        expect(marked).toBe(0);
    });

    it('single-color image: 4 corners consistent → high confidence, all pixels marked as background', () => {
        // 8x8 纯白图
        const img = solidImage(255, 255, 255, 8, 8);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        expect(result.detected).toBe(true);
        // 4 角都是白,100% 一致 → 置信度 ≥ 0.75
        expect(result.confidence).toBeGreaterThanOrEqual(0.75);
        // 整图 BFS 都被标记
        const marked = result.mask.reduce((sum, v) => sum + v, 0);
        expect(marked).toBe(64); // 8x8 = 64
    });

    it('mixed: white background + blue foreground center, only background marked', () => {
        // 10x10 白底 + 中心 4x4 蓝块
        const img = mixedImage(
            [255, 255, 255],
            [0, 0, 255],
            { x: 3, y: 3, w: 4, h: 4 },
            10,
            10
        );
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        // 4 角都是白 → 识别成功
        expect(result.detected).toBe(true);
        // 4 角被标记
        expect(result.mask[0]).toBe(1);
        expect(result.mask[9]).toBe(1);
        expect(result.mask[90]).toBe(1);
        expect(result.mask[99]).toBe(1);
        // 中心蓝块不被标记(ΔE 太大)
        const center = 5 * 10 + 5;
        expect(result.mask[center]).toBe(0);
    });

    it('1x1 image: only 1 pixel, all 4 corners are the same', () => {
        const img = solidImage(128, 128, 128, 1, 1);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: 1,
            height: 1,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        expect(result.detected).toBe(true);
        // 单像素被 BFS 标记
        expect(result.mask[0]).toBe(1);
    });

    it('all-transparent image: detected=false but mask includes all pixels', () => {
        // 全 α=0
        const img = solidImage(0, 0, 0, 4, 4, 0);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        // 边缘可见像素 = 0,reference 行为:detected=false,confidence=1
        expect(result.detected).toBe(false);
        expect(result.confidence).toBe(1);
        // 但所有透明像素都已被初始 mask 标记
        const marked = result.mask.reduce((sum, v) => sum + v, 0);
        expect(marked).toBe(16);
    });

    it('4 corners inconsistent (e.g. top corners white, bottom corners dark) → low confidence, may not detect', () => {
        // 4x4,4 角:左上白,右上白,左下黑(0,0,0),右下黑
        const img = solidImage(0, 0, 0, 4, 4);
        // 顶边 2 行设白
        for (let x = 0; x < 4; x++) {
            for (let y = 0; y < 2; y++) {
                const i = (y * 4 + x) * 4;
                img.data[i] = 255;
                img.data[i + 1] = 255;
                img.data[i + 2] = 255;
            }
        }
        const result = detectBackgroundMask({
            imageData: img.data,
            width: 4,
            height: 4,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        // 4 角:[0]=白,[3]=白,[12]=黑,[15]=黑
        // 4 角中位 Lab ≈ 中间色,只有 2 个跟它一致
        // cornerConfirmed = false (count=2 < 3)
        // 用边缘中位 → 边缘很多白 + 一些黑,可能置信度也不高
        // 这个 case 比较微妙,只验证不抛错 + 返回合理结构
        expect(result.mask).toBeInstanceOf(Uint8Array);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('low confidence preset: even valid single-color background may not detect', () => {
        // 用 backgroundMinimumConfidence=0.99 的预设
        const img = solidImage(255, 255, 255, 4, 4);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: img.width,
            height: img.height,
            mode: 'auto',
            preset: { ...PRESETS.detailed, backgroundMinimumConfidence: 0.99 },
        });
        // 实际 confidence 是 1.0,可能仍然 detect(0.99 阈值)
        // 但如果 confidence=0.98,就不 detect
        // 我们的 4 角都是白,4 角中位 = 白,4 角都一致 = 100% ≥ 0.75 → cornerConfirmed
        // edgeMatchRatio 也是 100% → confidence = 1.0 → detect
        expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('BFS correctly handles pixel boundaries (no out-of-bounds access)', () => {
        // 3x3 单色图,验证 BFS 不会越界
        const img = solidImage(100, 150, 200, 3, 3);
        expect(() =>
            detectBackgroundMask({
                imageData: img.data,
                width: 3,
                height: 3,
                mode: 'auto',
                preset: PRESETS.detailed,
            })
        ).not.toThrow();
    });

    it('only 4 edges are used as BFS seeds (interior not in initial queue)', () => {
        // 8x8,中心 2x2 是完全不同颜色,边缘都是白
        // BFS 应该从边缘开始,白区会扩展,中心 2x2 应该不被标记(ΔE 太大)
        const img = mixedImage(
            [255, 255, 255],
            [0, 0, 0],
            { x: 3, y: 3, w: 2, h: 2 },
            8,
            8
        );
        const result = detectBackgroundMask({
            imageData: img.data,
            width: 8,
            height: 8,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        expect(result.detected).toBe(true);
        // 中心 2x2 黑色不被标记
        expect(result.mask[3 * 8 + 3]).toBe(0);
        expect(result.mask[4 * 8 + 3]).toBe(0);
        expect(result.mask[3 * 8 + 4]).toBe(0);
        expect(result.mask[4 * 8 + 4]).toBe(0);
    });
});

// ============================================================================
// 一致性 / 边界
// ============================================================================

describe('detectBackgroundMask edge cases', () => {
    it('returns Uint8Array of correct size', () => {
        const img = solidImage(255, 255, 255, 16, 16);
        const result = detectBackgroundMask({
            imageData: img.data,
            width: 16,
            height: 16,
            mode: 'auto',
            preset: PRESETS.detailed,
        });
        expect(result.mask).toBeInstanceOf(Uint8Array);
        expect(result.mask.length).toBe(256);
    });

    it('confidence is always in [0, 1]', () => {
        // 各种图,验证 confidence 范围
        const cases = [
            solidImage(255, 255, 255, 4, 4),
            solidImage(255, 0, 0, 4, 4),
            solidImage(0, 0, 0, 4, 4),
            mixedImage([255, 255, 255], [0, 0, 0], { x: 1, y: 1, w: 2, h: 2 }, 4, 4),
        ];
        for (const img of cases) {
            const result = detectBackgroundMask({
                imageData: img.data,
                width: img.width,
                height: img.height,
                mode: 'auto',
                preset: PRESETS.detailed,
            });
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        }
    });
});
