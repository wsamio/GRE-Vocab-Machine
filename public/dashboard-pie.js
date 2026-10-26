// Dashboard pie: Learned / In review / Not marked. Hover (or focus) pops a slice out of the pie.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const CX = 120, CY = 120, R = 100, r = 44, POP = 9;
  const polar = (rad, ang) => [CX + rad * Math.cos(ang), CY + rad * Math.sin(ang)];
  function slicePath(a0, a1) {
    const [x0, y0] = polar(R, a0), [x1, y1] = polar(R, a1), [x2, y2] = polar(r, a1), [x3, y3] = polar(r, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
  }
  function ringPath() { // a full ring (one slice owns 100%)
    return `M${CX - R} ${CY}A${R} ${R} 0 1 1 ${CX + R} ${CY}A${R} ${R} 0 1 1 ${CX - R} ${CY}ZM${CX - r} ${CY}A${r} ${r} 0 1 0 ${CX + r} ${CY}A${r} ${r} 0 1 0 ${CX - r} ${CY}Z`;
  }
  const el = (name, attrs = {}) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  window.renderVocabPie = (host, d) => {
    if (!host) return;
    const total = d.totalWords || 0;
    const parts = [
      { key: 'learned', label: 'Learned', value: d.learned || 0 },
      { key: 'review', label: 'In review', value: d.review || 0 },
      { key: 'unmarked', label: 'Not marked', value: d.unmarked || 0 }
    ];
    const pct = v => (total ? Math.round(v / total * 1000) / 10 : 0);
    host.replaceChildren();
    const title = document.createElement('h3'); title.style.marginTop = '0'; title.textContent = 'Word breakdown';
    const wrap = document.createElement('div'); wrap.className = 'pie-wrap';
    const svg = el('svg', { viewBox: '0 0 240 240', class: 'pie-svg', role: 'img', 'aria-label': 'Pie chart of learned, in review and not marked words' });
    const legend = document.createElement('div'); legend.className = 'pie-legend';
    const num = el('text', { x: CX, y: CY + 4, 'text-anchor': 'middle', class: 'pie-center-num' });
    const lab = el('text', { x: CX, y: CY + 20, 'text-anchor': 'middle', class: 'pie-center-label' });
    const setCenter = p => { num.textContent = (p ? p.value : total).toLocaleString(); lab.textContent = p ? `${p.label} · ${pct(p.value)}%` : 'total words'; };
    const nodes = {};
    const setActive = key => {
      for (const [k, n] of Object.entries(nodes)) {
        const on = k === key;
        n.legend.classList.toggle('is-active', on);
        if (n.slice) {
          n.slice.classList.toggle('is-active', on);
          n.slice.style.transform = on ? `translate(${n.dx}px,${n.dy}px)` : '';
        }
      }
      setCenter(parts.find(p => p.key === key));
    };

    const visible = parts.filter(p => p.value > 0);
    if (!total || !visible.length) {
      svg.append(el('path', { d: ringPath(), class: 'pie-slice pie-unmarked', 'fill-rule': 'evenodd' }));
    } else {
      let angle = -Math.PI / 2;
      for (const p of visible) {
        const sweep = p.value / total * Math.PI * 2;
        const full = visible.length === 1;
        const slice = el('path', { d: full ? ringPath() : slicePath(angle, angle + sweep), class: `pie-slice pie-${p.key}`, 'fill-rule': 'evenodd', tabindex: '0', 'aria-label': `${p.label}: ${p.value} words, ${pct(p.value)}%` });
        const mid = angle + sweep / 2;
        const t = el('title'); t.textContent = `${p.label}: ${p.value.toLocaleString()} (${pct(p.value)}%)`; slice.append(t);
        nodes[p.key] = { slice, dx: full ? 0 : Math.cos(mid) * POP, dy: full ? 0 : Math.sin(mid) * POP };
        slice.addEventListener('pointerenter', () => setActive(p.key));
        slice.addEventListener('pointerleave', () => setActive(null));
        slice.addEventListener('focus', () => setActive(p.key));
        slice.addEventListener('blur', () => setActive(null));
        svg.append(slice);
        angle += sweep;
      }
    }
    svg.append(num, lab);
    setCenter(null);

    for (const p of parts) {
      const row = document.createElement('div'); row.className = 'pie-legend-row';
      row.innerHTML = '<span class="pie-dot pie-' + p.key + '"></span><span></span><b></b><small></small>';
      row.children[1].textContent = p.label; row.children[2].textContent = p.value.toLocaleString(); row.children[3].textContent = pct(p.value) + '%';
      nodes[p.key] = Object.assign(nodes[p.key] || {}, { legend: row });
      row.addEventListener('pointerenter', () => setActive(p.key));
      row.addEventListener('pointerleave', () => setActive(null));
      legend.append(row);
    }
    wrap.append(svg, legend);
    host.append(title, wrap);
  };
})();
