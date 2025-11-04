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
## 终稿 v1.0.0（用于生成完整 JSONL）

本分节在不修改历史章节的基础上，固化最终 JSONL 模式与映射规则，直接约束生成与校验逻辑。所有字段名/取值均可直接落地，不留待定项。

### 0) 前置全局预设对齐（必须体现）

- DM 风格：叙事优先（NarrativeFirst），随机度≈0.1，仅争议判定掷骰（dispute_only=true）。
- 时间驱动：Tick=5 秒；时间桶=time_bucket=minute；TimeNode 使用 ISO-8601（UTC，带 Z）。
- 并发一致性：每场景 shards=8；消息投递语义=at_least_once（至少一次）；幂等与去重固化在稳定键规则。
- 模型适配器偏好：优先 OpenAI，再 Anthropic；端点标签偏好：roleplay/long_context（必要时 reasoning/paid）。
- 术语/字段与现有样本与前端一致：nodes/rels 样本见 samples/neo4j/full_architecture_*.jsonl；中文映射见 js/zh-mapping.js；数据加载见 js/data-loader.js。

---

## A) 标签族与节点类型（Nodes，终稿）

本节定义节点标签族、用途与字段字典。除特别说明外，节点公共字段如下。

- 记录层级
  - kind: string, 必填, 固定为 "node"
  - op: string, 必填, 枚举 {"merge","create","delete"}，默认 "merge"
  - schema_version: string, 必填, 例如 "1.0.0"
  - source: string, 必填
  - ingestion_id: string, 必填（本次导入批次唯一）
  - ingested_at: string(ISO), 可选（导入时间，增强审计）
- 身份与标签
  - id: string, 必填（稳定主键 stable_id，命名规则见“D”）
  - labels: string[], 必填（多标签，采用域标签+实体类型+细分类）
- 属性 props（除 valid_time/record_time 外不允许嵌套对象）
  - name: string, 可选（可视化与对齐中文映射时优先展示）
  - version_state: string, 必填, 枚举 {"Draft","Published","Archived","Deprecated"}，默认 "Published"
  - valid_time: {from:string,to:string}, 必填（from/to 支持 "-INF" / "+INF"）
  - record_time: {at:string}, 必填（ISO-8601）
  - audience: string, 必填, 枚举 {"System","Player","NPC"}，默认 "System"
  - visibility_scope: string, 必填, 枚举 {"own","team","global"}，默认 "global"
  - spoiler_level: number, 必填，默认 0

以下为节点类型清单与字段字典。键名均在 props 中，除 id/labels 外。

1. Layer（层）
- labels: ["Architecture","Layer",LayerName]（如 "Orchestration"/"Execution"）
- 用途：分层容器，生命周期无界
- 字段：name(required), valid_time.from=-INF, valid_time.to=+INF，余同公共字段
- 稳定主键：id="layer:{layer_slug}:{ulid}"

2. Module（模块，子类标签）
- labels: ["Architecture","Module",SubType]；SubType ∈ {AgentRouter,StateMachineRouter,ParserAdapter,EntityExtractor,SceneProcessor,BehaviorProcessor,TimeEngine,IndividualProcessor,GroupProcessor,ModelAdapter}
- 用途：系统功能模块
- 字段：
  - layer: string(required, "Orchestration"|"Execution"|...)
  - TimeEngine 专属：tick_seconds(number, default=5), time_bucket("minute")
  - BehaviorProcessor 专属：concurrency:{shards:number=8, semantics:"at_least_once"}（可拍平成 shards/semantics 两字段）
- 稳定主键：id="module:{layer_slug}:{name_slug}:{ulid}"

3. Policy（策略，子类标签）
- DMStyle: labels ["Policy","DMStyle"]
  - preset:string，可选；random_weight:number(≈0.1)；dispute_only:boolean(true)
- DicePolicy: labels ["Policy","DicePolicy"]
  - dice_type:string("D20"), crit:number(20), fumble:number(1)
- AdapterPolicy: labels ["Policy","AdapterPolicy"]
  - timeout_policy:string("enabled"), retry_policy:string("exponential_backoff"), circuit_breaker:string("enabled"), key_rotation_strategy:string("round_robin"), output_normalization:string("project_schema_v1")
- 稳定主键：id="policy:{subtype}:{slug}:{ulid}"

