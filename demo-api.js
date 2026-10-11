// Modo DEMO (sin servidor): cuando config.js define API_BASE = "demo", este script responde
// las llamadas /api/* dentro del propio dispositivo. El stock y los pedidos se guardan en localStorage.
// El pago es simulado (no se cobra nada). Ideal para presentar la app sin publicar un servidor.
(function(){
  if(window.API_BASE !== "demo") return;
  const KEY = "arcocero-demo-v1", RES_MS = 30*60*1000, realFetch = window.fetch.bind(window);
  const catalog = () => window.CATALOG_FALLBACK || [];
  const sizesOf = p => p.sizes || ["Única"];
  const unit = (p,s) => p.prices ? p.prices[s] : p.price;
  function load(){ try{ const d = JSON.parse(localStorage.getItem(KEY)); if(d && d.stock) return d; }catch(e){} 
    const stock = {}; catalog().forEach(p => sizesOf(p).forEach(s => stock[p.id+"::"+s] = {on:(p.stock&&p.stock[s])||0, res:0})); return {stock, orders:{}}; }
  function save(d){ try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){} }
  function expire(d){ const now = Date.now();
    for(const o of Object.values(d.orders)) if(o.status==="PENDING" && o.expiresAt < now) release(d,o,"EXPIRED"); }
  function release(d,o,st){ o.lines.forEach(l => d.stock[l.id+"::"+l.size].res -= l.qty); o.status = st; }
  const json = (obj, status=200) => Promise.resolve(new Response(JSON.stringify(obj), {status, headers:{"Content-Type":"application/json"}}));

  window.fetch = function(url, opts){
    const u = String(url);
    if(!u.startsWith("demo/api/")) return realFetch(url, opts);
    const path = u.slice(4).split("?")[0], method = ((opts&&opts.method)||"GET").toUpperCase();
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const d = load(); expire(d);
    let out;
    if(path === "/api/config") out = json({mock:true, wompiPublicKey:null, currency:"COP", reservationMinutes:30});
    else if(path === "/api/products"){
      out = json(catalog().map(p => { const st = {}; sizesOf(p).forEach(s => { const x = d.stock[p.id+"::"+s]; st[s] = x ? Math.max(x.on - x.res, 0) : 0; }); return {...p, stock:st}; }));
    }
    else if(path === "/api/orders" && method === "POST"){
      const c = body.customer || {};
      if(!body.acceptedTerms || !c.name || !c.email || !c.phone) out = json({error:"Revisa los datos de envío: hay campos vacíos o inválidos."}, 400);
      else {
        const merged = {}; let bad = false;
        (body.items||[]).forEach(it => { const p = catalog().find(x => x.id === it.id); const s = it.size || "Única";
          if(!p || !sizesOf(p).includes(s) || !(it.qty >= 1)) { bad = true; return; }
          const k = it.id+"::"+s; merged[k] = {id:it.id, size:s, qty:(merged[k]?merged[k].qty:0)+it.qty}; });
        const lines = Object.values(merged);
        if(bad || !lines.length) out = json({error:"Un producto del carrito no es válido."}, 400);
        else {
          const short = lines.find(l => { const x = d.stock[l.id+"::"+l.size]; return x.on - x.res < l.qty; });
          if(short){ const p = catalog().find(x => x.id === short.id), x = d.stock[short.id+"::"+short.size], av = Math.max(x.on-x.res,0);
            out = json({error:`No hay suficiente stock de "${p.name}"${short.size!=="Única"?" ("+short.size+")":""}. Disponible: ${av}.`, productId:short.id, size:short.size, available:av}, 409); }
          else {
            const ref = "ARCO-" + Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
            const total = lines.reduce((a,l) => a + unit(catalog().find(x => x.id===l.id), l.size)*l.qty, 0);
            lines.forEach(l => d.stock[l.id+"::"+l.size].res += l.qty);
            d.orders[ref] = {reference:ref, status:"PENDING", total, lines, customer:c, expiresAt:Date.now()+RES_MS, createdAt:Date.now()};
            out = json({reference:ref, total, expiresAt:d.orders[ref].expiresAt, mock:true});
          }
        }
      }
    }
    else if(path === "/api/dev/pay" && method === "POST"){
      const o = d.orders[body.reference];
      if(!o) out = json({error:"Pedido no encontrado"}, 404);
      else { if(o.status === "PENDING"){
          if(body.result === "APPROVED"){ o.lines.forEach(l => { const x = d.stock[l.id+"::"+l.size]; x.on -= l.qty; x.res -= l.qty; }); o.status = "PAID"; }
          else release(d,o,"FAILED"); }
        out = json({ok:true, status:o.status}); }
    }
    else if(path.startsWith("/api/orders/")){
      const parts = path.split("/"), ref = decodeURIComponent(parts[3]||""), o = d.orders[ref];
      if(!o) out = json({error:"Pedido no encontrado"}, 404);
      else if(parts[4] === "cancel" && method === "POST"){ if(o.status==="PENDING") release(d,o,"FAILED"); out = json({status:o.status}); }
      else out = json({reference:o.reference, status:o.status, total:o.total});
    }
    else out = json({error:"No encontrado"}, 404);
    save(d); return out;
  };
})();
