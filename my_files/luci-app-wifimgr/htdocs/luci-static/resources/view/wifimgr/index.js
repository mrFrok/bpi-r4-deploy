// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require view';
'require poll';
'require wifimgr/layer2 as layer2';
'require wifimgr/layer3 as layer3';
'require wifimgr/linkpolicy as linkpolicy';
'require wifimgr/mesh as mesh';

'require wifimgr/ui as ui';
'require wifimgr/diagnostics as diagnostics';
'require wifimgr/clients as clients';
'require wifimgr/wizards as wizards';
'require wifimgr/networks as networks';
'require wifimgr/radios as radios';

// -- MODE --
function getMode()  { return localStorage.getItem('wifimgr_mode') || 'basic'; }
function isAdv()    { return true; }
function setMode(m) { localStorage.setItem('wifimgr_mode', m); }

// -- MODULE-LEVEL STATE --
var _data           = null;
var _diag           = null;
var _diagTs         = 0;
var _tab            = 'networks';
var _tabContainers  = {};
var _tabNavBtns     = {};
var _onApplied      = null;
var _netExpandState = {}; // sid -> {expanded, editMode}
var _lastFormTouch  = 0;
var _steerdData     = null;
var _meshData       = null;

// -- STATIC TAB LIST --
var TAB_DEFS = [
    { id: 'networks',    label: 'Networks' },
    { id: 'radios',      label: 'Radios' },
    { id: 'clients',     label: 'Clients' },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'link-policy', label: 'Link Policy' },
    { id: 'mesh',        label: 'Mesh' }
];

// -- SHARED HELPERS (defined in ui.js; re-bound so call-sites stay unchanged) --
var BANDS = ui.BANDS, ENC_LABEL = ui.ENC_LABEL, node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, statusBadge = ui.statusBadge, encLabel = ui.encLabel, signalBars = ui.signalBars, sigColor = ui.sigColor, sigHistPush = ui.sigHistPush, sigHistStats = ui.sigHistStats, renderSignalHistory = ui.renderSignalHistory, utilHistPush = ui.utilHistPush, utilColor = ui.utilColor, renderUtilHistory = ui.renderUtilHistory, genBadge = ui.genBadge, modeBadge = ui.modeBadge, clientLinkBand = ui.clientLinkBand, parseBitrate = ui.parseBitrate, bestClientSignal = ui.bestClientSignal, bestClientSpeed = ui.bestClientSpeed, bestClientDetail = ui.bestClientDetail, wpaLabel = ui.wpaLabel, decodeMldLinks = ui.decodeMldLinks, fmtMbps = ui.fmtMbps, drawSparkline = ui.drawSparkline, rssiMloPush = ui.rssiMloPush, drawRssiSparkline = ui.drawRssiSparkline, card = ui.card, rowEl = ui.rowEl, lbl = ui.lbl, val = ui.val, muted = ui.muted, strong = ui.strong, btn = ui.btn, btnDanger = ui.btnDanger, btnSecondary = ui.btnSecondary, inputField = ui.inputField, pwdWrap = ui.pwdWrap, selectEl = ui.selectEl, networkSel = ui.networkSel, formRow = ui.formRow, inlineErr = ui.inlineErr, successBadge = ui.successBadge, collapsible = ui.collapsible, checkbox = ui.checkbox, formatDuration = ui.formatDuration, humanError = ui.humanError, applyFlow = ui.applyFlow, openModal = ui.openModal;

// ── WIZARDS ───────────────────────────────────────────────────────────────────

// ── NETWORKS TAB ──────────────────────────────────────────────────────────────

// ── TAB MANAGEMENT ────────────────────────────────────────────────────────────

// tabDefs replaced by static TAB_DEFS constant defined in module state section

function loadSteerd() {
    layer3.load_steerd(_data ? _data.clients : []).then(function(d) {
        _steerdData = d;
        if (_tab === 'link-policy') refreshTab('link-policy');
    });
}

function loadMesh() {
    Promise.all([
        layer3.load_roam(),
        layer3.backhaul_status()
    ]).then(function(res) {
        _meshData = { roam: res[0], backhaul: (res[1] && res[1].ok) ? res[1].data : {} };
        // don't clobber a setup form the user is typing into (poll re-render)
        var ae = document.activeElement;
        var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT');
        if (_tab === 'mesh' && !typing) refreshTab('mesh');
    });
}

function renderTab(id, data) {
    switch (id) {
        case 'networks':    return networks.render(data, _onApplied, _netExpandState);
        case 'radios':      return radios.render(data, _onApplied);
        case 'clients':     return clients.render(data);
        case 'diagnostics': return diagnostics.render(_diag, _data);
        case 'link-policy': return linkpolicy.render(_steerdData, data, loadSteerd);
        case 'mesh':        return mesh.render(_meshData, data, loadMesh);
    }
    return node('div', {});
}