4. Scene（场景）
- labels: ["Data","Scene","Spatial"]
- 字段：coord_ref:string("cartesian"), space_level:string("3D"), approx_level:string("L1")
- 稳定主键：id="scene:{ns}:{scene_slug}:{ulid}"

5. Location（地点）
- labels: ["Data","Location","Spatial"]
- 字段：scene_id:string(required, 指向 Scene 的 id), coord_ref, space_level, approx_level
- 稳定主键：id="location:{ns}:{location_slug}:{ulid}"

6. LosSegment（视线遮挡段）
- labels: ["Spatial","LosSegment"]
- 字段：space_version:string(required), coord_ref, approx_level
- 稳定主键：id="los:{ns}:{scene_slug}:{segment_slug}:{ulid}"

7. Actor（角色）
- labels: ["Data","Actor","Player"] 或 ["Data","Actor","NPC"]
- 字段：role:string("Player"|"NPC"), perception_range:number
- 稳定主键：id="actor:{ns}:{actor_slug}:{ulid}"

8. Event（事件，子类标签）
- ParsingEvent: labels ["Event","ParsingEvent"]（event_type:string, session_id:string, seq:number）
- DecisionEvent: labels ["Event","DecisionEvent"]（event_type:string, session_id:string, seq:number）
- StateTransition: labels ["Event","StateTransition"]（from_state:string, to_state:string, session_id:string, seq:number）
- 命名与时态：事件命名 event_type 用过去式语义（如 "RoutingDecision" 表示已生效的决定）
- 稳定主键：id="event|decision|state_transition:{session}:{seq}:{ulid}"

9. MemoryAnchor（记忆锚点）
- labels: ["Temporal","MemoryAnchor"]
- 字段：anchor_type:string(required), source_event:string(required, 事件 id)
- 稳定主键：id="mem:{session}:{seq}:{ulid}"

10. TimeNode（时间节点）
- labels: ["Temporal","TimeNode"]
- 字段：iso:string(ISO-8601, Z 结尾), bucket:string("minute")
- 稳定主键：id="time:{ns}:{iso}:{ulid}"

11. UpstreamChannel（上游渠道）
- labels: ["Service","UpstreamChannel","LLM"]
- 字段：provider:string("OpenAI"|"Anthropic"|...), lb_strategy:string("key_round_robin")
- 稳定主键：id="channel:llm:{provider_slug}:{ulid}"

12. ModelEndpoint（模型端点）
- labels: ["Service","ModelEndpoint","LLM"]
- 字段：provider:string, tier:string("paid"|"free"), context_class:string("long"|"short")
- 稳定主键：id="model:endpoint:{provider_slug}:{endpoint_slug}:{ulid}"

13. ModelTag（模型标签）
- labels: ["Taxonomy","ModelTag"]
- 字段：name:string(required), category:string("capability"|"billing"|...)
- 稳定主键：id="model_tag:{tag_slug}:{ulid}"

14. ModelGroup（模型分组）
- labels: ["Taxonomy","ModelGroup"]
- 字段：name:string(required), purpose:string("selection_group")
- 稳定主键：id="model_group:{group_slug}:{ulid}"

15. ActionPlan（行动计划，若使用）
- labels: ["Data","ActionPlan"]
- 字段：actor_id:string(required), intent:string(required), target_ref:string(optional), status:string("Planned"|"Approved"|"Cancelled")，duration_ms:number(optional)
- 稳定主键：id="action_plan:{ns}:{actor_slug}:{plan_slug}:{ulid}"

16. Execution（执行记录，若使用）
- labels: ["Data","Execution"]
- 字段：plan_id:string(required), success:boolean(optional), duration_ms:number(optional)
- 稳定主键：id="execution:{ns}:{exec_slug_or_plan_ulid}:{ulid}"

---

## B) 关系类型（Relationships，终稿）

通用字段（所有关系记录）
- 记录层级
  - kind: "relationship"（固定）, op:"merge"(默认), schema_version, source, ingestion_id, ingested_at(可选)
  - type: string（大写动词，必填）
  - from: string（起点 id，必填）
  - to: string（终点 id，必填）
- props
  - version_state: string，默认 "Published"
  - valid_time: {from,to}，除特别说明默认 from=record_time.at, to="9999-12-31T00:00:00Z"
  - record_time: {at}（必填）
  - audience/visibility_scope/spoiler_level（按需）

