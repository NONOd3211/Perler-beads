import { describe, it, expect } from 'vitest';
import { presampleNearest, presampleSize } from '/Volumes/NVME/pindou/public/js/algorithms/pixel-beads/presample.js';

describe('presampleNearest', () => {
    it('同尺寸直接返回原图引用', () => {
        const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
        const out = presampleNearest(data, 2, 1, 2, 1);
        expect(out).toBe(data);
    });

    it('2x downsample 取最近像素', () => {
        // 4x1 红色 → 2x1 应该都是红色
        const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
        const out = presampleNearest(data, 4, 1, 2, 1);
        expect(out.length).toBe(2 * 1 * 4);
        expect(Array.from(out)).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    });

    it('4x downsample 保留原色不做平均', () => {
        // 4x4 图像,每 2x2 块都是同一颜色 → 2x2 输出保留原色
        const data = new Uint8ClampedArray(4 * 4 * 4);
        // 左上 2x2 块填红色
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const i = (y * 4 + x) * 4;
            data[i] = 255; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
        }
        // 右上 2x2 块填绿色
        for (let y = 0; y < 2; y++) for (let x = 2; x < 4; x++) {
            const i = (y * 4 + x) * 4;
            data[i] = 0; data[i+1] = 255; data[i+2] = 0; data[i+3] = 255;
        }
        // 下半部分填蓝色
        for (let y = 2; y < 4; y++) for (let x = 0; x < 4; x++) {
            const i = (y * 4 + x) * 4;
            data[i] = 0; data[i+1] = 0; data[i+2] = 255; data[i+3] = 255;
        }
        const out = presampleNearest(data, 4, 4, 2, 2);
        // (0,0)→src(1,1) = 红
        // (0,1)→src(1,3) = 绿
        // (1,0)→src(3,1) = 蓝
        // (1,1)→src(3,3) = 蓝
        expect(out[0]).toBe(255); expect(out[1]).toBe(0); expect(out[2]).toBe(0);
        expect(out[4]).toBe(0); expect(out[5]).toBe(255); expect(out[6]).toBe(0);
        expect(out[8]).toBe(0); expect(out[9]).toBe(0); expect(out[10]).toBe(255);
        expect(out[12]).toBe(0); expect(out[13]).toBe(0); expect(out[14]).toBe(255);
    });

    it('alpha 通道也保留', () => {
        const data = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128]);
        const out = presampleNearest(data, 2, 1, 1, 1);
        // 中心采样 → 选 srcX=1
        expect(Array.from(out)).toEqual([40, 50, 60, 128]);
    });

    it('不支持的尺寸抛错', () => {
        const data = new Uint8ClampedArray(16);
        expect(() => presampleNearest(data, 2, 2, 0, 2)).toThrow();
    });
});

describe('presampleSize', () => {
    it('factor=1 返回原尺寸', () => {
        expect(presampleSize(1000, 800, 1)).toEqual({ width: 1000, height: 800 });
        expect(presampleSize(1000, 800, 0)).toEqual({ width: 1000, height: 800 });
        expect(presampleSize(1000, 800, null)).toEqual({ width: 1000, height: 800 });
    });

    it('factor=4 缩到 1/4', () => {
        expect(presampleSize(1000, 800, 4)).toEqual({ width: 250, height: 200 });
    });

    it('factor=8 缩到 1/8', () => {
        expect(presampleSize(1000, 800, 8)).toEqual({ width: 125, height: 100 });
    });

    it('最小不小于 1', () => {
        expect(presampleSize(2, 2, 4)).toEqual({ width: 1, height: 1 });
        expect(presampleSize(2, 2, 10)).toEqual({ width: 1, height: 1 });
    });
});
