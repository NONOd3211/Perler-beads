// 熨烫效果注册表(单例 export)
// 各效果(plain / towel / 未来新效果)在 js/fuse-effects/<name>.js import 本单例后 mutate 触发注册
// 调度层(fused-preview.js)查表调用,加新效果不需要改 fused-preview.js
export const BeadFuseEffects = {};
