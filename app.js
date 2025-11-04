/* 渲染：核心模块径向 + 模块内容同心圆；点击节点显示中文“标签卡” */
(function(){
  const ringOrder = [
    'DEPENDS_ON','GOVERNS','ROUTES_TO','PROVIDES','HAS_TAG','MEMBER_OF',
    'APPLIES_TO','LOCATED_IN','COVERED_BY','HAS_LOS_TO','EMITS','CAUSAL',
    'OCCURS_AT','RECORDED_AT','PERTAINS_TO','REMEMBERS','CONTAINS','FALLBACKS_TO'
  ];
  const ringIndex = t => Math.max(0, ringOrder.indexOf(t));

  function isModule(n){ return (n.labels||[]).includes('Module'); }
  function moduleLayer(n){
    const layer = n.props && n.props.layer;
    return layer==='Orchestration'?'orch':(layer==='Execution'?'exec':'module');
  }
  function nodeClass(n){
    const L = new Set(n.labels||[]);
    if(L.has('Layer')) return 'node layer';
    if(L.has('Module')){
      return `node module ${moduleLayer(n)}`;
    }
    if(L.has('Policy')) return 'node policy';
    if(L.has('Service') || L.has('UpstreamChannel') || L.has('ModelEndpoint')) return 'node service';
    if(L.has('Taxonomy') || L.has('ModelTag') || L.has('ModelGroup')) return 'node taxonomy';
    if(L.has('Data') || L.has('Spatial')) return 'node data';
    if(L.has('Event') || L.has('Temporal')) return 'node event';
    return 'node';
  }
  function nodeRadius(n){
    if((n.labels||[]).includes('Layer')) return 16;
    if(isModule(n)) return 12;
    if((n.labels||[]).includes('Policy')) return 9;
    if((n.labels||[]).includes('ModelEndpoint')) return 8;
    if((n.labels||[]).includes('UpstreamChannel')) return 9;
    if((n.labels||[]).includes('ModelTag') || (n.labels||[]).includes('ModelGroup')) return 6.5;
    return 7.5;
  }

  function buildLayout({nodes, links, adj}, svg){
    const width = svg.clientWidth || svg.parentNode.clientWidth;
    const height = svg.clientHeight || svg.parentNode.clientHeight;
    const cx = width/2, cy = height/2;
    const rCore = Math.min(width, height)*0.28;
    const ringBase = 60, ringStep = 80;

    // 选择“核心模块”
    const modules = nodes.filter(isModule).sort((a,b)=> (a.props.layer||'').localeCompare(b.props.layer||''));
    // 核心模块径向定位
    modules.forEach((m,i)=>{
      const ang = (i/modules.length)*Math.PI*2 - Math.PI/2;
      m.fx = cx + rCore*Math.cos(ang);
      m.fy = cy + rCore*Math.sin(ang);
    });

    // 为每个模块分配“同心圆”位置（仅放置非模块邻居；已放置的节点不重复放置）
    const pinned = new Set(modules.map(m=>m.id));
    const neighborPlacedBy = new Map(); // nodeId -> moduleId

    modules.forEach(m=>{
      const rels = (adj.get(m.id)?.out||[]).concat(adj.get(m.id)?.in||[]);
      const groups = new Map(); // ring -> {items:[], type}
      rels.forEach(l=>{
        const neigh = l.source.id===m.id? l.target : l.source;
        if(isModule(neigh)) return; // 模块彼此保持核心环
        const rIdx = ringIndex(l.type);
        const entry = groups.get(rIdx) || {items:[], type:l.type};
        entry.items.push({node:neigh, rel:l});
        groups.set(rIdx, entry);
      });
      // 每个环均匀散列
      Array.from(groups.entries()).sort((a,b)=>a[0]-b[0]).forEach(([idx, g])=>{
        const R = ringBase + idx*ringStep;
        const items = g.items;
        const n = items.length;
        if(n===0) return;
        const phase = Math.random()*Math.PI*2;
        items.forEach((it,k)=>{
          const t = phase + (k/n)*Math.PI*2;
          if(pinned.has(it.node.id)) return;
          if(neighborPlacedBy.has(it.node.id)) return; // 已被其他模块占位
          it.node.fx = m.fx + R*Math.cos(t);
          it.node.fy = m.fy + R*Math.sin(t);
          pinned.add(it.node.id);
          neighborPlacedBy.set(it.node.id, m.id);
        });
        // 绘制环参考线
        rings.push({mx:m.fx,my:m.fy,R});
      });
    });

    // D3 渲染
    const sel = d3.select('#graph');
    sel.selectAll('*').remove();

    const root = sel.append('g').attr('class','root');
    const ringsG = root.append('g').attr('class','rings');
    const linksG = root.append('g').attr('class','links');
    const nodesG = root.append('g').attr('class','nodes');
    const labelsG = root.append('g').attr('class','labels');

    // 背景环（去重）
    const uniqKey = new Set();
    const uniqRings = rings.filter(r=>{
      const key = `${Math.round(r.mx)}-${Math.round(r.my)}-${r.R}`;
      if(uniqKey.has(key)) return false; uniqKey.add(key); return true;
    });
    ringsG.selectAll('circle.ring').data(uniqRings).enter()
      .append('circle').attr('class','ring')
      .attr('cx',d=>d.mx).attr('cy',d=>d.my).attr('r',d=>d.R);

    const link = linksG.selectAll('line.link').data(links).enter()
      .append('line').attr('class','link').attr('stroke-width',1.2);

    const node = nodesG.selectAll('circle.node').data(nodes).enter()
      .append('circle')
      .attr('class',d=>nodeClass(d))
      .attr('r',d=>nodeRadius(d))
      .on('click',(e,d)=> showCard(d, {nodes,links,adj}));

    // 仅为“模块”绘制短标签，减少干扰
    const label = labelsG.selectAll('text.label').data(modules).enter()
      .append('text').attr('class','label')
      .attr('text-anchor','middle').attr('dy',-12)
      .text(d=>d.nameZh);

    // 缩放/平移
    sel.call(d3.zoom().scaleExtent([0.2,2.5]).on('zoom', (event)=>{
      root.attr('transform', event.transform);
    }));

    // 力导引
    const sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(cx, cy))
      .force('link', d3.forceLink(links).id(d=>d.id).distance(l=> {
        if(isModule(l.source) && isModule(l.target)) return rCore*0.75;
        const t = l.type;
        if(t==='DEPENDS_ON') return 90;
        if(t==='GOVERNS') return 120;
        if(t==='ROUTES_TO') return 140;
        if(t==='PROVIDES') return 110;
        if(t==='HAS_TAG' || t==='MEMBER_OF') return 90;
        return 130;
      }).strength(0.2))
      .alphaDecay(0.05)
      .on('tick', ()=>{
        link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
            .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
        node.attr('cx',d=>d.x).attr('cy',d=>d.y);
        label.attr('x',d=>d.x).attr('y',d=>d.y);
      });

    // 高亮核心模块
    const chk = document.getElementById('toggle-core-highlight');
    chk.addEventListener('change',()=>{
      node.classed('dim', false);
      link.classed('dim', false);
      if(!chk.checked) return;
      const moduleIds = new Set(modules.map(m=>m.id));
      node.classed('dim', d=> !moduleIds.has(d.id));
      link.classed('dim', d=> !(moduleIds.has(d.source.id)&&moduleIds.has(d.target.id)));
    });

    document.getElementById('btn-reset').addEventListener('click',()=>{
      sel.transition().duration(400).call(d3.zoom().transform, d3.zoomIdentity);
    });
  }

  function escapeHtml(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&','<':'<','>':'>','"':'"'}[m]))}

  function showCard(node, graph){
    const title = document.getElementById('card-title');
    const body = document.getElementById('card-body');
    title.textContent = `${node.nameZh}（${node.typeZh}）`;

    // 属性键值
    const kv = ZH.kvPairsZh(node);
    const kvHtml = kv.map(([k,v])=>`<div class="kv"><div class="key">${escapeHtml(k)}</div><div class="val">${escapeHtml(v)}</div></div>`).join('');

    // 关系列表（出/入）
    const outH = (graph.adj.get(node.id)?.out||[]).map(l=>{
      const tgt = l.target;
      return `<li><span class="badge">${escapeHtml(l.typeZh)}</span> → ${escapeHtml(tgt.nameZh)}</li>`;
    }).join('');
    const inH = (graph.adj.get(node.id)?.in||[]).map(l=>{
      const src = l.source;
      return `<li>${escapeHtml(src.nameZh)} → <span class="badge">${escapeHtml(l.typeZh)}</span></li>`;
    }).join('');

    body.innerHTML = `
      <div class="section">简介</div>
      <div>${escapeHtml(node.descZh)}</div>
      <div class="section">基本属性</div>
      ${kvHtml || '<div class="kv"><div class="key">ID</div><div class="val">'+escapeHtml(node.id)+'</div></div>'}
      <div class="section">参与关系（指向）</div>
      <ul class="list">${outH || '<li>无</li>'}</ul>
      <div class="section">参与关系（来自）</div>
      <ul class="list">${inH || '<li>无</li>'}</ul>
      <div class="section">标识</div>
      <div class="kv"><div class="key">ID</div><div class="val">${escapeHtml(node.id)}</div></div>
    `;
  }

  const rings = []; // 渲染前收集的同心环（去重后绘制）

  function init(){
    const ovBtn = document.getElementById('overlay-close');
    if(ovBtn) ovBtn.addEventListener('click',()=>document.getElementById('overlay').classList.add('hidden'));
    loadGraphData().then(graph=>{
      const svg = document.getElementById('graph');
      buildLayout(graph, svg);
    });
    document.getElementById('card-close').addEventListener('click',()=>{
      document.getElementById('card-title').textContent='请选择一个节点';
      document.getElementById('card-body').textContent='点击画布中的任意节点以查看详细信息。';
    });
  }
  window.addEventListener('DOMContentLoaded', init);
})();