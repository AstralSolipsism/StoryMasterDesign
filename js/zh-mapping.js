/* 全中文映射：ID 前缀与标签族 → 中文名称/说明；关系类型 → 中文 */
(function(){
  const PREFIX_RULES = [
    {p:'module:orchestration:agent_router', n:'智能体路由', d:'决定承接上下文或参数，选择工具与模型，驱动解析与决策。'},
    {p:'module:orchestration:state_machine_router', n:'状态机路由', d:'判定故事内/外状态，驱动状态迁移与流程推进。'},
    {p:'module:orchestration:parser_adapter', n:'解析适配器', d:'将用户输入拆分为行为/发言/心理/场外发言并统一格式化。'},
    {p:'module:orchestration:entity_extractor', n:'实体发掘器', d:'识别文本中的实体并进行图检索对齐。'},
    {p:'module:orchestration:model_adapter', n:'模型适配器', d:'对接大模型：超时/重试/熔断与输出归一化，key 轮询负载均衡。'},
    {p:'module:execution:scene_processor', n:'场景处理器', d:'建立场景空间，处理描述、方位与距离计算。'},
    {p:'module:execution:behavior_processor', n:'行为处理器', d:'匹配行为规则，分发至专项智能体/逻辑（至少一次，8 分片）。'},
    {p:'module:execution:time_engine', n:'时间引擎', d:'5 秒 tick，分钟聚合桶，触发时间逻辑。'},
    {p:'module:execution:individual_processor', n:'个体处理器', d:'按距离/逻辑/周期激活个体，基于角色卡生成交互。'},
    {p:'module:execution:group_generator', n:'群体生成器', d:'动态生成路人/团体/组织/势力。'},
    {p:'policy:dmstyle:narrative_first', n:'叙事优先策略', d:'随机度 0.1，仅争议判定掷骰。'},
    {p:'policy:dice:standard_d20', n:'标准 D20 策略', d:'1 大失败，20 大成功。'},
    {p:'policy:adapter:model_adapter_policy', n:'模型适配器策略', d:'超时/重试/熔断与 key 轮询；输出归一化。'},
    {p:'scene:game1:tavern', n:'酒馆', d:'样例场景：酒馆（空间近似 L1）。'},
    {p:'location:game1:tavern_mainhall', n:'主厅', d:'酒馆主厅。'},
    {p:'los:game1:tavern:pillar_A', n:'石柱 A', d:'视线遮挡段。'},
    {p:'actor:game1:player_1', n:'玩家-1', d:'玩家角色，具备感知范围。'},
    {p:'actor:game1:npc_guard', n:'守卫-A', d:'NPC 角色，具备感知范围。'},
    {p:'event:sessA:0001', n:'解析事件', d:'用户发言的解析事件。'},
    {p:'decision:sessA:0001', n:'路由决策', d:'路由决策事件。'},
    {p:'state_transition:sessA:0001', n:'状态迁移', d:'从故事外进入故事内。'},
    {p:'mem:sessA:0001', n:'记忆锚点', d:'用于回放与溯源的记忆锚点。'},
    {p:'time:game1:2025-11-03T13:38:00Z', n:'时间节点', d:'2025-11-03 21:38:00（UTC+8）。'},
    {p:'channel:llm:openai', n:'OpenAI 渠道', d:'上游渠道，key 轮询。'},
    {p:'channel:llm:anthropic', n:'Anthropic 渠道', d:'上游渠道，key 轮询。'},
    {p:'model:endpoint:openai:gpt-4o-mini', n:'GPT-4o-mini', d:'模型端点（付费，长上下文，推理）。'},
    {p:'model:endpoint:anthropic:claude-3-5-haiku', n:'Claude 3.5 Haiku', d:'模型端点（付费，长上下文，推理）。'},
    {p:'model_tag:roleplay', n:'标签：角色扮演', d:'适合角色扮演。'},
    {p:'model_tag:long_context', n:'标签：长上下文', d:'适合长上下文。'},
    {p:'model_tag:reasoning', n:'标签：逻辑推理', d:'具备推理能力。'},
    {p:'model_tag:paid', n:'标签：付费', d:'付费端点。'},
    {p:'model_group:roleplay', n:'分组：角色扮演', d:'模型选择分组。'},
    {p:'model_group:long_context', n:'分组：长上下文', d:'模型选择分组。'},
    {p:'layer:orchestration', n:'编排层', d:'系统编排层。'},
    {p:'layer:execution', n:'执行层', d:'系统执行层。'}
  ];

  const REL_ZH = {
    CONTAINS:'包含',
    DEPENDS_ON:'依赖',
    APPLIES_TO:'适用于',
    GOVERNS:'治理',
    LOCATED_IN:'位于',
    COVERED_BY:'被遮挡于',
    HAS_LOS_TO:'有视线至',
    EMITS:'产生',
    CAUSAL:'因果导致',
    OCCURS_AT:'发生于',
    RECORDED_AT:'记录于',
    PERTAINS_TO:'关涉',
    REMEMBERS:'记忆',
    ROUTES_TO:'路由至',
    PROVIDES:'提供',
    HAS_TAG:'拥有标签',
    MEMBER_OF:'属于分组',
    FALLBACKS_TO:'回退至'
  };

  function fromLabelsToTypeZh(labels){
    const set = new Set(labels||[]);
    if(set.has('Layer')) return '层';
    if(set.has('Module')) return '模块';
    if(set.has('Policy')) return '策略';
    if(set.has('UpstreamChannel')) return '上游渠道';
    if(set.has('ModelEndpoint')) return '模型端点';
    if(set.has('ModelTag')) return '模型标签';
    if(set.has('ModelGroup')) return '模型分组';
    if(set.has('Scene')) return '场景';
    if(set.has('Location')) return '位置';
    if(set.has('LosSegment')) return '视线遮挡段';
    if(set.has('Actor') && set.has('Player')) return '玩家';
    if(set.has('Actor') && set.has('NPC')) return '非玩家角色';
    if(set.has('ParsingEvent')) return '解析事件';
    if(set.has('DecisionEvent')) return '决策事件';
    if(set.has('StateTransition')) return '状态迁移';
    if(set.has('MemoryAnchor')) return '记忆锚点';
    if(set.has('TimeNode')) return '时间节点';
    return '实体';
  }

  function formatNameZhByPrefix(id, props, labels){
    const hit = PREFIX_RULES.find(r => id.startsWith(r.p));
    if(hit) return hit.n;
    // Layer fallback
    if(id.startsWith('layer:orchestration')) return '编排层';
    if(id.startsWith('layer:execution')) return '执行层';
    const t = fromLabelsToTypeZh(labels);
    // 若 props.name 英文，仍以类型前缀+原名展示
    return props && props.name ? `${t}：${props.name}` : t;
  }
  function formatDescZhByPrefix(id, props, labels){
    const hit = PREFIX_RULES.find(r => id.startsWith(r.p));
    if(hit) return hit.d;
    const t = fromLabelsToTypeZh(labels);
    if(t==='时间节点' && props && props.iso){
      return `时间节点：${props.iso}`;
    }
    return `类型：${t}。`;
  }

  function relZh(type){ return REL_ZH[type] || type; }

  function kvPairsZh(node){
    const p = node.props||{};
    const pairs = [];
    function push(k,v){ if(v!==undefined && v!==null && v!=='') pairs.push([k, String(v)]) }
    // 常用属性中文化
    if(p.layer) push('所在层', p.layer==='Orchestration'?'编排层':(p.layer==='Execution'?'执行层':p.layer));
    if(p.version_state) push('版本状态', p.version_state);
    if(p.tick_seconds!=null) push('Tick 秒', p.tick_seconds);
    if(p.time_bucket) push('时间桶', p.time_bucket==='minute'?'分钟':p.time_bucket);
    if(p.approx_level) push('空间近似级别', p.approx_level);
    if(p.concurrency && typeof p.concurrency==='object'){
      push('分片数', p.concurrency.shards);
      push('投递语义', p.concurrency.semantics==='at_least_once'?'至少一次':p.concurrency.semantics);
    }
    if(p.random_weight!=null) push('随机度', p.random_weight);
    if(p.dispute_only!=null) push('仅争议判定', p.dispute_only?'是':'否');
    if(p.coord_ref) push('坐标系', p.coord_ref);
    if(p.space_level) push('空间维度', p.space_level);
    if(p.perception_range!=null) push('感知范围', p.perception_range);
    if(p.provider) push('提供方', p.provider);
    if(p.tier) push('计费层级', p.tier==='paid'?'付费':p.tier);
    if(p.context_class) push('上下文能力', p.context_class==='long'?'长':'短');
    if(p.lb_strategy) push('负载策略', p.lb_strategy==='key_round_robin'?'Key 轮询':p.lb_strategy);
    if(p.retry_policy) push('重试策略', p.retry_policy==='exponential_backoff'?'指数退避':p.retry_policy);
    if(p.circuit_breaker) push('熔断', p.circuit_breaker==='enabled'?'开启':p.circuit_breaker);
    if(p.key_rotation_strategy) push('Key 轮换', p.key_rotation_strategy==='round_robin'?'轮询':p.key_rotation_strategy);
    if(p.output_normalization) push('输出归一化', p.output_normalization);
    if(p.valid_time && p.valid_time.from) push('生效时间', p.valid_time.from);
    if(p.valid_time && p.valid_time.to) push('失效时间', p.valid_time.to);
    if(p.record_time && p.record_time.at) push('记录时间', p.record_time.at);
    if(p.audience) push('受众', p.audience==='System'?'系统':(p.audience==='Player'?'玩家':(p.audience==='NPC'?'NPC':p.audience)));
    if(p.visibility_scope) push('可见性', p.visibility_scope==='global'?'全局':p.visibility_scope);
    if(p.spoiler_level!=null) push('剧透级别', p.spoiler_level);
    return pairs;
  }

  window.ZH = {
    fromLabelsToTypeZh,
    nameZh(node){return formatNameZhByPrefix(node.id, node.props, node.labels)},
    descZh(node){return formatDescZhByPrefix(node.id, node.props, node.labels)},
    relZh
  };
  window.ZH.kvPairsZh = kvPairsZh;
})();