去重键与导入约定
- 去重键：from + type + to + version_state（若未显式提供 version_state，视为 "Published"）
- 导入 op：统一使用 op="merge"
- 冲突解决：同键冲突按 record_time.at 最大者覆盖；必要时按 source 优先级（System > Policy > Data）

终稿关系清单与端点/属性

1) CONTAINS
- 起点: Layer；终点: Module
- props：valid_time.from=-INF, to=+INF；audience="System"
- 继承：不继承节点时间/可见性，独立声明
- 去重键：from+CONTAINS+to+version_state

2) DEPENDS_ON
- 起点: Module；终点: Module
- props：默认时间点（from=record_time.at）
- 继承：不继承
- 说明：可多条（N:N），无环约束由离线校验

3) GOVERNS
- 起点: Policy；终点: Module
- props：默认时间点
- 继承：不继承

4) APPLIES_TO
- 起点: Policy.DMStyle；终点: Scene|Actor（可扩展至 Session）
- props：默认时间点

5) LOCATED_IN
- 起点: Actor|Location|LosSegment；终点: Scene|Location
- props：Scene/Location 层级关系长期有效可用 from=-INF

6) COVERED_BY
- 起点: Actor；终点: LosSegment
- props：cover_level:string("partial"|"full")，space_version:string

7) HAS_LOS_TO
- 起点: Actor；终点: Actor|Location
- props：value:boolean(required), reason:string("blocked_by"|"in_range"|...)，space_version:string(required)

8) EMITS
- 起点: Module；终点: Event（Parsing|Decision|StateTransition）
- props：默认时间点

9) CAUSAL
- 起点: Event；终点: Event|MemoryAnchor
- props：默认时间点

10) OCCURS_AT
- 起点: Event；终点: TimeNode
- props：默认时间点

11) RECORDED_AT
- 起点: MemoryAnchor；终点: TimeNode
- props：默认时间点

12) PERTAINS_TO
- 起点: Event；终点: Actor|Scene
- props：默认时间点

13) REMEMBERS
- 起点: Actor；终点: MemoryAnchor
- props：audience 可为 Player（自有记忆）

14) ROUTES_TO
- 起点: Module.ModelAdapter；终点: UpstreamChannel
- props：默认时间点

15) PROVIDES
- 起点: UpstreamChannel；终点: ModelEndpoint
- props：默认时间点

16) HAS_TAG
- 起点: ModelEndpoint；终点: ModelTag
- props：默认时间点

17) MEMBER_OF
- 起点: ModelEndpoint；终点: ModelGroup
- props：默认时间点

18) FALLBACKS_TO
- 起点: ModelEndpoint；终点: ModelEndpoint
- props：默认时间点；语义：回退链路（权重/优先级可后续扩展）

---

## C) 时态与导入元数据（统一）

- JSONL 行公共元字段：op、schema_version、source、ingestion_id（必填）、ingested_at（可选）、kind。
- 时间语义
  - Layer 节点与 CONTAINS 关系：valid_time.from = "-INF"，valid_time.to = "+INF"
  - 其他实体：若未指定，默认 valid_time.from = record_time.at；valid_time.to = "9999-12-31T00:00:00Z"
  - time_bucket 固定 "minute"
  - TimeNode 命名与 ISO 规范：id="time:{ns}:{iso}:{ulid}"，props.iso 为 ISO-8601（UTC，Z）
- 事件命名/过去式规则：事件 event_type 表达已发生的语义（e.g. "RoutingDecision"），命名以动作完成态为主
- 最小必备关系集：事件链与记忆锚点至少包含 EMITS、OCCURS_AT、RECORDED_AT、REMEMBERS

---

## D) 幂等、去重与“至少一次”对齐（图谱层）

- 节点去重键：id（stable_id）或“业务键+version_state”的稳定组合（ActionPlan/Execution/Event 推荐含 session/seq）
- 关系去重键：from+type+to+version_state（version_state 缺省视为 "Published"）
- 导入策略：op=merge 全量重复可重放；冲突以 record_time.at 最大者覆盖；必要时以 source 优先级二裁
- 记录幂等命中（建议）：props 可追加 import_hits:number（累计命中次数），last_ingested_at:string（ISO）；保持扁平（除 valid_time/record_time 外不嵌套）
- 至少一次：允许重复投递；以稳定键与去重键抑制重复落库；失败重试不改变语义

