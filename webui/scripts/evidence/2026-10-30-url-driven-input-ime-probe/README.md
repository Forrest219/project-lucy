# SC-17 真浏览器 IME 组合探针 —— 原始证据归档

| 项 | 内容 |
|---|---|
| 证据对象 | [`docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md`](../../../../docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md) §6.3 **SC-17**（真实浏览器验收） |
| 产生脚本 | [`webui/scripts/ime-composition-probe.mjs`](../../ime-composition-probe.mjs)（随实现入库，见 commit `f4630d57`，此后未改） |
| 产生时间 | 2026-10-30 01:12（UTC+8） |
| 证据等级 | **A 级——真实浏览器**。系统 Chrome `156.0.8078.73` + CDP `Input.imeSetComposition` 驱动真实 IME 组合序列。jsdom 结果**不得**充当本项证据（Spec §1.2 已实测 jsdom 不可复现） |
| 归档原因 | 探针脚本的默认输出目录是 `inbox/ime-composition/probe/`，而 `inbox/` 被 `.gitignore` 排除。原始输出若只留在工作区，收口后第三方无法复查。本目录是该次运行的**入库副本**，内容与工作区原件逐字节一致 |

## 文件

| 文件 | 内容 |
|---|---|
| `probe/chrome-version.txt` | 探针运行时读到的浏览器版本（`Chrome/156.0.8078.73`） |
| `probe/ime-composition-probe-output.txt` | 人读摘要：15 个受测输入框的 `compositionstart` 计数、最终 DOM 值、组合期间 `value` setter 次数、焦点保持、结论 |
| `probe/ime-composition-probe-output.json` | 机读全量：每个输入框的 `trace`（`compositionstart` / `compositionupdate` / `input` 事件序列）、路由、选择器、URL 参数名 |
| `lint-baseline-before.txt` | 静态门禁**改造前**基线：恰好 13 处 URL 驱动受控输入框（Spec §2.1 全表） |
| `lint-baseline-after.txt` | 静态门禁**改造后**结果：0 处 |

## 这次证明了什么

- **13 处目标输入框逐处通过**：`compositionstart` = 1、最终 DOM 值 = `中文`、组合期间 `HTMLInputElement.prototype.value` setter 调用 = 0、焦点保持。
- **同页对照件仍能复现原缺陷**：`control-url-driven`（URL 驱动写法）得到 `compositionstart` = 3、最终值 `zhongzhongwen中文`、value setter = 6；`control-local-state`（局部状态镜像写法）得到 1 / `中文` / 0。**探针本身有效**——它没有把缺陷一起测没。

对照件与 13 处目标输入框在同一次运行、同一份代码、同一浏览器里产出，因此构成有效对照。

## 复现

```bash
# 1. 起 WebUI（探针会自己在 5199 端口起一个临时 vite 入口，跑完自动清理）
# 2. 跑探针：输出写到 inbox/ime-composition/probe/（脚本的默认输出目录）
node webui/scripts/ime-composition-probe.mjs

# 3. 把输出归档到本目录
cp inbox/ime-composition/probe/*  webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/probe/
```

探针依赖**系统已安装的 Chrome**（不是 Playwright 自带的 Chromium），并以 `--headless=new` 启动，通过 CDP 端口 9333 驱动 `Input.imeSetComposition`。因此它**不进 CI**，只作一次性验收证据（Spec §4 D3=(a)、§7.3 风险表）。

## 边界

- 本证据只覆盖 SC-17（组合存活 / 最终值 / 焦点 / 不写 DOM 值）。**不覆盖** SC-18–SC-23（伴生缺陷、回声协议、回归与消费点 trim），那些由 vitest 用例承担。
- 探针记录 `urlParam` 作为元数据，但**不**断言 URL 参数被写入。SC-01 条件 2（URL 立即等于原文）由 vitest 逐处断言，见 `webui/src/__tests__/admin-audit-url-mirror.test.tsx` 与 `webui/src/__tests__/url-driven-input-mirror-contract.test.tsx`。
- Safari / WebKit 与真实 OS 级输入法（macOS 拼音、Windows 微软拼音）**未实测**，Firefox **未实测**（Spec §1.2 C 级）。
