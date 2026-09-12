// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/layer3 as layer3';

// Shared UI helpers for wifimgr views (DOM builders, badges, sparklines, forms,
// apply-flow, modal). Extracted from index.js so tab modules stay small.
// Stateless except the history ring buffers below (per-page singletons).

// -- BAND METADATA --
var BANDS = {
    radio0: { label: '2.4 GHz', bg: '#0d2137', fg: '#5b9bd5' },
    radio1: { label: '5 GHz',   bg: '#0d2a1a', fg: '#4caf7d' },
    radio2: { label: '6 GHz',   bg: '#2a1800', fg: '#f5a623' }
};

var ENC_LABEL = {
    'none':      'Open',
    'psk':       'WPA',
    'psk2':      'WPA2',
    'psk-mixed': 'WPA/WPA2',
    'sae':       'WPA3',
    'sae-mixed': 'WPA2/WPA3',
    'owe':       'OWE (open secure)'
};

// -- COLLAPSIBLE STATE (localStorage) --
function colGet(key, def) {
    var v = localStorage.getItem('wmc_' + key);
    return v === null ? (def !== false) : v === '1';
}
function colSet(key, v) { localStorage.setItem('wmc_' + key, v ? '1' : '0'); }

// -- HISTORY RING BUFFERS (module singletons) --
var _signalHistory = {}; // ifname -> Array<number|null>
var _utilHistory   = {}; // radio_id -> Array<number|null>
var _rssiMloBufs   = {}; // ifname -> { link_id: Array<number|null> }

// ── DOM HELPERS ───────────────────────────────────────────────────────────────

