# Neo4j JSONL 模式与映射规则

## 概述

本规范定义了StoryMaster系统中Neo4j图数据库的JSONL导入格式、映射规则和操作语义。规范基于系统设计原则与关键约束，确保时间=记忆定位、空间=行动判定/遮挡的核心语义在图结构中得到体现，支持10万+节点并发和事件溯源回放。

## 核心设计原则

- 时间=记忆定位：通过MemoryAnchor和TimeNode节点实现事件时间定位，支持valid_time/record_time双时态模型
- 空间=行动判定/遮挡：通过Spatial节点和空间关系支持可达性、遮挡、视线等空间计算
- 事件源化：Event节点作为一等公民，支持完整的状态变更追踪和回放
- 多标签策略：域标签+层级标签+实体类型标签+版本态标签的组合标识
- 稳定键设计：全局唯一稳定ID支持分布式环境下的实体识别和去重

## 1) JSONL 记录通用结构

- 记录种类：node/relationship 两类；保留字段：kind/op/schema_version/source
- 操作语义：create/merge/delete；默认 merge；幂等基于稳定键+版本态；记录 ingestion_id 追溯
- 通用属性：每行JSONL记录必须包含kind字段标识记录类型；op字段标识操作类型
- 版本控制：schema_version字段标识模式版本；source字段标识数据来源
- 追溯能力：ingestion_id全局唯一，支持导入过程追踪和问题定位

## 2) 节点记录模式（Node Line）

- 必填：id（stable_id）、labels（多标签）、props（键值）；禁止复制大文本，引用型上下文仅存引用ID
- 标签规则：域标签（Architecture/Data/Policy/Event/Spatial/Temporal）+ 层级标签（Layer:...）+ 实体类型（Module/Processor/...）+ 版本态（Draft/Published）
- 版本与可见性：props 含 valid_time{from,to}/record_time{at}、audience/visibility_scope/spoiler_level
- 时空：Spatial 节点含 space_level/coord_ref/approx_level；Temporal/MemoryAnchor 节点含 time_index/interval_ref
- 引用设计：大文本内容仅存储引用ID，实际内容通过对象存储访问
- 标签层次：主标签标识实体类型，次标签标识域和层级，版本标签标识状态
- 属性约束：核心属性必填，可选属性按需添加，禁止嵌套对象结构

## 3) 关系记录模式（Relationship Line）

- 必填：type、from、to、props；type 采用全大写动词短语（DEPENDS_ON/EMITS/...）
- 方向与基数：默认有向；按设计文档给出主要关系表（CONTAINS/DEPENDS_ON/EMITS/CAUSAL/DERIVES/LOCATED_IN/OCCURS_AT/REFS_VISIBLE/...）
- 版本与可见性：关系 props 含 valid_time/record_time/audience；关系与对应节点版本需可验证
- 关系权重：部分关系支持权重属性，用于表示强度或优先级
- 关系属性：除通用属性外，可包含特定关系类型的专有属性
- 基数约束：1:1、1:N、N:N关系在导入时进行基数验证
- 自环处理：允许特定类型的自环关系，需明确标注

## 4) 稳定键与去重

- 稳定ID：type:namespace:ulid；模块建议 module:{layer}:{name_slug}:{ulid}；事件建议 event:{session}:{seq}
- 去重键：node=stable_id；relationship=from+type+to+version_state；导入器按 op=merge 去重
- ID生成：ULID保证时间有序性和全局唯一性，支持分布式生成
- 命名空间：按域和层级划分命名空间，避免ID冲突
- 版本状态：通过版本状态区分同一实体的不同版本
- 去重策略：导入时基于去重键进行合并，保留最新版本
- 冲突解决：版本冲突时基于record_time时间戳解决

## 5) 标签与命名规范

- 层标签：Layer:Ingress/Orchestration/Parsing/Context/Execution/SystemPolicy/Data/Governance/Infra
- 实体标签：Module/AgentRouter/StateMachineRouter/SceneProcessor/BehaviorProcessor/TimeDriver/IndividualProcessor/GroupProcessor/DMStyle/DicePolicy/Queue/Store
- 事件标签：Event/DecisionEvent/StateTransition/MemoryAnchor/BackpressureEvent/RetryAttempt/DeadLetter
- 标签组合：主标签+域标签+层级标签+版本标签的组合模式
- 命名约定：标签采用PascalCase，关系采用UPPER_SNAKE_CASE
- 版本标签：Draft/Published/Archived/Deprecated标识不同状态
- 保留标签：System、Internal等保留标签用于系统内部管理

## 6) 架构域对象 → 图元素映射

- 层（Layer）→ 节点(Layer)+关系(CONTAINS Module)
- 模块（Module）→ 节点(Module 子类标签)+关系(DEPENDS_ON/EMITS/CONSUMES/GOVERNS/OPERATES_ON)
- 事件（Event/MemoryAnchor/DecisionEvent）→ 节点(Event)+关系(CAUSAL/EMITS/OCCURS_AT/PERTAINS_TO)
- 策略（DMStyle/DicePolicy）→ 节点(Policy 子类)+关系(APPLIES_TO/GOVERNS/VALID_DURING)
- 数据域（Actor/Scene/Organization/Item）→ 节点；执行投影→ 关系(AFFECTS/LOCATED_IN/BELONGS_TO)
- 并发与队列（Queue/Retry/DLQ）→ 节点+关系(EMITS/RETRIES/DEAD_LETTERED/APPLIES_TO)
- 映射原则：单一事实来源，避免数据冗余，通过关系表达关联
- 投影模式：读模型投影作为虚拟节点，不存储实际数据
- 跨域引用：通过稳定ID实现跨域引用，保证引用完整性

## 7) 时间与记忆映射

