# VIS 像素基线

全页面像素回归覆盖：

- 31 个 VIS 页面
- 1440 / 3440 两个宽度
- 浅色 / 深色两套主题
- 共 124 张 fullPage 截图

## 基线存在哪里

基线图片**不进仓库**，打包成一个 `vis-baseline-v1.tar.gz`，放在 GitHub Release：

```text
Release: vis-baseline-v1
Asset:   vis-baseline-v1.tar.gz
```

仓库里只有版本指针：

```text
tests/e2e/vis-baseline.json
```

## 本地跑

先构建：

```bash
cd view && npm run build
```

比较：

```bash
cd tests && npm run vis:shots
```

本地没有 `GITHUB_TOKEN` 时，会退回 `tests/e2e/vis-baseline/` 目录（git 忽略）。
第一次或有意改视觉时：

```bash
cd tests && npm run vis:update
```

- 有 `GITHUB_TOKEN`：重新生成并上传 Release 资产
- 没有：只写本地目录

## CI

`.github/workflows/vis.yml`：

- push / PR：构建 + 守卫 + 全页面像素比较
- 首次 main 推送：远端没有基线时自动 bootstrap 第一版
- `workflow_dispatch`：可手动勾选 `update_baseline` 重新生成

失败时 `tests/artifacts/vis-shots/current` 会作为 Actions artifact 上传，保留 7 天。

## 阈值

- 单页像素差异 > 0.25% 失败
- 尺寸变化直接失败
- 页面控制台任何 error 直接失败

## 更新基线的流程

1. 确认改动是有意的视觉变化
2. 本地 `npm run vis:update` 看一遍截图
3. 在 GitHub Actions 手动运行 `VIS`，勾选 `update_baseline`
4. 基线 Release 资产被覆盖，后续 PR 按新版本比较