function node(tag, attrs) {
    var el = E(tag, attrs || {});
    for (var i = 2; i < arguments.length; i++) {
        var c = arguments[i];
        if (c == null) continue;
        if (Array.isArray(c)) { c.forEach(function(x) { if (x != null) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); }
        else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}

function sp(text, style) { return node('span', style ? { style: style } : {}, text); }
function div(style) {
    var el = node('div', style ? { style: style } : {});
    for (var i = 1; i < arguments.length; i++) {
        var c = arguments[i];
        if (c == null) continue;
        if (Array.isArray(c)) { c.forEach(function(x) { if (x != null) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); }
        else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}

function bandPill(radio_id) {
    var b = BANDS[radio_id] || { label: radio_id, bg: '#222', fg: '#aaa' };
    return node('span', {
        style: 'display:inline-block;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:bold;' +
               'background:' + b.bg + ';color:' + b.fg + ';margin-right:4px;white-space:nowrap'
    }, BANDS[radio_id] ? b.label : radio_id);
}

function statusBadge(state) {
    var s = (state || '').toUpperCase();
    var label = s === 'ENABLED'      ? 'Active'
              : s === 'UP'          ? 'Up'
              : s === 'DISABLED'    ? 'Disabled'
              : s === 'DOWN'        ? 'Down'
              : s === 'INIT_FAILED' ? 'Config error'
              : s === 'SCANNING'    ? 'Scanning…'
              : s === 'DISCONNECTED'? 'Disconnected'
              : (state || 'Unknown');
    var color = (s === 'ENABLED' || s === 'UP')                              ? '#1d9e75'
              : (s === 'DISABLED')                                            ? '#555'
              : (s === 'INIT_FAILED' || s === 'SCANNING' || s === 'DISCONNECTED') ? '#f5a623'
              : '#e24b4a';
    return node('span', {
        style: 'display:inline-block;padding:1px 8px;border-radius:3px;font-size:11px;' +
               'background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44'
    }, label);
}

function encLabel(enc) { return ENC_LABEL[enc] || enc || 'Open'; }

function signalBars(dbm) {
    if (dbm == null) return sp('—', 'color:#555');
    var bars  = dbm >= -50 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
    var color = bars === 4 ? '#1d9e75' : bars === 3 ? '#5b9bd5' : bars === 2 ? '#f5a623' : '#e24b4a';
    var wrap  = node('span', { style: 'display:inline-flex;align-items:flex-end;gap:2px;height:14px;vertical-align:middle;margin-right:5px' });
    for (var i = 1; i <= 4; i++) {
        wrap.appendChild(node('span', {
            style: 'display:inline-block;width:3px;background:' + (i <= bars ? color : '#2a2a4a') +
                   ';height:' + (i * 3 + 2) + 'px;border-radius:1px'
        }));
    }
    return node('span', {}, wrap, sp(dbm + ' dBm', 'color:' + color + ';font-size:12px'));
}

// ── SIGNAL HISTORY ────────────────────────────────────────────────────────────

var SIG_HIST_MAX = 20;

function sigColor(dbm) {
    if (dbm == null) return '#555';
    return dbm >= -50 ? '#1d9e75' : dbm >= -65 ? '#5b9bd5' : dbm >= -75 ? '#f5a623' : '#e24b4a';
}

function sigHistPush(ifname, dbm) {
    if (!_signalHistory[ifname]) _signalHistory[ifname] = [];
    var h = _signalHistory[ifname];
    h.push(dbm != null ? dbm : null);
    if (h.length > SIG_HIST_MAX) h.shift();
}

function sigHistStats(ifname) {
    var vals = (_signalHistory[ifname] || []).filter(function(v) { return v != null; });
    if (!vals.length) return null;
    var min = vals[0], max = vals[0], sum = 0;
    vals.forEach(function(v) { if (v < min) min = v; if (v > max) max = v; sum += v; });
    return { min: min, max: max, avg: Math.round(sum / vals.length) };
}

function renderSignalHistory(ifname, sparkEl, statsEl) {
    var h = _signalHistory[ifname] || [];
    var CHARS = '▁▂▃▄▅▆▇█';
    while (sparkEl.firstChild) sparkEl.removeChild(sparkEl.firstChild);
    if (!h.length) { sparkEl.appendChild(sp('·', 'color:#444')); statsEl.textContent = ''; return; }
    h.forEach(function(dbm) {
        var idx = dbm == null ? 0 : Math.min(7, Math.max(0, Math.round((dbm + 90) / 45 * 7)));
        sparkEl.appendChild(node('span', { style: 'color:' + sigColor(dbm) }, CHARS[idx]));
    });
    var st = sigHistStats(ifname);
    statsEl.textContent = st ? 'min ' + st.min + ' · avg ' + st.avg + ' · max ' + st.max + ' dBm' : '';
}

function utilHistPush(radioId, pct) {
    if (!_utilHistory[radioId]) _utilHistory[radioId] = [];
    var h = _utilHistory[radioId];
    h.push(pct != null ? pct : null);
    if (h.length > SIG_HIST_MAX) h.shift();
}

function utilColor(pct) {
    if (pct == null) return '#444';
    if (pct < 30)   return '#4caf7d';
    if (pct < 60)   return '#f5a623';
    return '#e24b4a';
}

function renderUtilHistory(radioId, sparkEl, statsEl) {
    var h = _utilHistory[radioId] || [];
    var CHARS = '▁▂▃▄▅▆▇█';
    while (sparkEl.firstChild) sparkEl.removeChild(sparkEl.firstChild);
    if (!h.length) { sparkEl.appendChild(sp('·', 'color:#444')); statsEl.textContent = ''; return; }
    h.forEach(function(pct) {
        var idx = pct == null ? 0 : Math.min(7, Math.max(0, Math.round(pct / 100 * 7)));
        sparkEl.appendChild(node('span', { style: 'color:' + utilColor(pct) }, CHARS[idx]));
    });
    var vals = h.filter(function(v) { return v != null; });
    if (vals.length) {
        var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        var avg = Math.round(vals.reduce(function(a, b) { return a + b; }, 0) / vals.length);
        statsEl.textContent = 'min ' + min + ' · avg ' + avg + ' · max ' + max + '%';
    } else {
        statsEl.textContent = '';
    }
}

function genBadge(htmode) {
    var h = (htmode || '').toUpperCase();
    var mode, bg, fg;
    if      (h.indexOf('EHT') >= 0) { mode = 'WiFi 7'; bg = '#1a0a3a'; fg = '#afa9ec'; }
    else if (h.indexOf('HE')  >= 0) { mode = 'WiFi 6'; bg = '#0a1a3a'; fg = '#85b7eb'; }
    else if (h.indexOf('VHT') >= 0) { mode = 'WiFi 5'; bg = '#0a2a1a'; fg = '#4caf7d'; }
    else if (h.indexOf('HT')  >= 0) { mode = 'WiFi 4'; bg = '#1a2030'; fg = '#888';    }
    else return null;
    return sp(mode, 'font-size:11px;padding:1px 6px;background:' + bg + ';color:' + fg + ';border-radius:3px;flex-shrink:0');
}

// WiFi generation badge auto-detected from iw bitrate string (e.g. "2401.9 MBit/s 160MHz EHT-MCS 11...")
function modeBadge(bitrateStr, isMld) {
    if (!bitrateStr) return null;
    var s = String(bitrateStr).toUpperCase();
    var mode, bg, fg;
    if      (s.indexOf('EHT') >= 0)  { mode = isMld ? 'WiFi 7' : 'EHT'; bg = '#1a0a3a'; fg = '#afa9ec'; }
    else if (s.indexOf(' HE')  >= 0) { mode = 'WiFi 6'; bg = '#0a1a3a'; fg = '#85b7eb'; }
    else if (s.indexOf('VHT')  >= 0) { mode = 'WiFi 5'; bg = '#0a2a1a'; fg = '#4caf7d'; }
    else if (s.indexOf('MCS')  >= 0) { mode = 'WiFi 4'; bg = '#1a2030'; fg = '#888';    }
    else                             { mode = 'Legacy'; bg = '#1a1a1a'; fg = '#555';    }
    return sp(mode, 'font-size:11px;padding:1px 6px;background:' + bg + ';color:' + fg + ';border-radius:3px;flex-shrink:0');
}

// Map client link_id → radio id using AP MLD link freq data
function clientLinkBand(ifname, link_id, data) {
    var mld = (data.mlds || []).find(function(m) { return m.ifname === ifname; });
    if (!mld) return null;
    var apLink = (mld.links || []).find(function(l) { return l.link_id === link_id; });
    if (!apLink || !apLink.freq) return null;
    return apLink.freq < 3000 ? 'radio0' : apLink.freq < 5900 ? 'radio1' : 'radio2';
}

// Parse iw bitrate string → {speed:'2402 Mbit/s', detail:'EHT MCS11 NSS2'}
function parseBitrate(s) {
    if (!s) return null;
    var m = s.match(/^([\d.]+)\s*MBit\/s/i);
    if (!m) return { speed: s, detail: null };
    var speed = Math.round(parseFloat(m[1])) + ' Mbit/s';
    var detail = '';
    var ehtM = s.match(/EHT-MCS\s*(\d+)/i), ehtN = s.match(/EHT-NSS\s*(\d+)/i);
    var heM  = s.match(/HE-MCS\s*(\d+)/i),  heN  = s.match(/HE-NSS\s*(\d+)/i);
    var vhtM = s.match(/VHT-MCS\s*(\d+)/i), vhtN = s.match(/VHT-NSS\s*(\d+)/i);
    if      (ehtM) detail = 'EHT MCS' + ehtM[1] + (ehtN ? ' NSS' + ehtN[1] : '');
    else if (heM)  detail = 'HE MCS'  + heM[1]  + (heN  ? ' NSS' + heN[1]  : '');
    else if (vhtM) detail = 'VHT MCS' + vhtM[1] + (vhtN ? ' NSS' + vhtN[1] : '');
    else { var htM = s.match(/MCS\s*(\d+)/); if (htM) detail = 'MCS' + htM[1] + (s.indexOf('short GI') >= 0 ? ' SGI' : ''); }
    return { speed: speed, detail: detail || null };
}

// Best signal for display: per-link signals for MLO (top-level iw signal is 0 for MLO)
function bestClientSignal(c) {
    if (c.links && c.links.length) {
        var sigs = c.links.map(function(l) { return l.signal; }).filter(function(s) { return typeof s === 'number' && s < 0; });
        if (sigs.length) return Math.max.apply(null, sigs);
    }
    return (c.signal === 0) ? null : c.signal;
}

// Best RX speed for header (highest link RX rate)
function bestClientSpeed(c) {
    var best = 0, bestStr = null;
    var cands = [];
    if (c.links && c.links.length) c.links.forEach(function(lk) { if (lk.rx_bitrate) cands.push(lk.rx_bitrate); });
    if (!cands.length && c.rx_bitrate) cands.push(c.rx_bitrate);
    cands.forEach(function(s) {
        var p = parseBitrate(s);
        if (!p) return;
        var n = parseInt(p.speed);
        if (!isNaN(n) && n > best) { best = n; bestStr = p.speed; }
    });
    return bestStr;
}

function bestClientDetail(c) {
    var cands = [];
    if (c.links && c.links.length) c.links.forEach(function(lk) { if (lk.tx_bitrate) cands.push(lk.tx_bitrate); });
    if (!cands.length && c.tx_bitrate) cands.push(c.tx_bitrate);
    var best = 0, bestDetail = null;
    cands.forEach(function(s) {
        var p = parseBitrate(s);
        if (!p || !p.detail) return;
        var n = parseInt(p.speed);
        if (!isNaN(n) && n > best) { best = n; bestDetail = p.detail; }
    });
    return bestDetail;
}

function wpaLabel(state) {
    if (!state || state === 'DISCONNECTED') return 'Disconnected';
    if (state === 'COMPLETED') return 'Connected';
    if (state === 'SCANNING')  return 'Scanning...';
    if (state === 'ASSOCIATING' || state === 'AUTHENTICATING') return 'Connecting...';
    return state;
}

function decodeMldLinks(bitmap) {
    if (bitmap == null) return '—';
    var bands = [];
    if (bitmap & 1) bands.push('2.4G');
    if (bitmap & 2) bands.push('5G');
    if (bitmap & 4) bands.push('6G');
    return bands.length ? bands.join(' + ') : String(bitmap);
}

function fmtMbps(v) {
    if (v < 0.05) return '0.0';
    if (v >= 100)  return Math.round(v) + '';
    if (v >= 10)   return v.toFixed(1);
    return v.toFixed(2);
}

function drawSparkline(canvas, rxBuf, txBuf) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var n = Math.max(rxBuf.length, txBuf.length);
    if (n < 2) return;
    var maxVal = 0;
    for (var i = 0; i < rxBuf.length; i++) if (rxBuf[i] > maxVal) maxVal = rxBuf[i];
    for (var i = 0; i < txBuf.length; i++) if (txBuf[i] > maxVal) maxVal = txBuf[i];
    if (maxVal === 0) return;
    function drawLine(buf, color) {
        if (buf.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        for (var i = 0; i < buf.length; i++) {
            var x = (i / (n - 1)) * (w - 2) + 1;
            var y = h - 2 - (buf[i] / maxVal) * (h - 4);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    drawLine(txBuf, '#5b9bd5');
    drawLine(rxBuf, '#4caf50');
}

function rssiMloPush(ifname, links) {
    if (!_rssiMloBufs[ifname]) _rssiMloBufs[ifname] = {};
    var buf = _rssiMloBufs[ifname];
    (links || []).forEach(function(lk) {
        var id = lk.link_id;
        if (!buf[id]) buf[id] = [];
        var sig = (typeof lk.signal === 'number' && lk.signal < 0) ? lk.signal : null;
        buf[id].push(sig);
        if (buf[id].length > 30) buf[id].shift();
    });
}

function drawRssiSparkline(canvas, ifname, links) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, W, H);
    var buf = _rssiMloBufs[ifname] || {};
    var MIN = -85, MAX = -35;
    (links || []).forEach(function(lk) {
        var data = buf[lk.link_id] || [];
        if (data.length < 2) return;
        var freq = lk.freq || 0;
        var color = freq < 3000 ? '#5b9bd5' : freq < 5950 ? '#4caf7d' : '#f5a623';
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
        var drawn = false;
        for (var i = 0; i < data.length; i++) {
            var v = data[i];
            if (v === null) { drawn = false; continue; }
            var x = (W - 2) * i / (data.length - 1) + 1;
            var y = H - 2 - ((v - MIN) / (MAX - MIN)) * (H - 4);
            y = Math.max(1, Math.min(H - 1, y));
            if (!drawn) { ctx.moveTo(x, y); drawn = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });
}

function card() {
    var el = node('div', { style: 'background:#16213e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 16px;margin-bottom:10px' });
    for (var i = 0; i < arguments.length; i++) { var c = arguments[i]; if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
}

function rowEl(left, right) {
    var el = node('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px' });
    if (left)  el.appendChild(typeof left  === 'string' ? sp(left,  'color:#888;font-size:12px') : left);
    if (right) el.appendChild(typeof right === 'string' ? sp(right, 'color:#ddd;font-size:13px') : right);
    return el;
}

function lbl(text) { return sp(text, 'color:#888;font-size:12px'); }
function val(text) { return sp(String(text == null ? '—' : text), 'color:#ddd;font-size:13px'); }
function muted(text) { return sp(text, 'color:#555;font-size:12px'); }
function strong(text) { return node('strong', { style: 'color:#ddd' }, text); }

function btn(text, color, onclick) {
    var el = node('button', {
        style: 'padding:5px 14px;background:' + (color || '#185fa5') + ';color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px'
    }, text);
    el.onclick = onclick;
    return el;
}
function btnDanger(text, onclick)    { return btn(text, '#6b1c1c', onclick); }
function btnSecondary(text, onclick) { return btn(text, '#1e2a3a', onclick); }

function inputField(value, placeholder, type) {
    return node('input', {
        type: type || 'text', value: value || '', placeholder: placeholder || '',
        style: 'background:#0d1b2a;color:#ddd;border:1px solid #334;border-radius:4px;padding:5px 9px;width:100%;box-sizing:border-box;font-size:13px'
    });
}

function pwdWrap(input) {
    input.type = 'password';
    var visible = false;
    var toggle = node('button', {
        type: 'button',
        style: 'background:none;border:1px solid #2a3a4a;border-radius:3px;color:#888;cursor:pointer;font-size:12px;padding:2px 7px;margin-left:6px;flex-shrink:0;white-space:nowrap'
    }, 'Show');
    toggle.onclick = function() {
        visible = !visible;
        input.type = visible ? 'text' : 'password';
        toggle.textContent = visible ? 'Hide' : 'Show';
    };
    input.style.flex = '1';
    input.style.minWidth = '0';
    return node('div', { style: 'display:flex;align-items:center;width:100%' }, input, toggle);
}

function selectEl(opts, cur) {
    var el = node('select', { style: 'background:#0d1b2a;color:#ddd;border:1px solid #334;border-radius:4px;padding:5px 8px;font-size:13px' });
    opts.forEach(function(o) {
        var op = node('option', { value: o[0] }, o[1]);
        if (o[0] === cur) op.setAttribute('selected', 'selected');
        el.appendChild(op);
    });
    return el;
}

// Network name dropdown with preset options + optional custom text entry.
// AP mode: lan/guest/iot  |  STA/uplink mode: wwan/lan
// Returns a div element with ._getValue() method for reading current value.
function networkSel(currentVal, forSTA) {
    var OPTS = forSTA
        ? [['wwan','wwan (uplink)'],['lan','lan'],['guest','guest'],['custom','custom…']]
        : [['lan','lan'],['guest','guest'],['iot','iot'],['custom','custom…']];
    var val  = currentVal || (forSTA ? 'wwan' : 'lan');
    var inList = OPTS.some(function(o) { return o[0] === val; });
    var sel     = selectEl(OPTS, inList ? val : 'custom');
    var customIn = inputField(inList ? '' : val, 'enter network name');
    customIn.style.display   = (sel.value === 'custom') ? '' : 'none';
    customIn.style.marginTop = '4px';
    sel.addEventListener('change', function() {
        customIn.style.display = sel.value === 'custom' ? '' : 'none';
    });
    var wrap = node('div', {}, sel, customIn);
    wrap._getValue = function() { return sel.value === 'custom' ? customIn.value.trim() : sel.value; };
    return wrap;
}

function formRow(lbl_text, inp) {
    var el = node('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px' });
    el.appendChild(node('label', { style: 'color:#888;font-size:12px;min-width:110px;flex-shrink:0' }, lbl_text));
    el.appendChild(node('div', { style: 'flex:1' }, inp));
    return el;
}

function inlineErr(msg) { return node('div', { style: 'color:#e24b4a;font-size:12px;margin-top:5px' }, msg); }

function successBadge(msg) {
    var el = node('span', { style: 'color:#1d9e75;font-size:12px;padding:2px 8px;background:#1d9e7520;border-radius:3px' }, msg || 'Saved');
    setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.8s'; }, 1800);
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
    return el;
}

function collapsible(key, headerEl, bodyFn, defaultOpen) {
    var open = colGet(key, defaultOpen);
    var chevron = sp(open ? '▲' : '▼', 'font-size:10px;color:#555;margin-left:6px');
    var body = node('div', { style: 'margin-top:10px' });
    if (open) body.appendChild(bodyFn());

    var hdr = node('div', { style: 'display:flex;align-items:center;cursor:pointer;user-select:none' },
        typeof headerEl === 'string' ? sp(headerEl, 'color:#ccc;font-weight:bold;font-size:13px') : headerEl,
        chevron);
    hdr.onclick = function() {
        open = !open; colSet(key, open);
        chevron.textContent = open ? '▲' : '▼';
        while (body.firstChild) body.removeChild(body.firstChild);
        if (open) body.appendChild(bodyFn());
    };

    var wrap = node('div', {}, hdr, body);
    return wrap;
}

function checkbox(checked) {
    var el = node('input', { type: 'checkbox' });
    if (checked) el.setAttribute('checked', 'checked');
    return el;
}

function formatDuration(secs) {
    if (!secs) return '';
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + s + 's' : s + 's';
}

// ── APPLY FLOW ────────────────────────────────────────────────────────────────

function humanError(msg) {
    if (!msg) return 'An error occurred.';
    if (msg.includes('6 GHz') || msg.includes('sae') || msg.includes('owe'))
        return 'This network requires WPA3 encryption.';
    if (msg.includes('sku_idx'))
        return 'Country and regulatory index must be changed together.';
    if (msg.includes('2 radios') || msg.includes('MLD'))
        return 'WiFi 7 setup requires at least 2 radios.';
    if (msg.includes('ssid'))
        return 'Network name is required.';
    if (msg.includes('uci_write') || msg.includes('uci_add'))
        return 'Failed to save settings.';
    return msg;
}

function applyFlow(container, fn, onDone, lockFn) {
    while (container.firstChild) container.removeChild(container.firstChild);

    var pbarOuter = node('div', { style: 'height:4px;background:#1a2a3a;border-radius:2px;margin-top:8px' });
    var pbar      = node('div', { style: 'height:4px;width:0%;background:#5b9bd5;border-radius:2px;transition:width 0.5s' });
    var pbarLbl   = node('div', { style: 'color:#888;font-size:12px;margin-top:5px' }, 'Applying changes...');
    var progress  = node('div', { style: 'display:none' }, pbarOuter, pbar, pbarLbl);
    pbarOuter.appendChild(pbar);

    var spinner = node('div', { style: 'color:#888;font-size:12px;padding:4px 0' }, 'Please wait...');
    container.appendChild(spinner);
    container.appendChild(progress);

    var PHASE_PCT = { resetting: 20, starting: 50, mld_setup: 75, ready: 100 };
    var PHASE_LBL = { resetting: 'Stopping WiFi...', mld_setup: 'Enabling WiFi 7...', ready: 'Done' };
    function phaseLabel(phase, elapsed_s) {
        if (phase === 'starting') return elapsed_s > 15
            ? 'Starting interfaces, please wait...'
            : 'Starting interfaces...';
        return PHASE_LBL[phase] || 'Applying changes...';
    }

    fn().then(function(result) {
        spinner.style.display = 'none';
        if (!result.ok) {
            var msg = result.errors && result.errors.length ? result.errors.join('; ') : 'Failed';
            container.appendChild(inlineErr(msg));
            return;
        }

        var rr = result.restartRequired;

        if (rr === 'none') {
            container.appendChild(successBadge('Saved'));
            if (onDone) onDone();
            return;
        }

        progress.style.display = 'block';
        pbar.style.width = '10%';

        if (rr === 'reboot') {
            pbarLbl.textContent = 'Initiating reboot...';
            layer3.start_apply('reboot');
            setTimeout(function() { pbar.style.width = '100%'; pbarLbl.textContent = 'Rebooting — reconnect in ~60s'; }, 1500);
            return;
        }

        layer3.start_apply('wifi');
        if (lockFn) lockFn(false);

        var timer = setInterval(function() {
            layer3.poll_apply().then(function(pr) {
                if (!pr.ok || !pr.data) return;
                var d   = pr.data;
                var pct = PHASE_PCT[d.phase] || 10;
                pbar.style.width = pct + '%';
                pbarLbl.textContent = phaseLabel(d.phase, d.elapsed_s);
                if (d.ready) {
                    clearInterval(timer);
                    if (lockFn) lockFn(true);
                    setTimeout(function() {
                        progress.style.display = 'none';
                        container.appendChild(successBadge('Done'));
                        if (onDone) onDone();
                    }, 600);
                }
            });
        }, 3000);

        setTimeout(function() {
            clearInterval(timer);
            if (lockFn) lockFn(true);
            progress.style.display = 'none';
            container.appendChild(inlineErr('WiFi restart is taking longer than expected — check Networks tab. If nothing appeared, reboot.'));
        }, 240000);

    }).catch(function(e) {
        spinner.style.display = 'none';
        container.appendChild(inlineErr('Error: ' + String(e)));
    });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function openModal(title, build) {
    var overlay = node('div', {
        style: 'position:fixed;top:0;left:0;right:0;bottom:0;background:#000c;z-index:9999;display:flex;align-items:center;justify-content:center'
    });
    var canClose = true;
    function close() { if (canClose && overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    function setCloseable(v) {
        canClose = v;
        xBtn.style.color  = v ? '#555' : '#2a3a4a';
        xBtn.style.cursor = v ? 'pointer' : 'default';
    }

    var modal = node('div', {
        style: 'background:#111e30;border:1px solid #2a3a50;border-radius:8px;padding:20px 24px;' +
               'min-width:340px;max-width:520px;width:90vw;max-height:85vh;overflow-y:auto'
    });

    var hdr = node('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px' },
        node('div', { style: 'color:#ddd;font-weight:bold;font-size:14px' }, title));
    var xBtn = btn('✕', '#1a2a3a', close);
    xBtn.style.cssText = 'background:none;border:none;color:#555;font-size:16px;cursor:pointer;padding:0 4px';
    hdr.appendChild(xBtn);
    modal.appendChild(hdr);

    var body = node('div', {});
    build(body, close, setCloseable);
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return close;
}

return baseclass.extend({
    BANDS: BANDS,
    ENC_LABEL: ENC_LABEL,
    node: node,
    sp: sp,
    div: div,
    bandPill: bandPill,
    statusBadge: statusBadge,
    encLabel: encLabel,
    signalBars: signalBars,
    sigColor: sigColor,
    sigHistPush: sigHistPush,
    sigHistStats: sigHistStats,
    renderSignalHistory: renderSignalHistory,
    utilHistPush: utilHistPush,
    utilColor: utilColor,
    renderUtilHistory: renderUtilHistory,
    genBadge: genBadge,
    modeBadge: modeBadge,
    clientLinkBand: clientLinkBand,
    parseBitrate: parseBitrate,
    bestClientSignal: bestClientSignal,
    bestClientSpeed: bestClientSpeed,
    bestClientDetail: bestClientDetail,
    wpaLabel: wpaLabel,
    decodeMldLinks: decodeMldLinks,
    fmtMbps: fmtMbps,
    drawSparkline: drawSparkline,
    rssiMloPush: rssiMloPush,
    drawRssiSparkline: drawRssiSparkline,
    card: card,
    rowEl: rowEl,
    lbl: lbl,
    val: val,
    muted: muted,
    strong: strong,
    btn: btn,
    btnDanger: btnDanger,
    btnSecondary: btnSecondary,
    inputField: inputField,
    pwdWrap: pwdWrap,
    selectEl: selectEl,
    networkSel: networkSel,
    formRow: formRow,
    inlineErr: inlineErr,
    successBadge: successBadge,
    collapsible: collapsible,
    checkbox: checkbox,
    formatDuration: formatDuration,
    humanError: humanError,
    applyFlow: applyFlow,
    openModal: openModal
});
