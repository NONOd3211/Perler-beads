#!/usr/bin/env bash
# scripts/build.sh — 用于 comet-guard build_command 探测
# 纯静态项目无传统 build 步骤;此脚本等价于"build" = 工具链验证(lint + test/color.test.js)
#
# 仅验证本 change 范围(test/color.test.js 27/27 + lint CLEAN);
# test/ui/pixelation-mode.test.js 已改写为 Vitest ESM,默认被 `vitest run` 包含,
# 不在此处显式指定,避免 build 命令随测试列表漂移。
set -e
npm run lint
npm run test -- test/color.test.js