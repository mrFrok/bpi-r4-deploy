// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/layer3 as layer3';

// Mesh tab — WDS-5G backhaul (controller/agent) + roaming daemon.
// Renders standalone; receives (meshData, mainData, onRefresh) from index.js.
// meshData = { roam: {running,pid,enabled,log}, backhaul: {role,peer_up,peer,peer_list,peers,ifname} }
// All actions go through layer3; no direct shell calls here.

// ── DOM HELPERS (mirror linkpolicy.js) ───────────────────────────────────────
function el(tag, attrs) {
    var e = E(tag, attrs || {});
    for (var i = 2; i < arguments.length; i++) {
        var c = arguments[i];
        if (c == null) continue;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
}
function sp(text, style) { return el('span', { style: style || '' }, text); }
function dot(on, color) {
    return el('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;' +
        'flex-shrink:0;background:' + (on ? (color || '#4caf50') : '#444') });
}
var CARD = 'padding:10px 12px;background:#0d1b2a;border:1px solid #1a2a3a;border-radius:4px;margin-bottom:16px';
var LABEL = 'color:#aaa;font-size:13px';

var _pendingReboot = false;   // set after a config change; persists across re-renders until reboot

// After a config-changing action: on error show it inline; on success set the
// persistent reboot flag and re-render (the reboot banner then survives poll refresh).
function afterConfigChange(box, res, onRefresh) {
    if (!res || !res.ok) {
        box.innerHTML = '';
        box.appendChild(sp('✗ ' + ((res && res.errors && res.errors.join('; ')) || 'failed'),
            'color:#e57373;font-size:12px'));
        return;
    }
    _pendingReboot = true;
    if (onRefresh) onRefresh();
}

