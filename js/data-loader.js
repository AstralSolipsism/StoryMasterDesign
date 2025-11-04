/* 读取 JSONL，构建 nodes/links，并注入中文名称/说明/关系名 */
(function(){
  async function loadJsonl(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error(`请求失败 ${res.status}`);
    const text = await res.text();
    return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>{
      try{return JSON.parse(line)}catch(e){console.warn('解析失败：', line);return null}
    }).filter(Boolean);
  }

  function buildGraph(nodesRaw, relsRaw){
    const map = new Map();
    nodesRaw.forEach(n=>{
      const id = n.id;
      if(!map.has(id)) map.set(id, {
        id, labels:n.labels||[], props:n.props||{},
        nameZh: ZH.nameZh(n), typeZh: ZH.fromLabelsToTypeZh(n.labels||[]),
        descZh: ZH.descZh(n)
      });
    });
    const nodes = Array.from(map.values());
    const nodeById = new Map(nodes.map(n=>[n.id,n]));
    const links = [];
    relsRaw.forEach(r=>{
      const s = nodeById.get(r.from), t = nodeById.get(r.to);
      if(!s || !t) return;
      links.push({
        source:s, target:t, type:r.type, typeZh: ZH.relZh(r.type), props:r.props||{}
      });
    });
    // 构建邻接表，便于侧边栏展示
    const adj = new Map();
    nodes.forEach(n=>adj.set(n.id, {out:[],in:[]}));
    links.forEach(l=>{
      adj.get(l.source.id).out.push(l);
      adj.get(l.target.id).in.push(l);
    });
    return {nodes, links, adj};
  }

  async function loadGraphData(){
    try{
      const [nodesRaw, relsRaw] = await Promise.all([
        loadJsonl('samples/neo4j/full_architecture_nodes.jsonl'),
        loadJsonl('samples/neo4j/full_architecture_rels.jsonl')
      ]);
      return buildGraph(nodesRaw, relsRaw);
    }catch(err){
      console.error('读取 JSONL 失败：', err);
      const ov = document.getElementById('overlay');
      if(ov) ov.classList.remove('hidden');
      throw err;
    }
  }

  window.loadGraphData = loadGraphData;
})();