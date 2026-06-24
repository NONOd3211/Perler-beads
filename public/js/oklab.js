// js/oklab.js — Oklab 感知色彩空间转换 + 模块级缓存
// 参考: https://bottosson.github.io/posts/oklab/
// ESM 化:IIFE wrapper 去掉;cache 改为模块私有,不 export

// 简易 LRU 上限 1024:Map 保留插入顺序,满了删最早插入的 key。
// 实际大图(10816 cell)去重后 unique RGB < 1024,容量足够。
// 纯插入顺序 FIFO 而非访问顺序 LRU(Oklab 缓存读多写少,FIFO 已满足防无界增长)。
const CACHE_MAX = 1024;
const cache = new Map();

export function srgbToLinear(c) {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function rgbToOklab(r, g, b) {
    const key = r + ',' + g + ',' + b;
    const cached = cache.get(key);
    if (cached) return cached;
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    const lR = Math.cbrt(l);
    const mR = Math.cbrt(m);
    const sR = Math.cbrt(s);
    const result = {
        L: 0.2104542553 * lR + 0.793617785 * mR - 0.0040720468 * sR,
        a: 1.9779984951 * lR - 2.428592205 * mR + 0.4505937099 * sR,
        b: 0.0259040371 * lR + 0.7827717662 * mR - 0.808675766 * sR,
    };
    if (cache.size >= CACHE_MAX) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, result);
    return result;
}
