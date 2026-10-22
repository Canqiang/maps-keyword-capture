# 九店 90 词监控目录

> **2026-10-22 起，门店配置以 Mongo `monitor-target-stores-v1` 为准，在页面“门店设置”里维护。** Web 采集任务 `maps-targets-web-2h` 每轮开始时从这个集合读取所有启用门店、监控关键词、目标名次和采集点，不再读取本目录文件，也不再校验目录哈希。新商家在页面上新增门店、填写监控关键词即可进入下一轮采集。每次保存都记入 `monitor-target-stores-v1-changes`（修改人、时间、改动字段、增删的监控词）。本目录文件仅作为 10 月 16 日报告的原始记录和首次导入来源；Android 候选任务（挂起中）仍使用它。
>
> 监控关键词默认在门店的每个采集点各搜一次；`scanPoints` 可把某个词限定在部分采集点（例如带城市名的词，Google 会忽略地图位置把结果拉回该城市）。Keke 原两小时任务的 41 个词已按“仅中心点”并入 Keke 的配置，`maps-tracking-web-2h` 已挂起。Web 任务分 3 片并行。

`deploy/tracking-targets/liya-90-v1.json` 固定了 Liya 报告首表的 90 个门店与精确查询组合、27 个固定点及270份点位目标。原文、文档日期、SHA256、每个目标单元格和历史证据引用均随目录保存。它不是一次新采集，10月16日基线不会写成今天的观察。

两个界面均使用 `point` 层级，每两小时调度一次；每店在“中心、3公里、5公里”各一个明确坐标采样。每界面每轮270查询，两界面共540查询。固定点不是25点方格，也不是半径覆盖；方格扫描在配置中关闭。调度频率不表示每轮已完成，实际运行和结果应以扫描回执为准。

## 离线检查

```sh
npm run tracking -- plan --config deploy/tracking-targets/tracking.json --catalog deploy/tracking-targets/liya-90-v1.json --surface web --tier point --format web-batches
npm run tracking -- plan --config deploy/tracking-targets/tracking.json --catalog deploy/tracking-targets/liya-90-v1.json --surface android --tier point --format android-runs
```

输出应分别为27个Web批次和14个Android批次，共270任务；Android每批最多20任务。实际调度可通过已有 `--shard-index` / `--shard-count` 对门店稳定分片。默认仍使用原哈希策略；新任务加上 `--shard-strategy balanced`，按指定界面、层级的实际查询数由大到小分配，并执行一次改善负载的门店交换。九店两分片为138/132查询，完整门店不拆开，同一目录的分配确定不变。

## 导入和身份

九店计划使用独立的 `monitor-target-stores-v1` 门店集合；观察仍保存在原 `observations` 集合。现有 `stores` 集合、`maps-tracking-web-2h` 采集器及其配置保持不变。新调度命名为 `maps-targets-web-2h` 与 `maps-targets-android-2h`，UI使用新目标配置。

先把历史快照导入 `monitor-target-stores-v1`（新增历史门店初始为inactive），再导入本目录激活九家：

```sh
npm run tracking -- stores --config deploy/tracking-targets/tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI --import-catalog deploy/tracking-targets/liya-90-v1.json
```

目录按Place ID与目标集合的现有门店对齐，复用历史storeId。导入仅保存独立目标集合中九家门店；不删除其他店、不改共享SEO词库和原`stores`集合、不修改或删除观察记录。`keywords`保存既有及新词库存，`keywordTargets`明确本轮90词的采集范围。重复导入不会复制门店或关键词。若历史门店中心为空，经此目录导入可补齐报告坐标；已有非空中心不能静默改坐标。

新采样点ID使用报告ID（例如`keke-center`、`keke-3km`、`keke-5km`），保留旧`r0c0`与原方格点历史。新门店概览使用当前中心和active目标词；旧点和退出词继续由历史接口读取。观察以原有稳定observationId入库，同一回执重放不新增重复观察，不会覆盖其他运行。

## 元数据与证据边界

`fixedPoints`提供固定坐标、标签、方向和源记录；`monitoringCatalog`提供版本及报告来源；`keywordTargets[].pointTargets`保留阶段目标和原基线。正在执行的扫描将其复制到`observation.monitoringTarget`，手工历史入库默认不把当前目录追填到旧观察。这个快照表明计划来源，不代表GPS已核验或目标已达成。

90词含主攻、辅助、观察与待业务核实项，保留原条件。27个待测词的“前10”仅为候选方向。搜索量是城市Google Search口径，不能当作Maps排名或跨城市门店价值。含地名旧查询的名次不迁移给去地名新查询。

每次采集仍需自身截图、顺序/广告分类、身份及定位证据。`NR20`至少需要20条自然结果；20条含广告展示结果不足以证明NR20。Web与Android分别分组，不直接合成一条排名曲线。原54词和新增25词的历史采集时段不同，不能据此解释为排名上涨或下跌。