// persistent reboot-required banner (rendered at top while _pendingReboot)
function rebootBanner() {
    var d = el('div', { style: 'padding:10px 12px;background:#2a1a0a;border:1px solid #5a3a1a;' +
        'border-radius:4px;margin-bottom:16px;display:flex;align-items:center;gap:10px' });
    d.appendChild(sp('⚠ Config saved — reboot required to apply (MLO stack).',
        'color:#f5a623;font-size:13px;font-weight:bold'));
    var rb = el('button', { style: 'margin-left:auto;border:1px solid #5a3a1a;background:#1a0f00;' +
        'color:#f5a623;padding:4px 16px;border-radius:3px;cursor:pointer;font-size:12px;font-weight:bold' },
        'Reboot now');
    rb.onclick = function() {
        rb.disabled = true; rb.textContent = 'Rebooting…';
        if (layer3.start_apply) layer3.start_apply('reboot');
    };
    d.appendChild(rb);
    return d;
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render(md, data, onRefresh) {
    var wrap = el('div', { style: 'padding:4px 0' });
    wrap.appendChild(el('div', { style: 'margin-bottom:16px' },
        sp('Mesh', 'color:#4caf7d;font-weight:bold;font-size:13px'),
        sp(' — WDS 5 GHz backhaul + roaming', 'color:#444;font-size:12px')
    ));

    if (_pendingReboot) wrap.appendChild(rebootBanner());   // persists across poll refresh

    if (!md) { wrap.appendChild(sp('Loading…', 'color:#555;font-size:13px')); return wrap; }

    var bh = md.backhaul || {};
    wrap.appendChild(renderStatus(bh));
    wrap.appendChild(renderSetup(bh, onRefresh));
    wrap.appendChild(renderPeers(bh));
    wrap.appendChild(renderRoaming(md.roam || {}, onRefresh));
    return wrap;
}

// Status: role + backhaul link up/down
function renderStatus(bh) {
    var role = bh.role || '';
    var roleLabel = role === 'controller' ? 'Controller' : role === 'agent' ? 'Agent' : 'Off';
    var roleColor = role ? '#4caf7d' : '#555';
    var d = el('div', { style: CARD + ';display:flex;align-items:center;gap:10px' });
    d.appendChild(sp('Role:', LABEL));
    d.appendChild(sp(roleLabel, 'font-size:13px;font-weight:bold;color:' + roleColor));
    if (role) {
        d.appendChild(sp('  ·  Backhaul:', LABEL + ';margin-left:8px'));
        d.appendChild(dot(bh.peer_up, '#4caf7d'));
        d.appendChild(sp(bh.peer_up ? 'up' : 'down',
            'font-size:13px;color:' + (bh.peer_up ? '#4caf7d' : '#777')));
        if (bh.ifname) d.appendChild(sp('(' + bh.ifname + ', 5 GHz)', 'color:#444;font-size:11px'));
    }
    return d;
}

// Setup: enable as controller/agent (when off) or disable (when active)
function renderSetup(bh, onRefresh) {
    var wrap = el('div', { style: 'margin-bottom:16px' });
    var msgBox = el('div', { style: 'margin-top:8px;min-height:16px' });

    if (bh.role) {
        var d = el('div', { style: CARD });
        d.appendChild(sp('Mesh is active as ' + bh.role + '. ', LABEL));
        var off = el('button', { style: 'border:1px solid #5a1a1a;background:none;color:#e57373;' +
            'padding:3px 12px;border-radius:3px;cursor:pointer;font-size:12px' }, 'Disable mesh');
        off.onclick = function() {
            off.disabled = true; off.textContent = 'Disabling…';
            layer3.wizard_mesh_disable().then(function(r) { afterConfigChange(msgBox, r, onRefresh); });
        };
        d.appendChild(off);
        wrap.appendChild(d);
        wrap.appendChild(msgBox);
        return wrap;
    }

    // off → two setup forms (controller / agent)
    wrap.appendChild(setupForm('Controller', 'Runs the mesh: backhaul + client network', false, onRefresh, msgBox));
    wrap.appendChild(setupForm('Agent', 'Extends the mesh: joins backhaul + serves clients', true, onRefresh, msgBox));
    wrap.appendChild(msgBox);
    return wrap;
}

function setupForm(title, hint, isAgent, onRefresh, msgBox) {
    var d = el('div', { style: CARD });
    d.appendChild(el('div', { style: 'margin-bottom:8px' },
        sp('Enable as ' + title, 'color:#4caf7d;font-weight:bold;font-size:12px'),
        sp('  ' + hint, 'color:#444;font-size:11px')));

    var iStyle = 'background:#060e18;border:1px solid #1a2a3a;color:#ccc;padding:4px 8px;' +
        'border-radius:3px;font-size:12px;margin-right:8px';

    // client mesh network (both roles) — one SSID clients roam across (2.4+6 GHz)
    var mSsid = el('input', { type: 'text', placeholder: 'Mesh network name (clients)', style: iStyle });
    var mKey  = el('input', { type: 'text', placeholder: 'Mesh password (≥8)', style: iStyle });
    // agent also joins the controller's backhaul (5 GHz)
    var bSsid = isAgent ? el('input', { type: 'text', placeholder: 'Controller backhaul SSID', style: iStyle }) : null;
    var bKey  = isAgent ? el('input', { type: 'text', placeholder: 'Backhaul key', style: iStyle }) : null;
    var bssid = isAgent ? el('input', { type: 'text', placeholder: 'Controller BSSID (optional)', style: iStyle }) : null;

    var row = el('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:6px' });
    if (isAgent) { row.appendChild(bSsid); row.appendChild(bKey); }
    row.appendChild(mSsid); row.appendChild(mKey);
    if (bssid) row.appendChild(bssid);

    var go = el('button', { style: 'border:1px solid #1a4a2a;background:none;color:#4caf7d;' +
        'padding:4px 14px;border-radius:3px;cursor:pointer;font-size:12px' }, 'Enable');
    // once a config change is pending reboot, keep the button locked across re-renders
    // so a stray second click can't re-run the wizard.
    if (_pendingReboot) { go.disabled = true; go.textContent = '⚠ Reboot required'; }
    go.onclick = function() {
        if (!mSsid.value || !mKey.value || (isAgent && (!bSsid.value || !bKey.value))) {
            afterConfigChange(msgBox, { ok: false, errors: ['Please fill in all fields first.'] }, onRefresh);
            return;
        }
        var params = { clientSsid: mSsid.value, clientKey: mKey.value };
        if (isAgent) {
            params.ssid = bSsid.value; params.key = bKey.value;
            if (bssid.value) params.bssid = bssid.value;
        }
        go.disabled = true; go.textContent = 'Applying…';
        var p = isAgent ? layer3.wizard_mesh_agent('radio1', params)
                        : layer3.wizard_mesh_controller('radio1', params);
        p.then(function(r) {
            if (r && r.ok) {
                // success → reboot required; keep locked so it can't be clicked twice
                go.textContent = '⚠ Reboot required';
            } else {
                // failure → let the user fix inputs and retry
                go.disabled = false; go.textContent = 'Enable';
            }
            afterConfigChange(msgBox, r, onRefresh);
        });
    };
    row.appendChild(go);
    d.appendChild(row);
    return d;
}