function activateTab(id) {
    _tab = id;
    Object.keys(_tabNavBtns).forEach(function(k) {
        var active = k === id;
        _tabNavBtns[k].style.borderBottom = active ? '2px solid #5b9bd5' : '2px solid transparent';
        _tabNavBtns[k].style.color        = active ? '#ddd' : '#666';
    });
    Object.keys(_tabContainers).forEach(function(k) {
        _tabContainers[k].style.display = k === id ? 'block' : 'none';
    });
    if (id === 'diagnostics' && !_diag) loadDiag();
    if (id === 'mesh' && !_meshData) loadMesh();
}

function refreshNav(data) {
    var hasMloAp = ((data && data.mlds) || []).some(function(m) { return m.mode === 'ap'; });
    var lpBtn = _tabNavBtns['link-policy'];
    if (lpBtn) lpBtn.style.display = hasMloAp ? '' : 'none';
    if (_tab === 'link-policy' && !hasMloAp) activateTab('networks');
    if (!TAB_DEFS.some(function(t) { return t.id === _tab; })) activateTab('networks');
}

function refreshTab(id) {
    var container = _tabContainers[id];
    if (!container) return;
    var newEl = renderTab(id, _data);
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(newEl);
}

function refreshAll() {
    refreshNav(_data);
    Object.keys(_tabContainers).forEach(function(id) { refreshTab(id); });
}

function loadDiag() {
    layer3.load_diag().then(function(d) {
        _diag  = d;
        _diagTs = Date.now();
        refreshTab('diagnostics');
    });
}

// ── MAIN VIEW ─────────────────────────────────────────────────────────────────

return view.extend({
    load: function() {
        return layer3.load_all();
    },

    render: function(data) {
        _data          = data;
        _diag          = null;
        _diagTs        = 0;
        _tabContainers = {};
        _tabNavBtns    = {};
        _tab           = 'networks';

        _onApplied = function() {
            _lastFormTouch = 0;
            layer3.load_all().then(function(d) { _data = d; refreshAll(); });
        };

        document.addEventListener('change', function() { _lastFormTouch = Date.now(); }, true);
        document.addEventListener('input',  function() { _lastFormTouch = Date.now(); }, true);

        // ── Top bar ──
        var topBar = node('div', { style: 'padding:8px 0 12px;display:flex;align-items:baseline;justify-content:space-between' });
        topBar.appendChild(sp('WiFi Manager', 'color:#ddd;font-weight:bold;font-size:15px'));
        topBar.appendChild(sp('v@@PKG_VERSION@@', 'color:#444;font-size:11px'));

        // ── Tab nav ──
        var tabNav = node('div', { style: 'display:flex;border-bottom:1px solid #1a2a3a;margin-bottom:16px;overflow-x:auto' });
        TAB_DEFS.forEach(function(t) {
            var tb = node('button', {
                style: 'background:none;border:none;border-bottom:2px solid transparent;color:#666;' +
                       'padding:8px 14px;cursor:pointer;font-size:13px;white-space:nowrap'
            }, t.label);
            tb.onclick = function() { activateTab(t.id); };
            _tabNavBtns[t.id] = tb;
            tabNav.appendChild(tb);
        });

        // ── Tab content ──
        var content = node('div', {});
        TAB_DEFS.forEach(function(t) {
            var container = node('div', { style: 'display:none' });
            container.appendChild(renderTab(t.id, data));
            _tabContainers[t.id] = container;
            content.appendChild(container);
        });

        activateTab('networks');

        // ── Page ──
        var page = node('div', { style: 'color:#ddd;font-family:sans-serif;max-width:960px' },
            topBar, tabNav, content);

        // ── Poll ──
        poll.add(function() {
            return layer3.load_all().then(function(d) {
                _data = d;
                (d.radios || []).forEach(function(r) {
                    if (r.up) utilHistPush(r.id, r.chan_util != null ? Math.min(r.chan_util, 100) : null);
                });
                var editing = (_tab === 'networks' &&
                    Object.keys(_netExpandState).some(function(k) { return _netExpandState[k].editMode; })) ||
                    (Date.now() - _lastFormTouch < 15000);
                if (!editing) refreshTab(_tab);
                if (_tab === 'diagnostics' && (_diagTs === 0 || Date.now() - _diagTs > 30000)) loadDiag();
                if (_tab === 'link-policy') loadSteerd();
                if (_tab === 'mesh') loadMesh();
            });
        }, 10);

        return page;
    },

    handleSave:        null,
    handleSaveApply:   null,
    handleReset:       null
});
