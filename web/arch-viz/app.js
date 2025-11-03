(() => {
  'use strict';

  const DATASETS = {
    full: {
      label: '完整架构 · Full',
      nodesUrl: '../../samples/neo4j/full_architecture_nodes.jsonl',
      relsUrl: '../../samples/neo4j/full_architecture_rels.jsonl'
    },
    minimal: {
      label: '最小样例 · Minimal',
      nodesUrl: '../../samples/neo4j/architecture_nodes.jsonl',
      relsUrl: '../../samples/neo4j/architecture_rels.jsonl'
    }
  };

  const svg = document.getElementById('viz');
  const select = document.getElementById('datasetSelect');
  const resetBtn = document.getElementById('resetBtn');
  const detail = document.getElementById('detail');
  const vizWrap = document.getElementById('viz-wrap');

  const state = {
    width: 0, height: 0, margin: 40,
    scale: 1, tx: 0, ty: 0,
    isPanning: false, panStart: null, pan0: null,
    graph: null, // {nodesById, nodes, rels, relsByFrom, relsByTo}
    tree: null,  // hierarchical object with children
    maxDepth: 0,
    gMain: null, gRings: null, gLinks: null, gNodes: null
  };

  // Utilities
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hasLabel = (node, label) => Array.isArray(node.labels) && node.labels.includes(label);
  const getName = (node) => (node?.props?.name) || node?.props?.id || node?.id || 'N/A';
  const colorFor = (node) => {
    const labels = node?.labels || node?.src?.labels || [];
    if (labels.includes('Layer')) return getComputedStyle(document.documentElement).getPropertyValue('--layer').trim();
    if (labels.includes('Module')) return getComputedStyle(document.documentElement).getPropertyValue('--module').trim();
    if (labels.includes('Virtual')) return getComputedStyle(document.documentElement).getPropertyValue('--virtual').trim();
    return '#6b7280';
  };

  // Data loading
  async function fetchJsonl(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error(`加载失败 Load failed: ${url} -> ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
    return lines.map(l => JSON.parse(l));
  }

  function buildGraph(nodesArr, relsArr){
    const nodesById = new Map();
    nodesArr.forEach(n => nodesById.set(n.id, n));
    const relsByFrom = new Map();
    const relsByTo = new Map();
    for(const r of relsArr){
      const a = r.from, b = r.to;
      if(!relsByFrom.has(a)) relsByFrom.set(a, []);
      if(!relsByTo.has(b)) relsByTo.set(b, []);
      relsByFrom.get(a).push(r);
      relsByTo.get(b).push(r);
    }
    return { nodesById, nodes: nodesArr, rels: relsArr, relsByFrom, relsByTo };
  }

  // Build radial tree using CONTAINS
  function buildTree(graph){
    const contains = graph.rels.filter(r => r.type === 'CONTAINS');
    const childrenBy = new Map();
    for(const r of contains){
      if(!childrenBy.has(r.from)) childrenBy.set(r.from, []);
      childrenBy.get(r.from).push(r.to);
    }
    // candidates for roots: Layer nodes
    const layerNodes = graph.nodes.filter(n => hasLabel(n, 'Layer'));
    const root = {
      id: 'virtual:root:architecture',
      labels: ['Virtual','Root'],
      props: { name: '系统架构 · System Architecture' },
      children: [], depth: 0
    };

    const visited = new Set();
    function subtree(id, parent){
      if(visited.has(id)) return null;
      visited.add(id);
      const src = graph.nodesById.get(id);
      if(!src) return null;
      const node = {
        id: src.id,
        labels: src.labels,
        props: src.props,
        src, parent,
        children: []
      };
      const kids = childrenBy.get(id) || [];
      for(const cid of kids){
        const child = subtree(cid, node);
        if(child) node.children.push(child);
      }
      return node;
    }

    for(const ln of layerNodes){
      const t = subtree(ln.id, root);
      if(t) root.children.push(t);
    }
    return root;
  }

  // Layout: compact radial by leaf counts
  function annotateDepth(node, depth=0){
    node.depth = depth;
    let md = depth;
    for(const c of node.children) md = Math.max(md, annotateDepth(c, depth+1));
    return md;
  }
  function countLeaves(node){
    if(!node.children || node.children.length === 0){ node.leafCount = 1; return 1; }
    let sum = 0;
    for(const c of node.children) sum += countLeaves(c);
    node.leafCount = sum;
    return sum;
  }
  function assignAngles(node, start=0, end=Math.PI*2){
    node.start = start; node.end = end; node.angle = (start + end) / 2;
    if(!node.children || node.children.length===0) return;
    let acc = start;
    for(const c of node.children){
      const span = (end - start) * (c.leafCount / node.leafCount);
      assignAngles(c, acc, acc + span);
      acc += span;
    }
  }
  function assignPositions(node, ringStep){
    const angle = node.angle - Math.PI/2; // start from top
    const r = node.depth * ringStep;
    node.x = r * Math.cos(angle);
    node.y = r * Math.sin(angle);
    for(const c of node.children) assignPositions(c, ringStep);
  }

  // Render
  function clearSvg(){
    while(svg.firstChild) svg.removeChild(svg.firstChild);
  }
  function g(tag, attrs={}, parent=svg){
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    return el;
  }

  function render(){
    clearSvg();
    // sizing
    const wrapRect = vizWrap.getBoundingClientRect();
    state.width = wrapRect.width;
    state.height = wrapRect.height;
    const vb = `${-state.width/2} ${-state.height/2} ${state.width} ${state.height}`;
    svg.setAttribute('viewBox', vb);

    // roots
    const gMain = g('g', { id:'gMain', transform: transformStr() });
    state.gMain = gMain;
    state.gRings = g('g', { id:'gRings' }, gMain);
    state.gLinks = g('g', { id:'gLinks' }, gMain);
    state.gNodes = g('g', { id:'gNodes' }, gMain);

    // rings
    const ringStep = (Math.min(state.width, state.height)/2 - state.margin) / Math.max(1, state.maxDepth);
    for(let d=1; d<=state.maxDepth; d++){
      g('circle', {
        class:'ring',
        cx:0, cy:0, r: (d*ringStep).toFixed(2)
      }, state.gRings);
    }

    // edges
    const edges = [];
    (function collect(node){
      for(const c of node.children){ edges.push([node, c]); collect(c); }
    })(state.tree);

    for(const [a,b] of edges){
      g('line', {
        class:'link',
        x1: a.x.toFixed(2), y1: a.y.toFixed(2),
        x2: b.x.toFixed(2), y2: b.y.toFixed(2)
      }, state.gLinks);
    }

    // nodes
    (function draw(node){
      const group = g('g', { class:'node', transform:`translate(${node.x.toFixed(2)},${node.y.toFixed(2)})` }, state.gNodes);
      const isRoot = node.id === 'virtual:root:architecture';
      const r = isRoot ? 8 : (hasLabel(node,'Layer') ? 6 : 5);
      const fill = isRoot ? colorFor({labels:['Virtual']}) : colorFor(node);
      g('circle', { r, fill }, group);
      const theta = node.angle || 0;
      const deg = theta * 180 / Math.PI;
      const anchor = (deg > 90 && deg < 270) ? 'end' : 'start';
      const dx = (anchor === 'start') ? 8 : -8;
      const name = (node.props?.name) ? node.props.name : (node.labels?.join(',') || node.id);
      g('text', {
        'text-anchor': anchor, dx, dy:'4'
      }, group).textContent = name;

      group.style.cursor = 'pointer';
      group.addEventListener('click', (e) => {
        e.stopPropagation();
        showDetail(node);
      });

      for(const c of node.children) draw(c);
    })(state.tree);

    // legend
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `
      <div class="item"><span class="dot color-virtual"></span> 虚拟根 · Virtual Root</div>
      <div class="item"><span class="dot color-layer"></span> 层 · Layer</div>
      <div class="item"><span class="dot color-module"></span> 模块 · Module</div>
    `;
    vizWrap.appendChild(legend);

    // interactions
    svg.addEventListener('wheel', onWheel, {passive:false});
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('dblclick', () => resetView());
    svg.addEventListener('click', () => hideDetail());
  }

  function transformStr(){
    return `translate(${state.tx.toFixed(2)},${state.ty.toFixed(2)}) scale(${state.scale.toFixed(3)})`;
  }
  function applyTransform(){
    if(state.gMain) state.gMain.setAttribute('transform', transformStr());
  }
  function resetView(){
    state.scale = 1; state.tx = 0; state.ty = 0; applyTransform();
  }
  function onWheel(e){
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width/2;
    const cy = e.clientY - rect.top - rect.height/2;
    const zoomFactor = Math.pow(1.1, -Math.sign(e.deltaY));
    const newScale = clamp(state.scale * zoomFactor, 0.2, 5);

    // zoom to cursor
    const k = newScale / state.scale;
    state.tx = cx - k*(cx - state.tx);
    state.ty = cy - k*(cy - state.ty);
    state.scale = newScale;
    applyTransform();
  }
  function onPointerDown(e){
    e.preventDefault();
    state.isPanning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
    state.pan0 = { tx: state.tx, ty: state.ty };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }
  function onPointerMove(e){
    if(!state.isPanning) return;
    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;
    state.tx = state.pan0.tx + dx;
    state.ty = state.pan0.ty + dy;
    applyTransform();
  }
  function onPointerUp(){
    state.isPanning = false;
    window.removeEventListener('pointermove', onPointerMove);
  }

  function showDetail(node){
    const src = node.src || node; // root没有src
    const labels = (src?.labels || node.labels || []).join(', ');
    const props = src?.props || node.props || {};
    const relStat = relationshipsSummary(src?.id || node.id);

    detail.classList.remove('hidden');
    detail.innerHTML = `
      <div class="card">
        <button class="close" title="关闭 Close">×</button>
        <h2>${getName(node)}</h2>
        <div class="meta">
          <span class="badge">标签 Labels</span> ${labels || '（无 None）'}<br>
          <span class="badge">ID</span> ${src?.id || node.id}
        </div>
        <div class="hr"></div>
        <div><strong>属性 Properties</strong></div>
        <div class="kv">${escapeHtml(JSON.stringify(props, null, 2))}</div>
        <div class="hr"></div>
        <div><strong>关系 Relationships</strong></div>
        <div class="kv">${escapeHtml(JSON.stringify(relStat, null, 2))}</div>
        <div class="hr"></div>
        <div class="note">提示 Tips：本视图以 CONTAINS 构造层级（径向紧凑树）。其他关系（如 DEPENDS_ON/GOVERNS 等）已在"关系统计"中汇总显示。</div>
      </div>
    `;
    detail.querySelector('.close')?.addEventListener('click', hideDetail);
  }
  function hideDetail(){
    detail.classList.add('hidden');
    detail.innerHTML = '';
  }
  function escapeHtml(s){
    return s.replace(/[&<>"]/g, c => ({'&':'&','<':'<','>':'>','"':'"'}[c]));
  }
  function relationshipsSummary(id){
    if(!state.graph) return {};
    const out = Object.create(null);
    const ins = Object.create(null);
    (state.graph.relsByFrom.get(id) || []).forEach(r => out[r.type] = (out[r.type]||0)+1);
    (state.graph.relsByTo.get(id) || []).forEach(r => ins[r.type] = (ins[r.type]||0)+1);
    return { outgoing: out, incoming: ins };
  }

  // Main flow
  async function loadDataset(key){
    hideDetail();
    // tiny delay to allow UI update
    await sleep(10);
    const ds = DATASETS[key];
    try{
      const [nodes, rels] = await Promise.all([fetchJsonl(ds.nodesUrl), fetchJsonl(ds.relsUrl)]);
      state.graph = buildGraph(nodes.filter(n => n.kind === 'node'), rels.filter(r => r.kind === 'relationship'));
      state.tree = buildTree(state.graph);
      state.maxDepth = annotateDepth(state.tree, 0);
      countLeaves(state.tree);
      assignAngles(state.tree, 0, Math.PI*2);
      const ringStep = (Math.min(vizWrap.clientWidth, vizWrap.clientHeight)/2 - state.margin) / Math.max(1, state.maxDepth);
      assignPositions(state.tree, ringStep);
      render();
      resetView();
    }catch(err){
      console.error(err);
      clearSvg();
      const msg = `
        加载数据失败 · Failed to load data

        ${ds.label}
        nodes: ${ds.nodesUrl}
        rels : ${ds.relsUrl}

        原因 Reason:
        ${err && (err.stack || err.message || String(err))}
      `;
      const pre = document.createElementNS('http://www.w3.org/2000/svg','text');
      pre.setAttribute('x','-300'); pre.setAttribute('y','-20');
      pre.textContent = msg;
      svg.appendChild(pre);
    }
  }

  function onResize(){
    if(!state.tree) return;
    render();
    applyTransform();
  }

  // init
  function init(){
    select.addEventListener('change', () => loadDataset(select.value));
    resetBtn.addEventListener('click', resetView);
    window.addEventListener('resize', onResize);
    loadDataset(select.value || 'full');
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();

})();