- MemoryAnchor：节点含 valid_time/record_time/anchor_type/source_event；关系 REMEMBERS/RECORDED_AT
- 长事务区间：Event 序列用 NEXT/PREV；区间用 VALID_DURING(from,to)；回放用 REFS_VISIBLE 到上下文快照
- 时间锚点：每个MemoryAnchor作为时间轴上的锚点，支持时间定位
- 事件链：通过NEXT/PREV关系构建事件链，支持顺序回放
- 时间区间：VALID_DURING关系表示实体在特定时间段内有效
- 记忆引用：REFS_VISIBLE关系表示上下文快照引用的可见数据
- 时间版本：通过valid_time和record_time双时态模型支持时间查询

## 8) 空间与可达性映射

- Spatial 节点：Scene/Location/PathNode/CoverCell/LosSegment；props 含 approx_level/coord_ref
- 可达性/遮挡关系：NAV_TO/PATH_TO/COVERED_BY/BLOCKED_BY/HAS_LOS_TO；关系带 space_version 与 valid_time
- 空间层级：Scene包含Location，Location包含PathNode和CoverCell
- 近似等级：approx_level属性标识空间计算的近似精度
- 坐标引用：coord_ref属性引用坐标系统，支持多坐标系统
- 可达性：NAV_TO/PATH_TO关系表示路径可达性，支持权重属性
- 遮挡计算：COVERED_BY/BLOCKED_BY/HAS_LOS_TO关系支持空间遮挡判定

## 9) 可见性与权限映射

- audience=System/Player/NPC；visibility_scope=own/team/global；spoiler_level 分级
- 上下文引用节点：VisibilitySlice/ContextSnapshot；仅引用可见片段；关系 REFS_VISIBLE 标注裁剪依据
- 权限层级：System>Player>NPC的权限层级，支持细粒度控制
- 可见范围：own/team/global三级可见性范围，支持动态调整
- 剧透控制：spoiler_level分级控制剧透信息的可见性
- 上下文切片：VisibilitySlice节点表示特定角色的可见上下文
- 裁剪依据：REFS_VISIBLE关系标注上下文裁剪的依据和规则

## 10) 分块与导入策略

- 文件切分：architecture_nodes.jsonl、architecture_rels.jsonl；每块≤100MB 或≤1e6 行；按域/层分块
- 导入流程：预校验（键唯一/引用存在/时态合法）→ 批量 merge → 校验报告；失败回滚或标注死信
- 幂等导入：重复导入不产生重复边；删除用 op=delete+墓碑保留策略（可选）
- 分块策略：按实体类型和关系类型分块，优化导入性能
- 依赖处理：先导入节点，后导入关系，保证引用完整性
- 批量操作：支持批量merge操作，提高导入效率
- 错误处理：导入错误时记录详细日志，支持部分重试
- 事务边界：每个分块作为一个事务，保证原子性

## 11) SLO 与观测

- 导入性能：≥50k lines/min（单实例）可配置；失败率≤0.1%；去重命中≥99.9%
- 指标：lines_ingested/s、merge_conflict_rate、dedupe_hit_rate、invalid_ref_count、valid_time_violation_count
- 性能监控：实时监控导入速度、错误率、资源使用情况
- 质量指标：监控数据质量指标，包括完整性、一致性、准确性
- 告警机制：超过SLO阈值时自动告警，支持多级告警
- 性能调优：基于监控数据自动调整导入参数，优化性能
- 容量规划：基于历史数据预测容量需求，提前扩容

## 12) 质量门槛与验收

- SchemaVersion 一致；节点/关系必填项完整；跨引用通过；时态合法；标签组合合法（层+实体类型）
- 回放一致：按稳定键重建子图一致率≥99.9%；可见性裁剪抽样校验通过
- 数据校验：导入前进行完整性和一致性校验
- 模式验证：验证数据是否符合预定义的模式规范
- 引用完整性：确保所有引用都指向存在的实体
- 时态一致性：验证时间相关属性的一致性和合理性
- 标签规范：验证标签组合的合法性，禁止非法组合
- 回放测试：通过回放验证数据的一致性和完整性

## 13) 开放问题清单

- op=delete 墓碑策略是否启用；事件与执行的存活期与归档窗口；空间 approx_level 默认与切换阈值
- 关系类型白名单最终集；命名空间与多租户策略；导入并行度与背压阈值
- 墓碑策略：删除操作是否采用墓碑标记，影响数据保留策略
- 归档窗口：事件和执行数据的保留周期和归档策略
- 近似阈值：空间近似等级的默认值和动态切换阈值
- 关系白名单：最终确定允许的关系类型白名单
- 多租户隔离：多租户环境下的命名空间隔离策略
- 并行导入：导入操作的并行度和背压控制阈值

## 实施指导

### 导入顺序
1. 先导入所有节点记录，确保引用完整性
2. 按依赖关系顺序导入关系记录，避免引用缺失
3. 最后导入跨域关系，完成整体图结构构建

### 性能优化
- 按标签和属性创建适当索引，优化查询性能
- 使用批量操作减少网络开销
- 合理设置分块大小，平衡内存使用和导入效率

### 监控与维护
- 定期检查数据一致性和完整性
- 监控导入性能指标，及时调整参数
- 建立数据质量评估机制，确保数据质量

## 完成条件

本规范满足以下完成条件：
- 覆盖13个核心部分，规则清晰可检验
- 与既有文档术语一致，可直接指导第9步"小样 JSONL 导出（校准）"
- 显式体现"时间=记忆定位"和"空间=行动判定/遮挡"在JSONL字段与标签中的体现
- 提供完整的质量门槛、SLO指标和开放问题清单
- 支持系统设计原则中的10万+节点并发和事件溯源回放需求