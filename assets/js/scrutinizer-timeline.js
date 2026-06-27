/*!
 * Scrutinizer Timeline — shared, framework-agnostic request-timeline renderer.
 *
 * Faithful vanilla-JS port of the "Scrutinizer Timeline" design comp (fresh theme,
 * dual treatment, rail phase style). Zero dependencies. Safe to embed in the WP-admin
 * dashboard and in a Cloudflare Worker viewer.
 *
 * SECURITY: every piece of data-derived text is written with textContent and every
 * attribute via setAttribute. No innerHTML / insertAdjacentHTML is ever used with a
 * data-derived string. Source names, callbacks, hosts, SQL etc. are all untrusted.
 *
 * Public API (window.ScrutinizerTimeline):
 *   render(container, profileData, opts)
 *   deriveModel(profileData)  -> { T, spans, phases, bands, http, mem, qbins, read, sources, ... }
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Theme (fresh / default-light only — other schemes are explorations) *
   * ------------------------------------------------------------------ */
  var TH = {
    cardBg: '#fff', cardBorder: '#c3c4c7', line: '#dcdcde', lineSoft: '#f0f0f1', shadow: '0 1px 1px rgba(0,0,0,.04)',
    text: '#1d2327', sub: '#50575e', muted: '#787c82', faint: '#a7aaad', accent: '#2271b1', accentText: '#fff',
    tabBar: '#fdfdfd', viewportBg: '#fbfbfc', viewportBorder: '#e6e7e8', laneLabel: '#b0b3b6', laneBorder: '#f0f0f1',
    gridline: 'rgba(0,0,0,.04)', tick: '#909499', bandLabel: '#5d646d', btnBg: '#fff', btnText: '#50575e',
    ctlBorder: '#c3c4c7', resetBg: '#f6f7f7', miniBg: '#f3f4f5', selHead: '#f6f7f7', swatchBorder: 'rgba(0,0,0,.08)',
    unattrFill: '#eef0f3', hatch: '#c2c8d0', memStroke: '#7c3aed', memFill: 'rgba(124,58,237,0.13)',
    readBg: 'rgba(34,113,177,.07)', queryBar: '#aeb4bd', queryStorm: '#475569'
  };

  // Okabe-Ito colour-blind-safe palette for plugins, assigned by COST RANK
  // (top plugin -> first colour) so any real plugin slug gets a distinct hue —
  // the comp's per-slug map only covered its demo data. Theme teal (#0f9d77)
  // and core slate (#64748b) are reserved and excluded.
  var PALETTE = ['#2271b1', '#e69f00', '#56b4e9', '#cc79a7', '#d55e00', '#0072b2'];

  var PLUGIN_FALLBACK = '#94a3b8';

  // src -> colour, rebuilt per render() from the cost-sorted aggregate.
  var RANK_COLORS = {};

  // WordPress lifecycle hooks that count as "major" milestones on the phase rail.
  var MAJOR_HOOKS = {
    plugins_loaded: 1, init: 1, wp_loaded: 1, parse_request: 1, wp_head: 1,
    wp_footer: 1, template_redirect: 1, shutdown: 1
  };

  // Compact labels for verbose hook names (keeps the rail readable).
  var SHORT_HOOK = {
    wp_print_footer_scripts: 'footer scripts', wp_enqueue_scripts: 'enqueue',
    template_redirect: 'template', parse_request: 'parse', after_setup_theme: 'after_theme',
    setup_theme: 'setup', widgets_init: 'widgets', loop_start: 'loop', loop_end: 'loop end',
    plugins_loaded: 'plugins'
  };

  /* ----------------------------- helpers ----------------------------- */

  function colorFor(type, src) {
    if (type === 'core') return '#64748b';
    if (type === 'theme') return '#0f9d77';
    if (type === 'unattributed') return TH.unattrFill;
    if (type === 'plugin-other') return PLUGIN_FALLBACK;
    return RANK_COLORS[src] || PLUGIN_FALLBACK;
  }
  function typeTag(t) { return t === 'plugin-other' ? 'plugin' : t; }
  function hatchBg(color) {
    return 'repeating-linear-gradient(45deg,' + color + ' 0,' + color + ' 2px,transparent 2px,transparent 6px)';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmtMs(v) {
    if (v == null || isNaN(v)) return '—';
    var n = (Math.abs(v) < 100) ? Math.round(v * 10) / 10 : Math.round(v);
    return n.toLocaleString();
  }
  function fmtMB(bytes) {
    if (bytes == null || isNaN(bytes)) return '—';
    return (Math.round(bytes / 1048576 * 10) / 10).toLocaleString();
  }

  function parseHost(url) {
    if (!url) return '(unknown host)';
    try { return new global.URL(url).host || url; }
    catch (e) {
      var m = String(url).match(/^[a-z]+:\/\/([^/?#]+)/i);
      return m ? m[1] : String(url);
    }
  }

  function el(tag, style, attrs) {
    var n = document.createElement(tag);
    if (style) setStyle(n, style);
    if (attrs) for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'aria') n.setAttribute('aria-label', attrs[k]);
      else if (k === 'data-id') n.setAttribute('data-id', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    return n;
  }
  function setStyle(n, o) { for (var k in o) { if (o.hasOwnProperty(k)) n.style[k] = o[k]; } }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) { if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]); }
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ------------------------------------------------------------------ *
   * Data adapter — derive the comp's model from a real profile payload  *
   * ------------------------------------------------------------------ */
  function deriveModel(profileData) {
    var pd = (profileData && profileData.profile_data) ? profileData.profile_data : (profileData || {});
    var summary = pd.summary || {};
    var rawSources = pd.sources || [];
    var timeline = pd.timeline || [];
    var markers = pd.phase_markers || [];
    var httpCalls = pd.http_calls || [];
    var queries = pd.queries || [];
    var memSamples = pd.memory_samples || null;

    var T = summary.duration_ms || (summary.duration_ns ? summary.duration_ns / 1e6 : 0);
    if (!T) {
      // best-effort fallback: last timeline offset
      for (var ti = 0; ti < timeline.length; ti++) {
        var off = (timeline[ti].offset_ns || 0) / 1e6;
        if (off > T) T = off;
      }
      T = T || 1;
    }

    // slug -> type map (authoritative source typing)
    var srcType = {};
    var srcBySlug = {};
    for (var s = 0; s < rawSources.length; s++) {
      var rs = rawSources[s];
      srcType[rs.slug || ''] = rs.type || 'plugin';
      srcBySlug[rs.slug || ''] = rs;
    }

    var unattributedNs = summary.unattributed_ns || 0;
    var unattributedMs = unattributedNs / 1e6;

    /* ---- ownership aggregate (accurate, from sources[]) ---- */
    var SMALL_SHARE = 0.012;        // plugins below 1.2% collapse into "Other"
    var tailSlugs = {};             // slug -> true for collapsed tail
    var aggArr = [];
    var otherDur = 0, otherCount = 0, otherIncl = 0, otherCalls = 0, otherMem = 0;
    for (var a = 0; a < rawSources.length; a++) {
      var src = rawSources[a];
      var excl = (src.exclusive_ns || 0) / 1e6;
      var type = src.type || 'plugin';
      var share = T ? excl / T : 0;
      var isTail = (type === 'plugin' || type === 'unknown') && share < SMALL_SHARE;
      if (isTail) {
        tailSlugs[src.slug || ''] = true;
        otherDur += excl; otherCount += 1;
        otherIncl += (src.inclusive_ns || 0) / 1e6;
        otherCalls += src.call_count || 0;
        otherMem += src.memory_delta || 0;
        continue;
      }
      aggArr.push({
        key: src.slug || src.type, name: src.slug || src.type, src: src.slug || '',
        type: (type === 'unknown') ? 'plugin-other' : type,
        dur: excl, incl: (src.inclusive_ns || 0) / 1e6,
        calls: src.call_count || 0, mem: src.memory_delta || 0
      });
    }
    if (otherCount > 0) {
      aggArr.push({
        key: '__other', name: 'Other', src: 'other', type: 'plugin-other', count: otherCount,
        dur: otherDur, incl: otherIncl, calls: otherCalls, mem: otherMem
      });
    }
    if (unattributedMs > 0) {
      aggArr.push({ key: '__un', name: 'Unattributed', src: '', type: 'unattributed', dur: unattributedMs });
    }
    aggArr.sort(function (x, y) { return y.dur - x.dur; });

    /* ---- assign palette colours to plugin sources by cost rank ---- */
    var pluginColors = {};
    var ci = 0;
    for (var ai = 0; ai < aggArr.length; ai++) {
      if (aggArr[ai].type === 'plugin') {
        var pkey = aggArr[ai].src || aggArr[ai].name;
        if (pkey && pluginColors[pkey] == null) {
          pluginColors[pkey] = ci < PALETTE.length ? PALETTE[ci] : PLUGIN_FALLBACK;
          ci++;
        }
      }
    }

    /* ---- spans (coalesced timeline segments for the bar) ---- */
    var spans = buildSpans(timeline, srcType, srcBySlug, tailSlugs, otherCount, T);

    /* ---- phases ---- */
    var phases = markers.map(function (m) {
      var name = m.name || '';
      return {
        n: name, ms: (m.offset_ns || 0) / 1e6,
        maj: !!MAJOR_HOOKS[name], short: SHORT_HOOK[name] || name
      };
    });

    /* ---- bands (BOOT / SETUP / QUERY / RENDER from markers) ---- */
    var bands = deriveBands(phases, T);

    /* ---- http ---- */
    var http = httpCalls.map(function (h, i) {
      return {
        id: 'h' + i, host: parseHost(h.url), method: h.method || 'GET',
        status: h.status != null ? h.status : 0,
        start: (h.offset_ns || 0) / 1e6,
        dur: (h.duration_ns ? h.duration_ns / 1e6 : (h.duration_ms || 0))
      };
    });

    /* ---- qbins (bin queries by offset into ~12 buckets, drop empties) ---- */
    var qbins = buildQbins(queries, T);

    /* ---- mem (samples only; absent -> []) ---- */
    var mem = [];
    if (memSamples && memSamples.length) {
      for (var mi = 0; mi < memSamples.length; mi++) {
        var smp = memSamples[mi];
        mem.push([(smp.offset_ns || 0) / 1e6, Math.round((smp.bytes || 0) / 1048576)]);
      }
    }
    // memory glance summary (works even without samples)
    var memSummary = null;
    if (summary.memory_allocated != null || summary.memory_peak != null) {
      memSummary = {
        deltaMB: summary.memory_allocated != null ? fmtMB(summary.memory_allocated) : null,
        peakMB: summary.memory_peak != null ? fmtMB(summary.memory_peak) : null
      };
    }

    /* ---- read (plain-language narrative; house style "associated with") ---- */
    var read = buildRead(aggArr, T);

    /* ---- tab counts ---- */
    var tabCounts = {
      sources: summary.source_count != null ? summary.source_count : rawSources.length,
      queries: summary.query_count != null ? summary.query_count : queries.length,
      http: summary.http_call_count != null ? summary.http_call_count : httpCalls.length,
      assets: summary.asset_count != null ? summary.asset_count : (pd.enqueued_assets ? pd.enqueued_assets.length : 0),
      trace: summary.callback_count != null ? summary.callback_count : timeline.length
    };

    return {
      T: T, spans: spans, phases: phases, bands: bands, http: http, mem: mem,
      qbins: qbins, read: read, sources: aggArr, pluginColors: pluginColors,
      memSummary: memSummary, tabCounts: tabCounts,
      memPeak: mem.length ? Math.max.apply(null, mem.map(function (p) { return p[1]; })) : 1,
      qmax: qbins.length ? Math.max.apply(null, qbins.map(function (b) { return b[2]; })) : 1
    };
  }

  /* coalesce timeline[] into ~15-40 contiguous source segments */
  function buildSpans(timeline, srcType, srcBySlug, tailSlugs, otherCount, T) {
    var MAX_SEG = 36, MIN_DUR_MS = 2.0;

    var tl = timeline.slice().sort(function (x, y) { return (x.offset_ns || 0) - (y.offset_ns || 0); });

    // 1) naive runs: merge entries that are adjacent (in time order) and share a source.
    var runs = [];
    var cur = null;
    for (var i = 0; i < tl.length; i++) {
      var e = tl[i];
      var sk = (e.source != null) ? e.source : '';   // keep raw slug ('' === unknown)
      var ex = e.excl_ns || 0;
      if (cur && cur.src === sk) {
        cur.excl += ex; cur.calls += 1;
        cur.srcExcl[sk] = (cur.srcExcl[sk] || 0) + ex;
      } else {
        cur = { src: sk, startNs: e.offset_ns || 0, excl: ex, calls: 1, srcExcl: {} };
        cur.srcExcl[sk] = ex;
        runs.push(cur);
      }
    }

    // 2) collapse the noise: repeatedly fold the smallest run into its larger
    //    neighbour until we are at/under MAX_SEG and no run is below MIN_DUR_MS.
    while (runs.length > 1) {
      var mi = 0;
      for (var r = 1; r < runs.length; r++) if (runs[r].excl < runs[mi].excl) mi = r;
      if (runs.length <= MAX_SEG && runs[mi].excl / 1e6 >= MIN_DUR_MS) break;

      var L = runs[mi - 1], R = runs[mi + 1], target;
      if (!L) target = R;
      else if (!R) target = L;
      else target = (L.excl >= R.excl) ? L : R;

      // fold runs[mi] into target
      target.startNs = Math.min(target.startNs, runs[mi].startNs);
      target.excl += runs[mi].excl;
      target.calls += runs[mi].calls;
      for (var k in runs[mi].srcExcl) {
        if (runs[mi].srcExcl.hasOwnProperty(k)) target.srcExcl[k] = (target.srcExcl[k] || 0) + runs[mi].srcExcl[k];
      }
      runs.splice(mi, 1);
    }

    // 3) finalise dominant source / type for each run
    for (var f = 0; f < runs.length; f++) {
      var run = runs[f];
      var domSlug = null, domEx = -1;
      for (var ks in run.srcExcl) {
        if (run.srcExcl.hasOwnProperty(ks) && run.srcExcl[ks] > domEx) { domEx = run.srcExcl[ks]; domSlug = ks; }
      }
      run.domSlug = domSlug == null ? '' : domSlug;
      var ty = srcType[run.domSlug] || 'plugin';
      if (ty === 'unknown') ty = 'plugin-other';
      if (tailSlugs[run.domSlug]) ty = 'plugin-other';
      run.type = ty;
    }
    runs.sort(function (x, y) { return x.startNs - y.startNs; });

    // 4) place spans on the timeline, emitting Unattributed gaps where time is unaccounted.
    var GAP_MIN = 0.4; // ms — ignore hairline slivers
    var spans = [];
    var cursor = 0, sid = 0;
    for (var p = 0; p < runs.length; p++) {
      var rn = runs[p];
      var startMs = rn.startNs / 1e6;
      if (startMs - cursor > GAP_MIN) {
        spans.push({ id: 'un' + sid++, name: 'Unattributed', src: '', type: 'unattributed', start: cursor, dur: startMs - cursor });
      }
      var start = Math.max(startMs, cursor);
      var dur = rn.excl / 1e6;
      if (start + dur > T) dur = Math.max(0, T - start);
      var srcMeta = srcBySlug[rn.domSlug] || {};
      var isOther = (rn.type === 'plugin-other');
      spans.push({
        id: 'sp' + sid++,
        name: isOther ? 'Other' : (rn.domSlug || 'unknown'),
        src: rn.domSlug || '', type: rn.type,
        start: start, dur: dur,
        incl: srcMeta.inclusive_ns != null ? srcMeta.inclusive_ns / 1e6 : dur,
        calls: rn.calls,
        mem: srcMeta.memory_delta != null ? srcMeta.memory_delta : null,
        count: isOther ? otherCount : undefined
      });
      cursor = start + dur;
    }
    if (T - cursor > GAP_MIN) {
      spans.push({ id: 'un' + sid++, name: 'Unattributed', src: '', type: 'unattributed', start: cursor, dur: T - cursor });
    }
    return spans;
  }

  function deriveBands(phases, T) {
    function at(names) {
      for (var i = 0; i < names.length; i++) {
        for (var j = 0; j < phases.length; j++) if (phases[j].n === names[i]) return phases[j].ms;
      }
      return null;
    }
    var init = at(['init']);
    var parse = at(['parse_request', 'wp_loaded']);
    var render = at(['wp_head', 'loop_start']);
    var b = [];
    var bootEnd = init != null ? init : (T * 0.12);
    var setupEnd = parse != null ? parse : (T * 0.5);
    var queryEnd = render != null ? render : (T * 0.8);
    bootEnd = clamp(bootEnd, 0, T);
    setupEnd = clamp(Math.max(setupEnd, bootEnd), 0, T);
    queryEnd = clamp(Math.max(queryEnd, setupEnd), 0, T);
    b.push({ n: 'BOOT', s: 0, e: bootEnd, hue: 'slate' });
    b.push({ n: 'SETUP', s: bootEnd, e: setupEnd, hue: 'teal' });
    b.push({ n: 'QUERY', s: setupEnd, e: queryEnd, hue: 'amber' });
    b.push({ n: 'RENDER', s: queryEnd, e: T, hue: 'violet' });
    return b;
  }

  function buildQbins(queries, T) {
    if (!queries.length || !T) return [];
    var N = 12;
    var w = T / N;
    var counts = [];
    for (var i = 0; i < N; i++) counts.push(0);
    for (var q = 0; q < queries.length; q++) {
      var off = (queries[q].offset_ns || 0) / 1e6;
      var idx = clamp(Math.floor(off / w), 0, N - 1);
      counts[idx]++;
    }
    var out = [];
    for (var b = 0; b < N; b++) {
      if (counts[b] > 0) out.push([Math.round(b * w), Math.round((b + 1) * w), counts[b]]);
    }
    return out;
  }

  function buildRead(aggArr, T) {
    if (!aggArr.length) return '';
    var largest = aggArr[0];
    var share = T ? (largest.dur / T * 100) : 0;
    if (largest.type === 'unattributed') {
      return 'Most of this request is Unattributed Time — ' + share.toFixed(1) +
        '%. Profiling captured little attributable callback activity here.';
    }
    var name = largest.type === 'plugin-other' ? ('Other (' + largest.count + ' sources)') : largest.name;
    var sentence = 'Most time is associated with ' + name + ' (' + share.toFixed(1) + '%).';
    // call out unattributed if it is itself a notable chunk
    var un = null;
    for (var i = 0; i < aggArr.length; i++) if (aggArr[i].type === 'unattributed') un = aggArr[i];
    if (un) {
      var us = T ? (un.dur / T * 100) : 0;
      if (us >= 20) sentence += ' Unattributed Time is also high (' + us.toFixed(1) + '%).';
    }
    return sentence;
  }

  /* ------------------------------------------------------------------ *
   * Renderer                                                            *
   * ------------------------------------------------------------------ */
  function ensureDeutFilter() {
    if (document.getElementById('scrut-deut')) return;
    var svg = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true' });
    setStyle(svg, { position: 'absolute', width: '0', height: '0' });
    var filt = svgEl('filter', { id: 'scrut-deut' });
    filt.appendChild(svgEl('feColorMatrix', {
      type: 'matrix',
      values: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0'
    }));
    svg.appendChild(filt);
    document.body.appendChild(svg);
  }

  function ticksFor(T) {
    var target = T / 6 || 1;
    var pow = Math.pow(10, Math.floor(Math.log10(target)));
    var cands = [1, 2, 2.5, 5, 10].map(function (m) { return m * pow; });
    var step = null;
    for (var i = 0; i < cands.length; i++) { if (cands[i] >= target) { step = cands[i]; break; } }
    if (step == null) step = 10 * pow;
    var out = [];
    for (var v = 0; v < T - step * 0.3; v += step) out.push(Math.round(v));
    out.push(T);
    return out;
  }

  function render(container, profileData, opts) {
    opts = opts || {};
    var model = deriveModel(profileData);
    RANK_COLORS = model.pluginColors || {};
    ensureDeutFilter();

    var optShowMemory = opts.showMemory !== false;
    var optShowQueries = opts.showQueries !== false;

    var state = {
      zoom: 1, panFrac: 0, cbSim: false,
      hoveredId: null, selectedId: null, vpFocused: false,
      drag: null, tipX: 0, tipY: 0
    };

    var refs = { viewport: null, track: null, mini: null };

    // floating tooltip lives on <body> so it escapes any clipping / filter
    var tipEl = document.createElement('div');
    setStyle(tipEl, { display: 'none', position: 'fixed', zIndex: 9999, pointerEvents: 'none' });
    document.body.appendChild(tipEl);

    var T = model.T;
    var pct = function (ms) { return ms / T * 100; };

    /* ---------- lookups ---------- */
    function spanById(id) {
      for (var i = 0; i < model.spans.length; i++) if (model.spans[i].id === id) return model.spans[i];
      return null;
    }
    function httpById(id) {
      for (var i = 0; i < model.http.length; i++) if (model.http[i].id === id) return model.http[i];
      return null;
    }
    function aggByKey(key) {
      for (var i = 0; i < model.sources.length; i++) if (model.sources[i].key === key) return model.sources[i];
      return null;
    }
    function grpKeyOfSpan(sp) {
      if (!sp) return null;
      if (sp.type === 'unattributed') return '__un';
      if (sp.type === 'plugin-other') return '__other';
      return sp.src || sp.name;
    }
    // id used by ownership/legend segments -> map to a representative span id (for selection)
    function spanIdForAgg(a) {
      for (var i = 0; i < model.spans.length; i++) {
        if (grpKeyOfSpan(model.spans[i]) === a.key) return model.spans[i].id;
        if (a.type === 'unattributed' && model.spans[i].type === 'unattributed') return model.spans[i].id;
        if (a.type === 'plugin-other' && model.spans[i].type === 'plugin-other') return model.spans[i].id;
      }
      return a.key;
    }
    function attrSpanOrder() {
      var o = [];
      for (var i = 0; i < model.spans.length; i++) if (model.spans[i].type !== 'unattributed') o.push(model.spans[i].id);
      return o;
    }

    /* ---------- interactions ---------- */
    function onWheel(e) {
      if (!refs.viewport || !refs.viewport.contains(e.target)) return;
      e.preventDefault();
      var rect = refs.viewport.getBoundingClientRect();
      var px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      var z0 = state.zoom, pf0 = state.panFrac;
      var z1 = clamp(z0 * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 18);
      var leftFrac0 = pf0 * (1 - 1 / z0);
      var world = leftFrac0 + px / z0;
      var leftFrac1 = world - px / z1;
      var pf1 = z1 > 1 ? leftFrac1 / (1 - 1 / z1) : 0;
      state.zoom = z1; state.panFrac = clamp(pf1, 0, 1);
      paint();
    }
    function onPointerDown(e) {
      // minimap navigation
      if (refs.mini && refs.mini.contains(e.target)) { miniNavigate(e); startMiniDrag(); return; }
      if (!refs.viewport || !refs.viewport.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-id]')) return; // let segment clicks through
      state.drag = { x: e.clientX, pf: state.panFrac, w: refs.viewport.getBoundingClientRect().width };
      if (refs.viewport) refs.viewport.style.cursor = 'grabbing';
    }
    var miniDragging = false;
    function startMiniDrag() { miniDragging = true; }
    function miniNavigate(e) {
      var rect = refs.mini.getBoundingClientRect();
      var frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      var z = state.zoom;
      var leftFrac = clamp(frac - 0.5 / z, 0, 1 - 1 / z);
      var pf = z > 1 ? leftFrac / (1 - 1 / z) : 0;
      state.panFrac = clamp(pf, 0, 1);
      paint();
    }
    function onPointerMove(e) {
      if (miniDragging && refs.mini) { miniNavigate(e); return; }
      if (state.drag) {
        var z = state.zoom;
        if (z > 1) {
          var dPf = -(e.clientX - state.drag.x) / (state.drag.w * (z - 1));
          state.panFrac = clamp(state.drag.pf + dPf, 0, 1);
          paint();
        }
      }
    }
    function onPointerUp() {
      if (state.drag) { state.drag = null; if (refs.viewport) refs.viewport.style.cursor = 'grab'; }
      miniDragging = false;
    }
    function zoomIn() { state.zoom = clamp(state.zoom * 1.4, 1, 18); paint(); }
    function zoomOut() { state.zoom = clamp(state.zoom / 1.4, 1, 18); if (state.zoom <= 1) state.panFrac = 0; paint(); }
    function reset() { state.zoom = 1; state.panFrac = 0; paint(); }
    function onKey(e) {
      var order = attrSpanOrder();
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var curIdx = order.indexOf(state.selectedId);
        var next = e.key === 'ArrowRight' ? curIdx + 1 : curIdx - 1;
        if (curIdx === -1) next = e.key === 'ArrowRight' ? 0 : order.length - 1;
        next = clamp(next, 0, order.length - 1);
        state.selectedId = order[next]; state.hoveredId = order[next]; paint();
      } else if (e.key === '+' || e.key === '=') { zoomIn(); }
      else if (e.key === '-') { zoomOut(); }
      else if (e.key === 'Escape') { state.selectedId = null; paint(); }
    }

    function showTip(id, x, y) { state.hoveredId = id; state.tipX = x; state.tipY = y; paint(); }
    function moveTip(x, y) { state.tipX = x; state.tipY = y; positionTip(); }
    function hideTip() { state.hoveredId = null; paint(); }
    function clickSelect(id) { state.selectedId = (state.selectedId === id) ? null : id; paint(); }

    // Catch-all so the tooltip can never stick: when a re-render (zoom / pan /
    // selection) replaces the node under the cursor, that node's mouseleave
    // never fires and hoveredId is stranded. On any pointermove that isn't over
    // a hoverable [data-id] element, clear the tooltip. (tipEl is
    // pointer-events:none, so it never becomes the target itself.)
    function onPointerLeaveCatchAll(e) {
      if (state.hoveredId && !(e.target && e.target.closest && e.target.closest('[data-id]'))) {
        hideTip();
      }
    }

    // persistent listeners (attached once)
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onPointerDown);
    global.addEventListener('pointermove', onPointerMove);
    global.addEventListener('pointermove', onPointerLeaveCatchAll);
    global.addEventListener('pointerup', onPointerUp);

    /* ---------- tooltip ---------- */
    function positionTip() {
      var winW = (typeof global.innerWidth === 'number') ? global.innerWidth : 1200;
      setStyle(tipEl, {
        left: Math.min(state.tipX + 14, winW - 280) + 'px',
        top: (state.tipY + 14) + 'px'
      });
    }
    function renderTip() {
      var hov = state.hoveredId;
      if (!hov) { tipEl.style.display = 'none'; return; }
      var hSpan = spanById(hov) || httpById(hov);
      if (!hov || !hSpan) { tipEl.style.display = 'none'; return; }
      clear(tipEl);
      setStyle(tipEl, {
        display: 'block', background: '#1d2327', borderRadius: '7px', padding: '12px 14px',
        boxShadow: '0 8px 30px rgba(0,0,0,.32)', minWidth: '200px'
      });
      var isHttp = !!hSpan.host;
      var isU = hSpan.type === 'unattributed';
      var tagColor = isHttp ? '#b45309' : isU ? '#6b7280' : colorFor(hSpan.type, hSpan.src);
      var name, tag, m1l, m1, m2l, m2, m3l, m3;
      if (isHttp) {
        var blocking = hSpan.dur / T > 0.2;
        name = hSpan.host; tag = hSpan.method + ' ' + hSpan.status + ' · external';
        m1l = 'Duration'; m1 = fmtMs(hSpan.dur) + ' ms';
        m2l = 'Started'; m2 = '+' + fmtMs(hSpan.start) + ' ms';
        m3l = 'Blocking'; m3 = blocking ? 'yes' : 'no';
      } else if (isU) {
        name = 'Unattributed Time'; tag = 'unattributed';
        m1l = 'Duration'; m1 = fmtMs(hSpan.dur) + ' ms';
        m2l = 'Share'; m2 = (hSpan.dur / T * 100).toFixed(1) + '%';
        m3l = 'Attributed'; m3 = 'no';
      } else {
        name = hSpan.type === 'plugin-other' ? ('Other (' + (hSpan.count || 0) + ' sources)') : hSpan.name;
        tag = typeTag(hSpan.type);
        m1l = 'Exclusive'; m1 = fmtMs(hSpan.dur) + ' ms';
        m2l = 'Inclusive'; m2 = fmtMs(hSpan.incl != null ? hSpan.incl : hSpan.dur) + ' ms';
        m3l = 'Share'; m3 = (hSpan.dur / T * 100).toFixed(1) + '%';
      }
      var head = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });
      head.appendChild(el('span', { fontWeight: 700, fontSize: '13px', color: '#fff' }, { text: name }));
      tipEl.appendChild(head);
      var tagWrap = el('div', { marginBottom: '10px' });
      tagWrap.appendChild(el('span', {
        display: 'inline-block', fontSize: '11px', fontWeight: 600, color: '#fff',
        background: tagColor, padding: '2px 8px', borderRadius: '4px'
      }, { text: tag }));
      tipEl.appendChild(tagWrap);
      var metrics = el('div', { display: 'flex', gap: '18px' });
      [[m1l, m1], [m2l, m2], [m3l, m3]].forEach(function (pair) {
        var cell = el('div');
        cell.appendChild(el('div', { fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }, { text: pair[0] }));
        cell.appendChild(el('div', { fontSize: '14px', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }, { text: pair[1] }));
        metrics.appendChild(cell);
      });
      tipEl.appendChild(metrics);
      positionTip();
    }

    /* ---------- the big paint ---------- */
    function paint() {
      var z = state.zoom, pf = state.panFrac;
      var leftFrac = pf * (1 - 1 / z);

      clear(container);

      var card = el('div', {
        background: TH.cardBg, border: '1px solid ' + TH.cardBorder, borderRadius: '4px',
        boxShadow: TH.shadow, overflow: 'hidden', minWidth: 0
      });
      container.appendChild(card);

      // No tab strip here — the host surface (plugin detail view / relay viewer)
      // already provides the Timeline/Sources/Queries/... tabs. Rendering our
      // own would duplicate them (and ours are non-functional chrome).
      var body = el('div', { padding: '18px 22px 20px' });
      card.appendChild(body);

      body.appendChild(buildSummary());
      if (model.read) body.appendChild(buildRead());
      body.appendChild(buildControls());
      body.appendChild(buildOwnership());

      var data = el('div');
      body.appendChild(data);

      data.appendChild(buildViewport(z, leftFrac));
      data.appendChild(buildMinimap(z, leftFrac));
      data.appendChild(buildLegend());
      var sel = buildSelection();
      if (sel) data.appendChild(sel);

      renderTip();
      if (state.vpFocused && refs.viewport) { try { refs.viewport.focus(); } catch (e) {} }
    }

    /* ---------- chrome pieces ---------- */
    function buildSummary() {
      var wrap = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 22px', marginBottom: '14px' });
      var labelStyle = { fontSize: '12px', color: TH.muted };
      var divider = function () { return el('div', { height: '18px', width: '1px', background: TH.line }); };

      function group(label, valueNode) {
        var g = el('div', { display: 'flex', alignItems: 'baseline', gap: '7px' });
        g.appendChild(el('span', labelStyle, { text: label }));
        g.appendChild(valueNode);
        return g;
      }

      // Server Request Duration
      wrap.appendChild(group('Server Request Duration',
        el('span', { fontSize: '22px', fontWeight: 700, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums', color: TH.text }, { text: fmtMs(T) + ' ms' })));

      var largest = model.sources[0];
      if (largest) {
        wrap.appendChild(divider());
        var lv = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 600, color: TH.text });
        var isU = largest.type === 'unattributed';
        lv.appendChild(el('span', {
          width: '9px', height: '9px', borderRadius: '2px', display: 'inline-block',
          background: isU ? TH.unattrFill : colorFor(largest.type, largest.src),
          backgroundImage: isU ? hatchBg(TH.hatch) : 'none'
        }));
        var lname = largest.type === 'plugin-other' ? ('Other (' + largest.count + ')') : largest.name;
        lv.appendChild(document.createTextNode(lname + ' '));
        lv.appendChild(el('span', { color: TH.muted, fontWeight: 500 }, { text: (largest.dur / T * 100).toFixed(1) + '%' }));
        wrap.appendChild(group('Largest share', lv));
      }

      wrap.appendChild(divider());
      var httpArr = model.http;
      var httpText = httpArr.length
        ? (httpArr.length + ' call' + (httpArr.length > 1 ? 's' : '') + ' · ' + fmtMs(Math.max.apply(null, httpArr.map(function (h) { return h.dur; }))) + ' ms')
        : 'none';
      wrap.appendChild(group('External',
        el('span', { fontSize: '14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: TH.text }, { text: httpText })));

      if (model.memSummary && model.memSummary.deltaMB != null) {
        wrap.appendChild(divider());
        var memVal = el('span', { fontSize: '14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: TH.text });
        memVal.appendChild(document.createTextNode('+' + model.memSummary.deltaMB + ' MB '));
        if (model.memSummary.peakMB != null)
          memVal.appendChild(el('span', { color: TH.muted, fontWeight: 500 }, { text: '(' + model.memSummary.peakMB + ' MB peak)' }));
        wrap.appendChild(group('Observed Memory Delta', memVal));
      }
      return wrap;
    }

    function buildRead() {
      var wrap = el('div', {
        display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '0 0 16px',
        padding: '9px 12px', background: TH.readBg, borderRadius: '4px'
      });
      wrap.appendChild(el('span', { flexShrink: 0, width: '3px', alignSelf: 'stretch', background: TH.accent, borderRadius: '2px' }));
      wrap.appendChild(el('span', { fontSize: '13px', lineHeight: 1.5, color: TH.sub }, { text: model.read }));
      return wrap;
    }

    function buildControls() {
      var row = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', marginBottom: '16px' });

      var grp = el('div', { display: 'inline-flex', alignItems: 'center', gap: '8px' });
      var zoomGroup = el('div', { display: 'inline-flex', border: '1px solid ' + TH.ctlBorder, borderRadius: '4px', overflow: 'hidden', background: TH.btnBg });
      var btnL = el('button', {
        border: 0, background: TH.btnBg, padding: '5px 11px', fontSize: '16px', lineHeight: 1,
        color: TH.text, cursor: 'pointer', borderRight: '1px solid ' + TH.line
      }, { type: 'button', aria: 'Zoom out' });
      btnL.textContent = '−';
      btnL.addEventListener('click', zoomOut);
      var zlabel = el('span', { padding: '6px 12px', fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: TH.sub, minWidth: '46px', textAlign: 'center' }, { text: state.zoom.toFixed(1) + '×' });
      var btnR = el('button', {
        border: 0, background: TH.btnBg, padding: '5px 11px', fontSize: '16px', lineHeight: 1,
        color: TH.text, cursor: 'pointer', borderLeft: '1px solid ' + TH.line
      }, { type: 'button', aria: 'Zoom in' });
      btnR.textContent = '+';
      btnR.addEventListener('click', zoomIn);
      zoomGroup.appendChild(btnL); zoomGroup.appendChild(zlabel); zoomGroup.appendChild(btnR);
      grp.appendChild(zoomGroup);

      var resetBtn = el('button', {
        border: '1px solid ' + TH.ctlBorder, background: TH.resetBg, padding: '6px 12px',
        fontSize: '12px', borderRadius: '4px', color: TH.text, cursor: 'pointer'
      }, { type: 'button', text: 'Reset' });
      resetBtn.addEventListener('click', reset);
      grp.appendChild(resetBtn);
      row.appendChild(grp);

      // Deuteranopia toggle
      var cbBtn = el('button', {
        border: '1px solid ' + (state.cbSim ? TH.accent : TH.ctlBorder),
        background: state.cbSim ? TH.accent : TH.btnBg, color: state.cbSim ? TH.accentText : TH.btnText,
        padding: '6px 10px', fontSize: '12px', borderRadius: '4px', cursor: 'pointer', fontWeight: state.cbSim ? 600 : 400
      }, { type: 'button', text: state.cbSim ? 'Deuteranopia ✓' : 'Deuteranopia sim' });
      cbBtn.addEventListener('click', function () { state.cbSim = !state.cbSim; paint(); });
      row.appendChild(cbBtn);

      row.appendChild(el('div', { flex: '1', minWidth: '10px' }));
      row.appendChild(el('span', { fontSize: '11px', color: TH.faint, whiteSpace: 'nowrap' },
        { text: 'Scroll to zoom · drag to pan · ←/→ to step' }));
      return row;
    }

    /* ---------- ownership bar (dual treatment) ---------- */
    function buildOwnership() {
      var box = el('div', { marginBottom: '18px' });
      var head = el('div', { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' });
      head.appendChild(el('span', { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.07em', color: TH.muted, fontWeight: 600 }, { text: 'Who owns the time' }));
      head.appendChild(el('span', { fontSize: '11px', color: TH.faint }, { text: 'share of ' + fmtMs(T) + ' ms · sorted by cost' }));
      box.appendChild(head);

      var filterWrap = el('div', { filter: state.cbSim ? 'url(#scrut-deut)' : 'none' });
      var bar = el('div', { display: 'flex', width: '100%', height: '34px', borderRadius: '4px', overflow: 'hidden', border: '1px solid ' + TH.line });
      var selKey = state.selectedId ? grpKeyOfSpan(spanById(state.selectedId)) : null;
      var hovKey = state.hoveredId ? grpKeyOfSpan(spanById(state.hoveredId)) : null;

      model.sources.forEach(function (a) {
        var isU = a.type === 'unattributed';
        var share = a.dur / T * 100;
        var active = (selKey === a.key || hovKey === a.key);
        var seg = el('div', {
          width: share + '%', height: '100%', position: 'relative',
          background: isU ? TH.unattrFill : colorFor(a.type, a.src),
          backgroundImage: isU ? hatchBg(TH.hatch) : 'none',
          borderRight: '1px solid ' + TH.cardBg, cursor: 'pointer',
          opacity: selKey ? (selKey === a.key ? 1 : 0.35) : 1,
          boxShadow: active ? 'inset 0 0 0 2px ' + TH.text : 'none', transition: 'opacity .12s'
        }, { 'data-id': spanIdForAgg(a), title: nameForAgg(a) + ' — ' + share.toFixed(1) + '%' });
        if (share > 9) {
          seg.appendChild(el('span', {
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 8px',
            fontSize: '11px', fontWeight: 600, color: isU ? TH.muted : '#fff', whiteSpace: 'nowrap',
            overflow: 'hidden', pointerEvents: 'none', textShadow: isU ? 'none' : '0 1px 1px rgba(0,0,0,.18)'
          }, { text: nameForAgg(a) + '  ' + share.toFixed(1) + '%' }));
        }
        wireAgg(seg, a);
        bar.appendChild(seg);
      });
      filterWrap.appendChild(bar);
      box.appendChild(filterWrap);
      return box;
    }
    function nameForAgg(a) {
      return a.type === 'unattributed' ? 'Unattributed'
        : a.type === 'plugin-other' ? ('Other (' + a.count + ')') : a.name;
    }
    function wireAgg(node, a) {
      var sid = spanIdForAgg(a);
      node.addEventListener('mouseenter', function (e) { showTip(sid, e.clientX, e.clientY); });
      node.addEventListener('mouseleave', hideTip);
      node.addEventListener('click', function () { clickSelect(sid); });
    }

    /* ---------- viewport / track ---------- */
    function buildViewport(z, leftFrac) {
      var vp = el('div', {
        position: 'relative', overflow: 'hidden',
        border: '1px solid ' + (state.vpFocused ? TH.accent : TH.viewportBorder),
        borderRadius: '4px', background: TH.viewportBg, cursor: 'grab',
        outline: state.vpFocused ? '2px solid ' + TH.accent : 'none', outlineOffset: '1px', transition: 'border-color .12s'
      }, { tabindex: '0', role: 'group', aria: 'Request timeline, ' + fmtMs(T) + ' ms total. Use arrow keys to step between segments.' });
      vp.addEventListener('keydown', onKey);
      vp.addEventListener('focus', function () { state.vpFocused = true; paint(); });
      vp.addEventListener('blur', function () { state.vpFocused = false; });
      refs.viewport = vp;

      var filterWrap = el('div', { filter: state.cbSim ? 'url(#scrut-deut)' : 'none' });
      vp.appendChild(filterWrap);

      var track = el('div', {
        position: 'relative', width: (z * 100) + '%',
        transform: 'translateX(-' + (leftFrac * 100).toFixed(4) + '%)',
        transition: state.drag ? 'none' : 'transform .08s linear'
      });
      refs.track = track;
      filterWrap.appendChild(track);

      // gridlines
      var tickVals = ticksFor(T);
      tickVals.forEach(function (v) {
        if (v > 0 && v < T) track.appendChild(el('div', {
          position: 'absolute', left: pct(v) + '%', top: 0, bottom: 0, width: '1px',
          background: TH.gridline, pointerEvents: 'none'
        }));
      });

      // overlay band for blocking HTTP
      model.http.forEach(function (h) {
        if (h.dur / T > 0.2) {
          var ob = el('div', {
            position: 'absolute', left: pct(h.start) + '%', width: pct(h.dur) + '%', top: 0, bottom: 0,
            background: 'rgba(180,83,9,0.08)', borderLeft: '1px dashed rgba(180,83,9,.5)',
            borderRight: '1px dashed rgba(180,83,9,.5)', pointerEvents: 'none', zIndex: 0
          });
          ob.appendChild(el('span', {
            position: 'absolute', top: '3px', left: '50%', transform: 'translateX(-50%)',
            fontSize: '9px', fontWeight: 700, letterSpacing: '.05em', color: '#b45309',
            whiteSpace: 'nowrap', textTransform: 'uppercase'
          }, { text: 'outbound HTTP wait' }));
          track.appendChild(ob);
        }
      });

      track.appendChild(buildRail());
      track.appendChild(buildMainBar());
      track.appendChild(buildHttpLane());
      if (optShowQueries && model.qbins.length) track.appendChild(buildQueryLane());
      if (optShowMemory && model.mem.length) track.appendChild(buildMemoryLane());
      track.appendChild(buildAxis(tickVals));
      return vp;
    }

    function buildRail() {
      var lane = el('div', { position: 'relative', height: '30px', borderBottom: '1px solid ' + TH.laneBorder });
      var GAP = 7;
      var phaseX = model.phases.map(function (p) { return pct(p.ms); });
      var shown = [];
      var flags = model.phases.map(function () { return false; });
      function fits(x) { for (var i = 0; i < shown.length; i++) if (Math.abs(shown[i] - x) < GAP) return false; return true; }
      model.phases.forEach(function (p, i) { if (p.maj && fits(phaseX[i])) { flags[i] = true; shown.push(phaseX[i]); } });
      model.phases.forEach(function (p, i) { if (!p.maj && fits(phaseX[i])) { flags[i] = true; shown.push(phaseX[i]); } });

      model.phases.forEach(function (p, i) {
        var id = 'ph_' + i;
        var hovP = state.hoveredId === id;
        var wrap = el('div', {
          position: 'absolute', left: phaseX[i] + '%', top: 0, bottom: 0, transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
          paddingBottom: '4px', cursor: 'default', zIndex: hovP ? 6 : 2
        }, { 'data-id': id });
        var label = hovP
          ? el('span', { order: 1, fontSize: '10px', color: '#fff', whiteSpace: 'nowrap', fontWeight: 700, background: '#1d2327', padding: '2px 6px', borderRadius: '3px', position: 'absolute', bottom: '15px', display: 'block' }, { text: p.short || p.n })
          : el('span', { order: 1, fontSize: '10px', color: TH.muted, whiteSpace: 'nowrap', marginBottom: '3px', display: flags[i] ? 'block' : 'none' }, { text: p.short || p.n });
        var dot = el('span', { width: '6px', height: '6px', borderRadius: '50%', background: hovP ? TH.accent : '#9499a0', flexShrink: 0, order: 2, boxShadow: hovP ? '0 0 0 3px ' + TH.readBg : 'none' });
        wrap.appendChild(dot);
        wrap.appendChild(label);
        wrap.addEventListener('mouseenter', function () { state.hoveredId = id; paint(); });
        wrap.addEventListener('mouseleave', hideTip);
        lane.appendChild(wrap);
      });
      return lane;
    }

    function buildMainBar() {
      var lane = el('div', { position: 'relative', height: '104px' });
      var sel = state.selectedId, hov = state.hoveredId;
      var dim = sel ? 0.32 : 1;
      var selGrp = sel ? grpKeyOfSpan(spanById(sel)) : null;

      model.spans.forEach(function (sp) {
        var isU = sp.type === 'unattributed';
        var w = pct(sp.dur);
        var myKey = grpKeyOfSpan(sp);
        var active = (sel === sp.id || hov === sp.id);
        var inSelGroup = selGrp && selGrp === myKey;
        var op = sel ? (inSelGroup ? 1 : dim) : 1;
        var share = sp.dur / T * 100;
        var seg = el('div', {
          position: 'absolute', left: pct(sp.start) + '%', width: 'max(' + w.toFixed(3) + '%, 2px)', top: 0, bottom: 0,
          background: isU ? TH.unattrFill : colorFor(sp.type, sp.src),
          backgroundImage: isU ? hatchBg(TH.hatch) : 'none',
          borderRight: '1px solid ' + TH.cardBg, cursor: 'pointer', opacity: op,
          boxShadow: (active || inSelGroup) ? 'inset 0 0 0 2px ' + TH.text : 'none',
          zIndex: (active || inSelGroup) ? 5 : 1, transition: 'opacity .12s'
        }, {
          'data-id': sp.id, role: 'button', tabindex: '-1',
          aria: labelText(sp) + ', ' + typeTag(sp.type) + ', exclusive ' + fmtMs(sp.dur) + ' ms, ' + share.toFixed(1) + '% of request'
        });
        var showLabel = (w > 7 && !isU) || (isU && w > 12);
        if (showLabel) {
          seg.appendChild(el('span', {
            position: 'absolute', left: '7px', right: '6px', top: '50%', transform: 'translateY(-50%)',
            fontSize: '11px', fontWeight: 600, color: isU ? TH.muted : '#fff', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
            textShadow: isU ? 'none' : '0 1px 1px rgba(0,0,0,.18)'
          }, { text: labelText(sp) }));
        }
        seg.addEventListener('mouseenter', function (e) { showTip(sp.id, e.clientX, e.clientY); });
        seg.addEventListener('mousemove', function (e) { moveTip(e.clientX, e.clientY); });
        seg.addEventListener('mouseleave', hideTip);
        seg.addEventListener('click', function () { clickSelect(sp.id); });
        lane.appendChild(seg);
      });
      return lane;
    }
    function labelText(sp) {
      return sp.type === 'unattributed' ? 'Unattributed'
        : sp.type === 'plugin-other' ? ('Other (' + (sp.count || 0) + ')') : sp.name;
    }

    function buildHttpLane() {
      var lane = el('div', { position: 'relative', height: '26px', borderTop: '1px solid ' + TH.laneBorder });
      lane.appendChild(el('span', { position: 'absolute', left: '6px', top: '7px', fontSize: '9px', letterSpacing: '.06em', color: TH.laneLabel, textTransform: 'uppercase', pointerEvents: 'none', zIndex: 3 }, { text: 'HTTP' }));
      model.http.forEach(function (h) {
        var w = Math.max(pct(h.dur), 0.6);
        var blocking = h.dur / T > 0.2;
        var xStart = pct(h.start);
        var xEnd = pct(h.start + h.dur);
        var bar = el('div', {
          position: 'absolute', left: xStart + '%', width: w + '%', top: blocking ? '3px' : '5px',
          height: blocking ? '18px' : '15px', background: blocking ? '#9a4708' : '#b45309', borderRadius: '3px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: '8px', overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(180,83,9,.35)', zIndex: 3
        }, { 'data-id': h.id, title: h.host + ' · ' + h.method + ' ' + h.status + ' · ' + fmtMs(h.dur) + ' ms' });
        if (blocking) {
          // A blocking call is wide by definition — self-label INSIDE the bar so
          // its label can never collide with a trailing call near the right edge.
          bar.appendChild(el('span', {
            padding: '0 6px', fontSize: '9px', fontWeight: 700, letterSpacing: '.04em', color: '#fff',
            pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }, { text: 'BLOCKING · ' + h.host + ' · ' + fmtMs(h.dur) + ' ms' }));
        }
        bar.addEventListener('mouseenter', function (e) { showTip(h.id, e.clientX, e.clientY); });
        bar.addEventListener('mousemove', function (e) { moveTip(e.clientX, e.clientY); });
        bar.addEventListener('mouseleave', hideTip);
        lane.appendChild(bar);
        // Non-blocking calls keep an external label, but flip it to the LEFT of
        // the bar when the bar ends near the right edge so it can't run off-screen.
        if (!blocking) {
          var lblStyle = {
            position: 'absolute', top: '7px', whiteSpace: 'nowrap', fontSize: '10px',
            color: '#92400e', fontWeight: 600, pointerEvents: 'none', zIndex: 3
          };
          if (xEnd > 68) {
            lblStyle.right = 'calc(' + (100 - xStart) + '% + 6px)';
            lblStyle.textAlign = 'right';
          } else {
            lblStyle.left = 'calc(' + xEnd + '% + 6px)';
          }
          lane.appendChild(el('span', lblStyle, { text: h.host + ' · ' + fmtMs(h.dur) + ' ms' }));
        }
      });
      return lane;
    }

    function buildQueryLane() {
      var lane = el('div', { position: 'relative', height: '30px', borderTop: '1px solid ' + TH.laneBorder });
      lane.appendChild(el('span', { position: 'absolute', left: '6px', top: '9px', fontSize: '9px', letterSpacing: '.06em', color: TH.laneLabel, textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }, { text: 'Queries' }));
      var qmax = model.qmax;
      var stormThresh = Math.max(qmax * 0.6, 30);
      model.qbins.forEach(function (q) {
        var h = Math.max(q[2] / qmax * 100, 8);
        var storm = q[2] >= stormThresh;
        lane.appendChild(el('div', {
          position: 'absolute', left: pct(q[0]) + '%', width: 'max(' + pct(q[1] - q[0]).toFixed(2) + '%, 2px)',
          bottom: 0, height: h + '%', background: storm ? TH.queryStorm : TH.queryBar,
          borderRight: '1px solid ' + TH.cardBg, opacity: storm ? 0.95 : 0.7
        }, { title: q[2].toLocaleString() + ' queries · ' + q[0] + '–' + q[1] + ' ms' }));
      });
      return lane;
    }

    function buildMemoryLane() {
      var lane = el('div', { position: 'relative', height: '36px', borderTop: '1px solid ' + TH.laneBorder });
      lane.appendChild(el('span', { position: 'absolute', left: '6px', top: '5px', fontSize: '9px', letterSpacing: '.06em', color: TH.laneLabel, textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }, { text: 'Memory' }));
      var peak = model.memPeak;
      var line = '', i;
      for (i = 0; i < model.mem.length; i++) {
        var x = model.mem[i][0] / T * 1000;
        var y = 100 - (model.mem[i][1] / peak) * 72 - 6;
        line += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      }
      var area = line + 'L1000 100 L0 100 Z';
      var svg = svgEl('svg', { viewBox: '0 0 1000 100', preserveAspectRatio: 'none' });
      setStyle(svg, { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' });
      svg.appendChild(svgEl('path', { d: area, fill: TH.memFill, stroke: 'none' }));
      svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: TH.memStroke, 'stroke-width': '1.5', 'stroke-opacity': '0.9', 'vector-effect': 'non-scaling-stroke' }));
      lane.appendChild(svg);
      var peakMs = 0;
      for (i = 0; i < model.mem.length; i++) if (model.mem[i][1] === peak) { peakMs = model.mem[i][0]; break; }
      lane.appendChild(el('div', {
        position: 'absolute', left: 'calc(' + pct(peakMs) + '% - 4px)', top: '4px', transform: 'translateX(-100%)',
        fontSize: '9px', fontWeight: 700, color: TH.memStroke, background: TH.cardBg, padding: '1px 5px',
        borderRadius: '3px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2
      }, { text: peak + ' MB peak' }));
      return lane;
    }

    function buildAxis(tickVals) {
      var lane = el('div', { position: 'relative', height: '24px', borderTop: '1px solid ' + TH.laneBorder });
      tickVals.forEach(function (v) {
        var tf = v === 0 ? 'translateX(0)' : (v === T ? 'translateX(-100%)' : 'translateX(-50%)');
        lane.appendChild(el('span', {
          position: 'absolute', left: pct(v) + '%', top: '5px', transform: tf, fontSize: '10px',
          color: TH.tick, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
        }, { text: (v === T ? fmtMs(T) + ' ms' : fmtMs(v)) }));
      });
      return lane;
    }

    /* ---------- minimap ---------- */
    function buildMinimap(z, leftFrac) {
      var row = el('div', { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' });
      row.appendChild(el('span', { fontSize: '9px', letterSpacing: '.06em', color: TH.laneLabel, textTransform: 'uppercase', whiteSpace: 'nowrap' }, { text: 'Overview' }));

      var mini = el('div', {
        position: 'relative', flex: '1', height: '22px', background: TH.miniBg,
        border: '1px solid ' + TH.viewportBorder, borderRadius: '3px', overflow: 'hidden', cursor: 'pointer'
      }, { title: 'Click or drag to navigate the zoomed view' });
      refs.mini = mini;
      model.spans.forEach(function (sp) {
        var isU = sp.type === 'unattributed';
        mini.appendChild(el('div', {
          position: 'absolute', left: pct(sp.start) + '%', width: 'max(' + pct(sp.dur).toFixed(2) + '%, 1px)', top: 0, bottom: 0,
          background: isU ? TH.unattrFill : colorFor(sp.type, sp.src),
          backgroundImage: isU ? 'repeating-linear-gradient(45deg,' + TH.hatch + ' 0,' + TH.hatch + ' 1.5px,transparent 1.5px,transparent 4px)' : 'none'
        }));
      });
      mini.appendChild(el('div', {
        position: 'absolute', left: (leftFrac * 100) + '%', width: (1 / z * 100) + '%', top: 0, bottom: 0,
        border: '2px solid ' + TH.accent, background: TH.readBg, borderRadius: '2px', pointerEvents: 'none',
        display: z > 1.001 ? 'block' : 'none'
      }));
      row.appendChild(mini);

      var lo = Math.round(leftFrac * T), hi = Math.round((leftFrac + 1 / z) * T);
      var rangeLabel = z > 1.001
        ? (lo.toLocaleString() + '–' + hi.toLocaleString() + ' ms of ' + fmtMs(T) + ' ms')
        : ('0–' + fmtMs(T) + ' ms (full request)');
      row.appendChild(el('span', { fontSize: '11px', color: TH.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: '150px', textAlign: 'right' }, { text: rangeLabel }));
      return row;
    }

    /* ---------- legend ---------- */
    function buildLegend() {
      var filterWrap = el('div', { filter: state.cbSim ? 'url(#scrut-deut)' : 'none' });
      var wrap = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: '18px', paddingTop: '16px', borderTop: '1px solid ' + TH.lineSoft });
      model.sources.forEach(function (a) {
        var isU = a.type === 'unattributed';
        var item = el('div', { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px' }, { 'data-id': spanIdForAgg(a) });
        item.appendChild(el('span', {
          width: '12px', height: '12px', borderRadius: '3px', flexShrink: 0,
          background: isU ? TH.unattrFill : colorFor(a.type, a.src),
          backgroundImage: isU ? hatchBg(TH.hatch) : 'none', border: '1px solid ' + TH.swatchBorder
        }));
        item.appendChild(el('span', { fontWeight: 500, color: TH.text }, { text: nameForAgg(a) }));
        item.appendChild(el('span', { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: TH.muted, border: '1px solid ' + TH.line, borderRadius: '3px', padding: '1px 5px' }, { text: typeTag(a.type) }));
        item.appendChild(el('span', { color: TH.muted, fontVariantNumeric: 'tabular-nums' }, { text: (a.dur / T * 100).toFixed(1) + '%' }));
        wireAgg(item, a);
        wrap.appendChild(item);
      });
      filterWrap.appendChild(wrap);
      return filterWrap;
    }

    /* ---------- selection detail ---------- */
    function buildSelection() {
      var sp = state.selectedId ? spanById(state.selectedId) : null;
      if (!sp) return null;
      var isU = sp.type === 'unattributed';
      var c = colorFor(sp.type, sp.src);
      var name = sp.type === 'plugin-other' ? ('Other (' + (sp.count || 0) + ' sources)') : isU ? 'Unattributed Time' : sp.name;

      var wrap = el('div', { marginTop: '16px', border: '1px solid ' + TH.line, borderRadius: '4px', overflow: 'hidden' });
      var head = el('div', { display: 'flex', alignItems: 'center', gap: '9px', padding: '12px 16px', background: TH.selHead, borderBottom: '1px solid ' + TH.lineSoft });
      var sw = el('span', { width: '11px', height: '11px', borderRadius: '2px', display: 'inline-block', background: isU ? TH.unattrFill : c, backgroundImage: isU ? hatchBg(TH.hatch) : 'none' });
      head.appendChild(sw);
      head.appendChild(el('span', { fontSize: '14px', fontWeight: 700, color: TH.text }, { text: name }));
      head.appendChild(el('span', { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: TH.muted, border: '1px solid ' + TH.line, borderRadius: '3px', padding: '1px 6px' }, { text: typeTag(sp.type) }));
      head.appendChild(el('span', { flex: '1' }));
      var close = el('button', { border: 0, background: 'transparent', color: TH.muted, fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '0 2px' }, { type: 'button', aria: 'Close detail' });
      close.textContent = '×';
      close.addEventListener('click', function () { state.selectedId = null; paint(); });
      head.appendChild(close);
      wrap.appendChild(head);

      var body = el('div', { display: 'flex', flexWrap: 'wrap', gap: 0, background: TH.cardBg });
      var cells = [
        ['Exclusive Callback Time', fmtMs(sp.dur) + ' ms'],
        ['Inclusive Callback Time', isU ? '—' : fmtMs(sp.incl != null ? sp.incl : sp.dur) + ' ms'],
        ['Share', (sp.dur / T * 100).toFixed(1) + '%'],
        ['Call Count', isU ? '—' : (sp.calls != null ? sp.calls.toLocaleString() : '—')],
        ['Memory', isU ? '—' : (sp.mem != null ? '+' + fmtMB(sp.mem) + ' MB' : '—')]
      ];
      cells.forEach(function (cell, i) {
        var last = i === cells.length - 1;
        var cw = el('div', last
          ? { flex: '1', minWidth: '90px', padding: '13px 16px' }
          : { flex: '1', minWidth: '110px', padding: '13px 16px', borderRight: '1px solid ' + TH.lineSoft });
        cw.appendChild(el('div', { fontSize: '11px', color: TH.muted, marginBottom: '3px' }, { text: cell[0] }));
        cw.appendChild(el('div', { fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: TH.text }, { text: cell[1] }));
        body.appendChild(cw);
      });
      wrap.appendChild(body);
      return wrap;
    }

    /* ---------- go ---------- */
    paint();

    return {
      model: model,
      destroy: function () {
        container.removeEventListener('wheel', onWheel);
        container.removeEventListener('pointerdown', onPointerDown);
        global.removeEventListener('pointermove', onPointerMove);
        global.removeEventListener('pointerup', onPointerUp);
        if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
        clear(container);
      }
    };
  }

  global.ScrutinizerTimeline = { render: render, deriveModel: deriveModel };

})(typeof window !== 'undefined' ? window : this);
