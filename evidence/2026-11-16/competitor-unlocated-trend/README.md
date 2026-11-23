# 未定位竞品自然排名连线验收（2026-11-16）

UAT 页面已更新并通过公网浏览器验证。此前竞品图仅按非空地域 cohort 连线，未定位记录因此全部显示为散点；本次只修复展示层。

## 行为与边界

- 同商家的自然排名，只有店铺、目标身份、渠道、关键词、点位、采集配置及解析版本完全一致时才连接同色虚线，最大间隔 36 小时。
- 各商家独立断线：未见、未知、只有广告、未通过质量校验、来源变化、重复/无效时间或长时间断档均不连接。无效时间无法定位时，该组保留有效散点并停止连线。
- 已定位记录原有 3 小时实线规则保持不变。地域 cohort 仍为空，保留“地域未核实”，不将未定位记录纳入 SoLV/ARP/ATRP，也不插值补历史数据。

## 验证

- 全量 117 个测试文件、2,096 项测试通过；新增 34 项单元回归和 1 项浏览器集成用例，保留先失败后通过日志。类型检查、构建及 diff 检查通过。
- 独立代码审查无阻断项，另行运行 46 项相关单元测试和 6 项浏览器集成测试通过。
- 公网真实页面：KEKE / 法拉盛 卤味 / r0c0 / 2026-11-02 至 2026-11-15，40 次观测、4 家选择商家，152 个排名点与 139 段虚线符合独立计算；部署前后完整 API 响应一致。
- 商家勾选及指标切换通过，无页面 JavaScript 错误，无额外竞品 API 或截图请求。桌面及手机截图已保留并查看；手机延续横向滚动图表。
- 初次公网回读出现短暂失败；浏览器验证脚本先后遇到水平 SVG 线可见性判断及动态勾选框定位超时。调整验证脚本后，最终公网验证退出 0，原失败日志保留。

## 发布与隔离

- UI 更新时间：2026-11-16 10:40:26 北京时间；公网浏览器最终检查：10:45:34。
- ACR 构建 `ch16bb`，镜像 `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:d400a3f2bc4fd0d838b1bbb60582510fc415eb6f2c1ea5e648a087a50939c25c`。
- 工作区源快照 `competitor-line-snapshot-8aa1b1c712686827`（不是 Git 提交），基于 `e0a5624f74cee4747a2be584a7cdeb393c1bd3c9`。构建输入 SHA256 与当前源文件一致。
- 只更新 `maps-tracking-ui` Deployment 的 UI 容器镜像。8 个 CronJob 的 UID/spec 和 9 个保留 Job 的 spec 前后完全一致；未改采集、词、点、资源、数据库、历史截图或其他项目。
- 上述部署验收发生在 Git 提交前；本修复的源码、测试和交接记录由包含此文件的提交归档。部署快照编号不是提交哈希，远端推送状态应以 Git 为准。回退 UI 可使用 `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:38bdfd4dc2a4eb3e9b64594b6c499d6914ca8cee1677cd964cff1b62c508dd1c`；无需修改采集任务。

## 证据

持久证据目录：`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/competitor-unlocated-trend-2026-11-16`。

包含 source.json、原始测试日志、validation.json、expected-real-render.json、部署前后快照、rollout-result.json、公网 API 回读、live-browser.json 和 uat-competitors-desktop/mobile.png。原始凭据未写入文件；认证仅保存在检查进程内存中。