// Peers: controller → table of agents (N); agent → the controller
function renderPeers(bh) {
    if (!bh.role) return el('div', {});
    var wrap = el('div', { style: 'margin-bottom:16px' });

    if (bh.role === 'controller') {
        wrap.appendChild(sp('Connected agents (' + (bh.peers || 0) + ')',
            'color:#aaa;font-size:12px;font-weight:bold;display:block;margin-bottom:6px'));
        var list = bh.peer_list || [];
        if (!list.length) { wrap.appendChild(sp('No agents connected yet.', 'color:#444;font-size:12px')); return wrap; }
        var tbl = el('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
        tbl.appendChild(el('tr', { style: 'border-bottom:1px solid #1a2a3a' },
            el('td', { style: 'color:#555;padding:3px 8px;font-size:11px' }, 'Agent MAC'),
            el('td', { style: 'color:#555;padding:3px 8px;font-size:11px' }, 'Signal'),
            el('td', { style: 'color:#555;padding:3px 8px;font-size:11px' }, 'TX'),
            el('td', { style: 'color:#555;padding:3px 8px;font-size:11px' }, 'RX')));
        list.forEach(function(p) {
            tbl.appendChild(el('tr', { style: 'border-bottom:1px solid #0a1520' },
                el('td', { style: 'padding:5px 8px;color:#ccc;font-family:monospace;font-size:11px' }, p.mac || '—'),
                el('td', { style: 'padding:5px 8px;color:#aaa' }, p.signal != null ? p.signal + ' dBm' : '—'),
                el('td', { style: 'padding:5px 8px;color:#aaa' }, p.tx != null ? p.tx + ' Mbit/s' : '—'),
                el('td', { style: 'padding:5px 8px;color:#aaa' }, p.rx != null ? p.rx + ' Mbit/s' : '—')));
        });
        wrap.appendChild(tbl);
        return wrap;
    }

    // agent
    wrap.appendChild(sp('Controller', 'color:#aaa;font-size:12px;font-weight:bold;display:block;margin-bottom:6px'));
    var pr = bh.peer;
    if (!bh.peer_up || !pr) { wrap.appendChild(sp('Not connected to a controller.', 'color:#444;font-size:12px')); return wrap; }
    var g = el('div', { style: 'display:flex;gap:18px;font-size:12px;color:#aaa' });
    g.appendChild(sp('BSSID: ' + (pr.mac || '—')));
    g.appendChild(sp('Signal: ' + (pr.signal != null ? pr.signal + ' dBm' : '—')));
    g.appendChild(sp('TX: ' + (pr.tx != null ? pr.tx + ' Mbit/s' : '—')));
    g.appendChild(sp('RX: ' + (pr.rx != null ? pr.rx + ' Mbit/s' : '—')));
    wrap.appendChild(g);
    return wrap;
}

// Roaming daemon control
function renderRoaming(roam, onRefresh) {
    var d = el('div', { style: CARD + ';display:flex;align-items:center;gap:8px' });
    d.appendChild(dot(roam.running));
    d.appendChild(sp('Roaming (usteer): ', LABEL));
    d.appendChild(sp(roam.running ? ('running — PID ' + roam.pid) : 'stopped',
        'font-size:13px;color:' + (roam.running ? '#4caf50' : '#555')));
    if (roam.enabled != null)
        d.appendChild(sp(roam.enabled ? '(on boot)' : '(not on boot)', 'color:#444;font-size:11px'));
    var btn = el('button', { style: 'margin-left:auto;border:1px solid #1a4a2a;background:none;' +
        'color:#4caf7d;padding:3px 12px;border-radius:3px;cursor:pointer;font-size:12px' },
        roam.running ? 'Stop' : 'Start');
    btn.onclick = function() {
        btn.disabled = true; btn.textContent = roam.running ? 'Stopping…' : 'Starting…';
        (roam.running ? layer3.roam_stop() : layer3.roam_start()).then(function() {
            if (onRefresh) onRefresh();
        });
    };
    d.appendChild(btn);
    return d;
}

// ── MODULE EXPORT ─────────────────────────────────────────────────────────────
return baseclass.extend({ render: render });
