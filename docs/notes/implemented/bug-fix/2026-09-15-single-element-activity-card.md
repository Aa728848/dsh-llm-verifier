# Agent Note: 验证提醒卡片只保留一层 —— 卡片自己就是 dock 行

Status: implemented

## Problem

用户报告：「我们的验证提醒卡片，背景遮罩超出了位置」。截图里卡片左右各露出一条比卡片宽的浅色底，
两端被红圈标出。逐像素复测（工作区里已有的 1:1 桌面截图 `.tmp-shot/full-bright.png`）后，这块底是：

- 高度恰好等于卡片本身（36px），并且**只覆盖卡片那一行** —— 卡片与输入卡片之间的 6px stack gap
  那一行是页面底色，说明它不是 `.composerSeat` 的整块背景；
- 颜色与卡片底色 `--dsw-specific-tip` 基本相同，**平色、上下硬边**（垂直方向只有 ±2 的抖动），
  不是渐变；
- 横向比卡片每侧宽约 90–120 CSS px，其盒子正好等于 **composer dock 行**的盒子
  （`100% - 2×side-clearance - 4×dock-inset` × 卡片高度）。

代码事实与这块底对不上：`activityDock`（外层）只有宽度与居中，**没有任何 background**；背景、描边、
圆角都在内层 `activityBar` 上，而背景永远被自己的 border-box 裁掉，**不可能比卡片宽**。宿主的输入遮罩
（`.composerSeat` 的 `transparent → bg-base 36px` 渐变）同样解释不了：它是整列宽、渐变、且会盖住
gap 那一行。结论：那条底是**别人刷在外层那个中间盒子上的**——composer stack 是宿主区域，宿主或皮肤
样式表可以给 dock 行画表面；我们当初照抄宿主 `GoalBar`（外层 `.dock` + 内层 `.bar`）的两层结构，
于是凭空多出一个「可被刷底、且比卡片宽」的元素。宿主自己的 `TodoPanel` 反而是单元素（几何与表面同一个
盒子），天然不会出现这个形状。

## Decision

把两层合并成一层 `activityCard`：同一个元素同时持有 dock 列宽度
（`width: calc(100% - 2×side-clearance - 4×dock-inset)`）、`max-width: card-max-width - 4×dock-inset`、
`height: 36`、`border-radius: 12`、`0.5px` 描边与 `--dsw-specific-tip` 底色。几何可证明不变：
原先内层宽度 = `min(wrapper 内容宽, cardMax - 32)`，合并后 = `min(父内容宽 - 64, cardMax - 32)`，
是同一条式子；居中由同一个 `margin: 0 auto` 承担。表面改成内联样式的一部分，因此天然压过任何样式表
规则，而且背景不可能画到自身 border-box 之外 —— 无论宿主或皮肤给 dock 行刷什么底，都不可能再在卡片
两侧露出来。

回归测试 `src/client.test.ts` 的 `client activity card structure` 锁死三件事：chip 只渲染一个
`<div`；dock 宽度轴与卡片表面必须声明在同一个 style 对象里；整个客户端只有一条 dock 宽度 calc
（不能再出现第二个「宽而无底」的盒子）。

## Alternatives considered

- **只在外层补一行内联 `background: transparent`**：改动最小，但如果底色其实是画在更外层
  （slot anchor / seat）就完全无效；而且把「这个 wrapper 是多余的」继续藏着，下一个照抄 GoalBar
  的人还会再造一个。
- **让卡片铺满 dock 行**（去掉 `max-width`，宽度 = `100%`）：视觉上也能盖住那条底，但卡片会比它
  下面的输入卡片更宽，并离开宿主 Todo/Goal/Queue 共用同一条内容轴的家族关系 —— 那是上一版刻意选的轴。
- **判为宿主/皮肤问题、不做代码修改**：实测到的是「高 36px、平色、硬边、颜色 = tip」的一块盒子，
  而输入遮罩是整列宽的渐变且会盖住 gap 行，两者形状不符；只解释不改代码也无法消除用户看到的那条底。
- **把 chip 挪出 `conversation.input.dock`**：躲开 dock 行，但丢掉「与输入框同一层」的位置语义 ——
  P06/路由/最终验收这条状态行的意义就在于它出现在输入框上方。
- **给 chip 加 `<style>` 注入去覆盖宿主规则**：要在别人的区域里插全局样式，污染面比收益大（上一版
  已经因为同样理由放弃过注入 keyframes）。

## Consequences

- 卡片保持同一条内容轴、同高同色，只是 DOM 少了一层；任何「给 dock 行/外层刷底」的宿主或皮肤规则都
  不可能再在卡片两侧露出一条遮罩。
- 「单元素 + 表面与几何同体」由测试锁死：再拆回两层会让 `pnpm test` 失败，而不是等用户在深色皮肤下
  看见一条浅色底。
- 本机 `pnpm run build` 的 `sync-installed-profiles` 失败：它会先删掉 profile 里的安装副本再跑
  `pnpm install`，而沙箱里 `pnpm install` 起不来，于是 profile 一度没有插件副本。这次按包的 `files`
  清单手动复制回 `~/.dsh/profiles/web/node_modules/dsh-llm-verifier`（109 个 lib 文件，已确认安装副本里的
  `lib/client.js` 含 `activityCard`、不再含 `activityDock`）；在有权限的终端里刷新 profile 仍建议跑一次
  profile 目录下的 `pnpm install`，或重跑 build 直到输出 `2 of 2 profile(s) refreshed`。
- 受限沙箱下 `pnpm test` 需要一次更宽的授权（esbuild 走管道 spawn，workspace-write 下 EPERM），
  本次已跑通 622 passed / 2 skipped。