---

## E) 模块与事件映射清单（含最小示例）

说明：以下示例与现有样本字段对齐，可直接用于生成/校验。示例中的 ULID 与时间仅供展示。

1) 层与模块（编排层、执行层与核心模块）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"layer:orchestration:01JBCF0000000000000000L001","labels":["Architecture","Layer","Orchestration"],"props":{"name":"Orchestration","version_state":"Published","valid_time":{"from":"-INF","to":"+INF"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"module:execution:time_engine:01JBCF0000000000000000M001","labels":["Architecture","Module","TimeEngine"],"props":{"name":"TimeEngine","layer":"Execution","tick_seconds":5,"time_bucket":"minute","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
```
```json
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"CONTAINS","from":"layer:orchestration:01JBCF0000000000000000L001","to":"module:execution:time_engine:01JBCF0000000000000000M001","props":{"valid_time":{"from":"-INF","to":"+INF"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
```

2) 策略（DMStyle、DicePolicy、AdapterPolicy）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"policy:dmstyle:narrative_first:01JBCF0000000000000000P001","labels":["Policy","DMStyle"],"props":{"name":"NarrativeFirst","random_weight":0.1,"dispute_only":true,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"policy:dice:standard_d20:01JBCF0000000000000000P002","labels":["Policy","DicePolicy"],"props":{"name":"StandardD20","dice_type":"D20","crit":20,"fumble":1,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"policy:adapter:model_adapter_policy:01JBCF0000000000000000P003","labels":["Policy","AdapterPolicy"],"props":{"name":"ModelAdapterPolicy","timeout_policy":"enabled","retry_policy":"exponential_backoff","circuit_breaker":"enabled","key_rotation_strategy":"round_robin","output_normalization":"project_schema_v1","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
```
```json
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"APPLIES_TO","from":"policy:dmstyle:narrative_first:01JBCF0000000000000000P001","to":"scene:game1:tavern:01JBCF0000000000000000000D","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"GOVERNS","from":"policy:adapter:model_adapter_policy:01JBCF0000000000000000P003","to":"module:orchestration:model_adapter:01JBCF00000000000000000017","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
```

3) 模型适配器域（Channel/Endpoint/Tag/Group/回退链路）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"channel:llm:openai:01JBCF0000000000000000S001","labels":["Service","UpstreamChannel","LLM"],"props":{"name":"OpenAI","provider":"OpenAI","lb_strategy":"key_round_robin","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"model:endpoint:openai:gpt-4o-mini:01JBCF0000000000000000S002","labels":["Service","ModelEndpoint","LLM"],"props":{"name":"gpt-4o-mini","provider":"OpenAI","tier":"paid","context_class":"long","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"model_tag:roleplay:01JBCF0000000000000000T001","labels":["Taxonomy","ModelTag"],"props":{"name":"roleplay","category":"capability","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"model_group:long_context:01JBCF0000000000000000G001","labels":["Taxonomy","ModelGroup"],"props":{"name":"LongContext","purpose":"selection_group","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
```
```json
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"PROVIDES","from":"channel:llm:openai:01JBCF0000000000000000S001","to":"model:endpoint:openai:gpt-4o-mini:01JBCF0000000000000000S002","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"HAS_TAG","from":"model:endpoint:openai:gpt-4o-mini:01JBCF0000000000000000S002","to":"model_tag:roleplay:01JBCF0000000000000000T001","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"MEMBER_OF","from":"model:endpoint:openai:gpt-4o-mini:01JBCF0000000000000000S002","to":"model_group:long_context:01JBCF0000000000000000G001","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
```

4) 数据/空间/时间（Scene/Location/LosSegment/Actor/TimeNode/MemoryAnchor）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"scene:game1:tavern:01JBCF0000000000000000D001","labels":["Data","Scene","Spatial"],"props":{"name":"Tavern","coord_ref":"cartesian","space_level":"3D","approx_level":"L1","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"location:game1:tavern_mainhall:01JBCF0000000000000000D002","labels":["Data","Location","Spatial"],"props":{"name":"Main Hall","scene_id":"scene:game1:tavern:01JBCF0000000000000000D001","coord_ref":"cartesian","space_level":"3D","approx_level":"L1","version_state":"Published","valid_time":{"from":"-INF","to":"+INF"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"los:game1:tavern:pillar_A:01JBCF0000000000000000D003","labels":["Spatial","LosSegment"],"props":{"name":"Pillar-A","space_version":"v1","coord_ref":"cartesian","approx_level":"L1","version_state":"Published","valid_time":{"from":"-INF","to":"+INF"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"actor:game1:player_1:01JBCF0000000000000000A001","labels":["Data","Actor","Player"],"props":{"name":"Player-1","role":"Player","perception_range":20,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"Player","visibility_scope":"own","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"time:game1:2025-11-04T13:30:00Z:01JBCF0000000000000000T900","labels":["Temporal","TimeNode"],"props":{"iso":"2025-11-04T13:30:00Z","bucket":"minute","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"mem:sessA:0001:01JBCF0000000000000000M900","labels":["Temporal","MemoryAnchor"],"props":{"anchor_type":"StateTransition","source_event":"state_transition:sessA:0001:01JBCF0000000000000000E003","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
```
```json
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"LOCATED_IN","from":"actor:game1:player_1:01JBCF0000000000000000A001","to":"scene:game1:tavern:01JBCF0000000000000000D001","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"Player"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"COVERED_BY","from":"actor:game1:player_1:01JBCF0000000000000000A001","to":"los:game1:tavern:pillar_A:01JBCF0000000000000000D003","props":{"cover_level":"partial","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"HAS_LOS_TO","from":"actor:game1:player_1:01JBCF0000000000000000A001","to":"location:game1:tavern_mainhall:01JBCF0000000000000000D002","props":{"value":true,"reason":"in_range","space_version":"v1","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
```

5) 事件链（ParsingEvent / DecisionEvent / StateTransition）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"event:sessA:0001:01JBCF0000000000000000E001","labels":["Event","ParsingEvent"],"props":{"event_type":"UserUtterance","session_id":"sessA","seq":1,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"decision:sessA:0001:01JBCF0000000000000000E002","labels":["Event","DecisionEvent"],"props":{"event_type":"RoutingDecision","session_id":"sessA","seq":1,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"state_transition:sessA:0001:01JBCF0000000000000000E003","labels":["Event","StateTransition"],"props":{"from_state":"StoryOutside","to_state":"StoryInside","session_id":"sessA","seq":1,"version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System","visibility_scope":"global","spoiler_level":0}}
```
```json
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"EMITS","from":"module:orchestration:parser_adapter:01JBCF00000000000000000004","to":"event:sessA:0001:01JBCF0000000000000000E001","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"EMITS","from":"module:orchestration:agent_router:01JBCF00000000000000000002","to":"decision:sessA:0001:01JBCF0000000000000000E002","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"EMITS","from":"module:orchestration:state_machine_router:01JBCF00000000000000000003","to":"state_transition:sessA:0001:01JBCF0000000000000000E003","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"CAUSAL","from":"event:sessA:0001:01JBCF0000000000000000E001","to":"decision:sessA:0001:01JBCF0000000000000000E002","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"CAUSAL","from":"decision:sessA:0001:01JBCF0000000000000000E002","to":"state_transition:sessA:0001:01JBCF0000000000000000E003","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"OCCURS_AT","from":"decision:sessA:0001:01JBCF0000000000000000E002","to":"time:game1:2025-11-04T13:30:00Z:01JBCF0000000000000000T900","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"RECORDED_AT","from":"mem:sessA:0001:01JBCF0000000000000000M900","to":"time:game1:2025-11-04T13:30:00Z:01JBCF0000000000000000T900","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"System"}}
{"kind":"relationship","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","type":"REMEMBERS","from":"actor:game1:player_1:01JBCF0000000000000000A001","to":"mem:sessA:0001:01JBCF0000000000000000M900","props":{"valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"Player"}}
```

6) 行动与执行（ActionPlan / Execution）
```json
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"action_plan:game1:player_1:say_hello:01JBCF0000000000000000AP01","labels":["Data","ActionPlan"],"props":{"name":"SayHelloPlan","actor_id":"actor:game1:player_1:01JBCF0000000000000000A001","intent":"say","target_ref":"actor:game1:npc_guard:01JBCF00000000000000000011","status":"Planned","version_state":"Published","valid_time":{"from":"2025-11-04T13:30:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:30:00Z"},"audience":"Player","visibility_scope":"own","spoiler_level":0}}
{"kind":"node","op":"merge","schema_version":"1.0.0","source":"final-spec","ingestion_id":"spec-20251104","id":"execution:game1:say_hello_exec:01JBCF0000000000000000EX01","labels":["Data","Execution"],"props":{"name":"SayHelloExec","plan_id":"action_plan:game1:player_1:say_hello:01JBCF0000000000000000AP01","success":true,"duration_ms":1200,"version_state":"Published","valid_time":{"from":"2025-11-04T13:31:00Z","to":"9999-12-31T00:00:00Z"},"record_time":{"at":"2025-11-04T13:31:00Z"},"audience":"Player","visibility_scope":"own","spoiler_level":0}}
```
（ActionPlan/Execution 的领域关系如 INTENDS/EXECUTES/AFFECTS 可后续在白名单扩展，本终稿范围以实体与核心关系为主）

---

## F) 中文展示一致性约束（与前端一致）

- 名称展示优先级：props.name > 按 id 前缀映射的中文（js/zh-mapping.js 的 PREFIX_RULES）> 类型中文（fromLabelsToTypeZh）
- 中文别名：通过 id 前缀（如 "module:orchestration:model_adapter"、"policy:dmstyle:narrative_first"）在前端进行中文名/说明映射
- 关系中文：关系类型→中文映射固定见 js/zh-mapping.js REL_ZH
- 字段可视化清单（优先展示）
  - layer, version_state, tick_seconds, time_bucket, approx_level, concurrency.shards/semantics（或拍平字段）
  - provider, tier, context_class, lb_strategy, retry_policy, circuit_breaker, key_rotation_strategy
  - valid_time.from/to, record_time.at, audience, visibility_scope, spoiler_level
- 约束：生成 JSONL 时必须携带 props.version_state 与时态字段，以保证可视化 UI 的一致性；id 必须遵循前缀规则以命中中文映射

---

## 覆盖面与计数（最低门槛）

- 节点类别覆盖（不得少于样本）
  - Architecture: Layer≥2, Module≥9（含 ModelAdapter）
  - Policy: DMStyle≥1, DicePolicy≥1, AdapterPolicy≥1
  - Data/Spatial/Temporal: Scene≥1, Location≥1, LosSegment≥1, Actor≥2, TimeNode≥1, MemoryAnchor≥1
  - Service/Taxonomy: UpstreamChannel≥2, ModelEndpoint≥2, ModelTag≥3, ModelGroup≥2
  - 可选：ActionPlan≥1, Execution≥1
- 关系类别覆盖（不得少于样本）
  - CONTAINS/DEPENDS_ON/GOVERNS/APPLIES_TO/LOCATED_IN/COVERED_BY/HAS_LOS_TO/EMITS/CAUSAL/OCCURS_AT/RECORDED_AT/PERTAINS_TO/REMEMBERS/ROUTES_TO/PROVIDES/HAS_TAG/MEMBER_OF/FALLBACKS_TO
- 样本规模参考（不作为上限）
  - nodes 行数：≥ 样本 35；rels 行数：≥ 样本 60；允许扩容

---

## 完成判定（要点清单）

- 节点族：Layer/Module/Policy/Scene/Location/LosSegment/Actor/Event/MemoryAnchor/TimeNode/UpstreamChannel/ModelEndpoint/ModelTag/ModelGroup/ActionPlan/Execution 已定义字段字典、时态/可见性、稳定主键
- 关系集：终稿 18 种关系已定义端点约束、属性字典、时态/可见性策略、去重键与导入语义
- 公共元字段：op/schema_version/source/ingestion_id/ingested_at 一致；props.version_state/audience/visibility_scope/spoiler_level/valid_time/record_time 一致
- 幂等/去重：节点 id 稳定；关系去重键 from+type+to+version_state；冲突以 record_time.at 覆盖；至少一次通过去重要素抑制重放
- 示例列表：为每类对象给出 1-2 行可执行 JSONL 示例，与现有样本完全兼容
- 全局预设映射：DM 风格/时间驱动/并发一致性/模型偏好/中文可视化映射均落地到字段与命名规则