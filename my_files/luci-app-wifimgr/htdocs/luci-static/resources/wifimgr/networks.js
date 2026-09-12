// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/ui as ui';
'require wifimgr/layer2 as layer2';
'require wifimgr/wizards as wizards';

// Networks tab: per-network rows (netRow) with inline edit, MLO grouping,
// add-network menu, country. render(data, onApplied, expandState):
// onApplied = apply callback; expandState = shared row expand/edit state.

var node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, encLabel = ui.encLabel, signalBars = ui.signalBars, sigColor = ui.sigColor, sigHistPush = ui.sigHistPush, renderSignalHistory = ui.renderSignalHistory, genBadge = ui.genBadge, parseBitrate = ui.parseBitrate, wpaLabel = ui.wpaLabel, decodeMldLinks = ui.decodeMldLinks, rssiMloPush = ui.rssiMloPush, drawRssiSparkline = ui.drawRssiSparkline, lbl = ui.lbl, val = ui.val, muted = ui.muted, btn = ui.btn, btnDanger = ui.btnDanger, btnSecondary = ui.btnSecondary, inputField = ui.inputField, pwdWrap = ui.pwdWrap, selectEl = ui.selectEl, networkSel = ui.networkSel, formRow = ui.formRow, checkbox = ui.checkbox, applyFlow = ui.applyFlow;

function render(data, onApplied, expandState) {
    var mlds    = data.mlds    || [];
    var ifaces  = data.ifaces  || [];
    var clients = data.clients || [];
    var radios  = data.radios  || [];
    var el      = node('div', {});

    // Client count per ifname
    var cliCount = {};
    clients.forEach(function(c) { if (c.ifname) cliCount[c.ifname] = (cliCount[c.ifname] || 0) + 1; });

    // Country from first radio
    var country = radios.length ? (radios[0].country || '—') : '—';

    // ── Top bar ──
    var hdr = node('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px' });
    hdr.appendChild(sp('Networks', 'color:#ddd;font-weight:bold;font-size:14px'));

    var ddWrap = node('div', { style: 'position:relative' });
    var ddBtn  = node('button', {
        style: 'padding:5px 14px;background:#185fa5;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px'
    }, 'Add network ▾');
    var ddMenu = node('div', {
        style: 'display:none;position:absolute;right:0;top:calc(100% + 4px);background:#111e30;' +
               'border:1px solid #2a3a50;border-radius:6px;z-index:100;min-width:180px;overflow:hidden'
    });
    [
        ['Access point',       function() { wizards.wizardAP(onApplied, data); }],
        ['Access point (MLO)', function() { wizards.wizardMLO(onApplied, data); }],
        ['Station',            function() { wizards.wizardStation(onApplied, data); }],
        ['WDS / Bridge',       function() { wizards.wizardWDS(onApplied, data); }],
        ['Repeater',           function() { wizards.wizardRepeater(onApplied, data); }]
    ].forEach(function(item) {
        var row = node('div', { style: 'padding:9px 14px;cursor:pointer;color:#ccc;font-size:13px' }, item[0]);
        row.onmouseenter = function() { row.style.background = '#1a2a3a'; };
        row.onmouseleave = function() { row.style.background = ''; };
        row.onclick = function(e) { e.stopPropagation(); ddMenu.style.display = 'none'; item[1](); };
        ddMenu.appendChild(row);
    });
    ddBtn.onclick = function(e) {
        e.stopPropagation();
        ddMenu.style.display = ddMenu.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', function() { ddMenu.style.display = 'none'; }, { once: true });
    ddWrap.appendChild(ddBtn);
    ddWrap.appendChild(ddMenu);
    var topBtns = node('div', { style: 'display:flex;gap:8px;align-items:center' },
        btnSecondary('Scan nearby', function() { wizards.openScanNearby(data); }),
        ddWrap
    );
    hdr.appendChild(topBtns);
    el.appendChild(hdr);

    // ── Network list ──
    var allNets = [];
    mlds.forEach(function(m) { allNets.push({ type: m.mode === 'sta' ? 'MLO STA' : 'MLO AP', iface: m }); });
    ifaces.filter(function(i) { return !i.mlo; }).forEach(function(i) {
        allNets.push({ type: i.mode === 'ap' ? 'AP' : 'STA', iface: i });
    });

    var list = node('div', { style: 'border:1px solid #1a2a3a;border-radius:6px;overflow:hidden' });
    if (!allNets.length) {
        list.appendChild(node('div', { style: 'color:#555;padding:24px;font-size:14px;text-align:center' }, 'No networks configured.'));
    }
    allNets.forEach(function(net, idx) {
        list.appendChild(netRow(net.type, net.iface, data, cliCount, country, idx === allNets.length - 1, onApplied, expandState));
    });
    el.appendChild(list);
    return el;
}

function netRow(type, iface, data, cliCount, country, isLast, onApplied, expandState) {
    var sid    = iface.sid;
    var ssid   = iface.ssid || '(no SSID)';
    var enc    = iface.encryption || 'none';
    var is_mld = (type === 'MLO AP' || type === 'MLO STA');
    var rids   = is_mld
        ? (iface.radios || [])
        : (Array.isArray(iface.device) ? iface.device : [iface.device].filter(Boolean));
    var status = is_mld
        ? (iface.links && iface.links.length ? 'ENABLED' : 'DOWN')
        : (iface.status || 'DISABLED');
    var isUp   = status === 'ENABLED' || status === 'UP';
    var nCli   = (type !== 'STA' && iface.ifname) ? (cliCount[iface.ifname] || 0) : 0;

    var expanded = (expandState[sid] && expandState[sid].expanded) || false;
    var editMode = (expandState[sid] && expandState[sid].editMode) || false;
    var applyDiv = node('div', {});

    var wrapper = node('div', { style: isLast ? '' : 'border-bottom:1px solid #1a2a3a' });

    // ── Collapsed row ──
    var row = node('div', { style: 'display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer' });
    row.onmouseenter = function() { row.style.background = '#1a2535'; };
    row.onmouseleave = function() { row.style.background = ''; };

    var isAmber = status === 'INIT_FAILED' || status === 'SCANNING' ||
                  (status === 'DISCONNECTED' && iface.mode === 'sta');
    var dotColor = isUp ? '#1d9e75' : isAmber ? '#f5a623' : '#444';
    row.appendChild(sp('●', 'color:' + dotColor + ';font-size:10px;flex-shrink:0'));

    var nameWrap = node('div', { style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden' });
    nameWrap.appendChild(sp(ssid, 'color:#ddd;font-weight:bold;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    nameWrap.appendChild(sp(type, 'font-size:11px;padding:1px 6px;background:#1a2a3a;color:#888;border-radius:3px;flex-shrink:0'));
    if (iface.wds) nameWrap.appendChild(sp('WDS', 'font-size:11px;padding:1px 6px;background:#1a2a3a;color:#f5a623;border-radius:3px;flex-shrink:0'));
    if (iface.repeater) {
        var _repPeer = (data.ifaces || []).find(function(i) { return i.repeater && i !== iface; });
        var _repLabel = iface.mode === 'sta'
            ? (_repPeer ? '→ ' + _repPeer.ssid : 'repeater uplink')
            : (_repPeer ? '← ' + _repPeer.ssid : 'repeater AP');
        nameWrap.appendChild(sp(_repLabel, 'font-size:11px;padding:1px 6px;background:#1a2a3a;color:#81c784;border-radius:3px;flex-shrink:0'));
    }
    if (data.relayd && data.relayd.active && iface.network && iface.network === data.relayd.uplink_net)
        nameWrap.appendChild(sp('relayd', 'font-size:11px;padding:1px 6px;background:#1a2a3a;color:#4fc3f7;border-radius:3px;flex-shrink:0'));
    var _gbEl = (function() {
        if (is_mld) return genBadge('EHT');
        var _rid = Array.isArray(iface.device) ? iface.device[0] : iface.device;
        var _r = (_rid && data.radios) ? data.radios.find(function(r) { return r.id === _rid; }) : null;
        return (_r && _r.htmode) ? genBadge(_r.htmode) : null;
    })();
    if (_gbEl) nameWrap.appendChild(_gbEl);
    row.appendChild(nameWrap);

    var meta = node('div', { style: 'display:flex;align-items:center;gap:5px;flex-shrink:0' });
    rids.forEach(function(rid) { meta.appendChild(bandPill(rid)); });
    meta.appendChild(muted(encLabel(enc)));
    if (nCli > 0) meta.appendChild(muted(' · ' + nCli + (nCli === 1 ? ' client' : ' clients')));
    row.appendChild(meta);

    var editBtn = btn('Edit', '#1e2a3a', function(e) {
        e.stopPropagation();
        expanded = true; editMode = true; refresh();
    });
    editBtn.style.cssText += ';padding:3px 10px;font-size:12px;flex-shrink:0';

    var removeBtn = btnDanger('✕', function(e) {
        e.stopPropagation();
        var warn = is_mld
            ? 'Remove "' + ssid + '"? All clients on all bands will disconnect.'
            : 'Remove "' + ssid + '"?';
        if (!confirm(warn)) return;
        delete expandState[sid];
        applyFlow(applyDiv, function() {
            var isRelaydUplink = !is_mld && data.relayd && data.relayd.active &&
                iface.network && iface.network === data.relayd.uplink_net;
            var isRepeaterSta = !is_mld && iface.repeater && iface.mode === 'sta';
            var prom = is_mld ? layer2.mld_remove(sid) : layer2.iface_remove(sid);
            if (isRelaydUplink) prom = prom.then(function() { return layer2.relayd_remove(); });
            if (isRepeaterSta) prom = prom.then(function() { return layer2.repeater_fw_remove(); });
            return prom.then(function(r) { return Object.assign({ restartRequired: 'reboot' }, r); });
        }, onApplied);
    });
    removeBtn.style.cssText += ';padding:3px 8px;font-size:12px;flex-shrink:0';

    row.appendChild(editBtn);
    row.appendChild(removeBtn);

    var chevron = sp('▼', 'color:#555;font-size:10px;flex-shrink:0');
    row.appendChild(chevron);

    row.onclick = function() { expanded = !expanded; if (!expanded) editMode = false; refresh(); };

    // ── Detail panel ──
    var panel = node('div', { style: 'display:none;background:#0d1520;padding:12px 14px;border-top:1px solid #1a2a3a' });

    function refresh() {
        if (expanded) { expandState[sid] = { expanded: true, editMode: editMode }; }
        else          { delete expandState[sid]; }
        chevron.textContent = expanded ? '▲' : '▼';
        panel.style.display = expanded ? 'block' : 'none';
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        if (expanded) panel.appendChild(editMode ? buildEditForm() : buildDetail());
    }

    function kvGrid(items) {
        var g = node('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;margin-bottom:10px' });
        items.forEach(function(it) {
            if (!it) { g.appendChild(node('div', {})); return; }
            var cell = node('div', {});
            cell.appendChild(lbl(it[0]));
            if (it[1] && it[1].nodeType) {
                cell.appendChild(it[1]);
            } else {
                cell.appendChild(node('div', { style: 'color:#ddd;font-size:13px;margin-top:2px' }, String(it[1] == null ? '—' : it[1])));
            }
            g.appendChild(cell);
        });
        return g;
    }

    function buildDetail() {
        var b = node('div', {});

        function addConnStatus(container, uplink, noiseVal) {
            var _ulIfname = uplink.ifname;
            container.appendChild(sp('Connection', 'display:block;color:#88888899;font-size:11px;font-weight:bold;letter-spacing:0.5px;margin:10px 0 6px'));
            var _stateEl = node('div', { style: 'color:#ddd;font-size:13px;margin-top:2px' }, wpaLabel(uplink.wpa_state));
            var _sigEl   = node('div', { style: 'margin-top:2px' });
            _sigEl.appendChild(signalBars(uplink.signal));
            var _txRxEl  = node('div', { style: 'color:#ddd;font-size:13px;margin-top:2px' });
            (function() {
                var txP = parseBitrate(uplink.tx_bitrate), rxP = parseBitrate(uplink.rx_bitrate);
                _txRxEl.textContent = (txP ? txP.speed : (uplink.tx_bitrate || '—')) + ' / ' +
                                      (rxP ? rxP.speed : (uplink.rx_bitrate || '—'));
            })();
            var connItems = [
                ['State',      _stateEl],
                ['BSSID',      uplink.bssid      || '—'],
                ['IP address', uplink.ip_address || '—'],
                ['Signal',     _sigEl],
                ['TX / RX',    _txRxEl],
                ['WiFi gen.',  uplink.wifi_generation ? 'WiFi ' + uplink.wifi_generation : '—'],
            ];
            if (noiseVal != null) connItems.push(['Noise floor', noiseVal + ' dBm'], null, null);
            container.appendChild(kvGrid(connItems));
            container.appendChild(sp('Signal history', 'display:block;color:#88888899;font-size:11px;font-weight:bold;letter-spacing:0.5px;margin:10px 0 4px'));
            var _sparkEl = node('div', { style: 'font-family:monospace;font-size:16px;letter-spacing:2px;line-height:1.4' });
            var _statsEl = node('div', { style: 'color:#555;font-size:11px;margin-top:3px' });
            sigHistPush(_ulIfname, uplink.signal);
            renderSignalHistory(_ulIfname, _sparkEl, _statsEl);
            container.appendChild(_sparkEl);
            container.appendChild(_statsEl);
            var _linkCells = {}, _rssiCanvas = null;
            if (uplink.is_mlo && uplink.links && uplink.links.length) {
                container.appendChild(sp('Per-link (WiFi 7)', 'display:block;color:#88888899;font-size:11px;font-weight:bold;letter-spacing:0.5px;margin:10px 0 4px'));
                var ltbl = node('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
                var lhead = node('tr', { style: 'color:#555' });
                ['Link','Freq','BW','Signal','TX','RX'].forEach(function(h) {
                    lhead.appendChild(node('th', { style: 'text-align:left;padding:2px 6px;font-weight:normal' }, h));
                });
                ltbl.appendChild(lhead);
                uplink.links.forEach(function(lk) {
                    var tr = node('tr', { style: 'color:#aaa' });
                    var tdStyle = 'padding:3px 6px';
                    [String(lk.link_id),
                     lk.freq   ? lk.freq + ' MHz' : '—',
                     lk.bw_mhz ? lk.bw_mhz + ' MHz' : '—',
                    ].forEach(function(v) { tr.appendChild(node('td', { style: tdStyle }, v)); });
                    var sigTd = node('td', { style: tdStyle }, lk.signal != null ? lk.signal + ' dBm' : '—');
                    var txTd  = node('td', { style: tdStyle }, lk.tx_bitrate || '—');
                    var rxTd  = node('td', { style: tdStyle }, lk.rx_bitrate || '—');
                    tr.appendChild(sigTd); tr.appendChild(txTd); tr.appendChild(rxTd);
                    _linkCells[lk.link_id] = { sig: sigTd, tx: txTd, rx: rxTd };
                    ltbl.appendChild(tr);
                });
                container.appendChild(ltbl);
                container.appendChild(sp('Signal history per link', 'display:block;color:#88888899;font-size:11px;font-weight:bold;letter-spacing:0.5px;margin:10px 0 4px'));
                _rssiCanvas = node('canvas', { width: '240', height: '40', style: 'display:block;border-radius:3px' });
                var _rssiLegend = node('div', { style: 'display:flex;gap:10px;margin-top:3px' });
                uplink.links.forEach(function(lk) {
                    var freq = lk.freq || 0;
                    var bandLabel = freq < 3000 ? '2.4G' : freq < 5950 ? '5G' : '6G';
                    var color = freq < 3000 ? '#5b9bd5' : freq < 5950 ? '#4caf7d' : '#f5a623';
                    _rssiLegend.appendChild(sp('— ' + bandLabel, 'font-size:11px;color:' + color + ';font-family:monospace'));
                });
                rssiMloPush(_ulIfname, uplink.links);
                drawRssiSparkline(_rssiCanvas, _ulIfname, uplink.links);
                container.appendChild(_rssiCanvas);
                container.appendChild(_rssiLegend);
            }
            var _pollTimer = setInterval(function() {
                if (!_sparkEl.isConnected) { clearInterval(_pollTimer); return; }
                layer2.uplink_get_status(_ulIfname).then(function(res) {
                    if (!_sparkEl.isConnected) { clearInterval(_pollTimer); return; }
                    if (!res.ok) return;
                    var st = res.data;
                    sigHistPush(_ulIfname, st.signal);
                    _stateEl.textContent = wpaLabel(st.wpa_state);
                    while (_sigEl.firstChild) _sigEl.removeChild(_sigEl.firstChild);
                    _sigEl.appendChild(signalBars(st.signal));
                    var txP = parseBitrate(st.tx_bitrate), rxP = parseBitrate(st.rx_bitrate);
                    _txRxEl.textContent = (txP ? txP.speed : (st.tx_bitrate || '—')) + ' / ' +
                                          (rxP ? rxP.speed : (st.rx_bitrate || '—'));
                    renderSignalHistory(_ulIfname, _sparkEl, _statsEl);
                    if (st.links && st.links.length) {
                        rssiMloPush(_ulIfname, st.links);
                        if (_rssiCanvas) drawRssiSparkline(_rssiCanvas, _ulIfname, st.links);
                        st.links.forEach(function(lk) {
                            var cells = _linkCells[lk.link_id];
                            if (!cells) return;
                            cells.sig.textContent = lk.signal != null ? lk.signal + ' dBm' : '—';
                            cells.tx.textContent  = lk.tx_bitrate || '—';
                            cells.rx.textContent  = lk.rx_bitrate || '—';
                        });
                    }
                });
            }, 5000);
        }

        if (is_mld) {
            // For STA mode: find uplink early (needed for ap_mld_addr)
            var mloUplink = iface.mode === 'sta'
                ? (data.uplinks || []).find(function(u) { return u.sid === sid; }) || null
                : null;

            var _mldAddr = iface.mld_addr
                || (mloUplink && mloUplink.ap_mld_addr)
                || null;

            // Config fields — add new fields here
            var cfgItems = [
                ['SSID',           ssid],
                ['Encryption',     encLabel(enc)],
                ['Interface',      iface.ifname  || '—'],
                ['Network (L3)',   iface.network || '—'],
                iface.mode !== 'sta' ? ['IP address', iface.ip_address || '—'] : null,
                ['MLD address',    _mldAddr || '—'],
                ['Isolate clients',iface.isolate ? 'Yes' : 'No'],
                ['Allowed links',  decodeMldLinks(iface.mld_allowed_links)],
                ['EML disabled',   iface.eml_disable ? 'Yes' : 'No'],
                ['Country',        country],
            ];
            b.appendChild(kvGrid(cfgItems));

            // Per-link table — columns differ for STA vs AP
            var links = iface.links || [];
            if (links.length) {
                b.appendChild(sp('Links', 'display:block;color:#88888899;font-size:11px;font-weight:bold;letter-spacing:0.5px;margin:10px 0 6px'));
                var tbl = node('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
                var thead = node('tr', { style: 'color:#555' });
                var isSta = iface.mode === 'sta';
                (isSta ? ['Link','Freq','CH','BW','Signal'] : ['Link','Freq','CH','BW','TX','DFS','Util']).forEach(function(h) {
                    thead.appendChild(node('th', { style: 'text-align:left;padding:2px 8px;font-weight:normal' }, h));
                });
                tbl.appendChild(thead);
                links.forEach(function(lk) {
                    var tr = node('tr', { style: 'color:#aaa' });
                    var cells;
                    if (isSta) {
                        var sigStr = lk.signal != null ? lk.signal + ' dBm' : '—';
                        var sigColor = lk.signal != null ? (lk.signal >= -65 ? '#1d9e75' : lk.signal >= -75 ? '#f5a623' : '#e24b4a') : '#444';
                        cells = [String(lk.link_id),
                            lk.freq    ? lk.freq    + ' MHz' : '—',
                            lk.channel ? String(lk.channel) : '—',
                            lk.bw_mhz  ? lk.bw_mhz  + ' MHz' : '—',
                        ];
                        cells.forEach(function(v) { tr.appendChild(node('td', { style: 'padding:3px 8px' }, v)); });
                        tr.appendChild(node('td', { style: 'padding:3px 8px;color:' + sigColor }, sigStr));
                    } else {
                        [String(lk.link_id),
                         lk.freq    ? lk.freq    + ' MHz' : '—',
                         lk.channel ? String(lk.channel) : '—',
                         lk.bw_mhz  ? lk.bw_mhz  + ' MHz' : '—',
                         lk.txpower != null ? lk.txpower + ' dBm' : '—',
                         lk.dfs_active ? 'CAC' : '—',
                         lk.chan_util != null ? Math.min(lk.chan_util, 100) + '%' : 'n/a',
                        ].forEach(function(v) { tr.appendChild(node('td', { style: 'padding:3px 8px' }, v)); });
                    }
                    tbl.appendChild(tr);
                });
                b.appendChild(tbl);
            }

            if (iface.mode === 'sta' && mloUplink) {
                addConnStatus(b, mloUplink, null);
            }

        } else if (iface.mode === 'ap') {
            var radio = rids.length ? (data.radios || []).find(function(r) { return r.id === rids[0]; }) : null;
            // Config + runtime fields — add new fields here
            var apItems = [
                ['SSID',             ssid],
                ['Encryption',       encLabel(enc)],
                ['Interface',        iface.ifname  || '—'],
                ['Network (L3)',     iface.network || '—'],
                ['Hidden SSID',      iface.hidden  ? 'Yes' : 'No'],
                ['Isolate clients',  iface.isolate ? 'Yes' : 'No'],
                ['Max stations',     iface.maxassoc != null ? String(iface.maxassoc) : '—'],
                null, null,
                ['Channel',  radio ? (radio.channel ? String(radio.channel) : 'auto') : '—'],
                ['Width',    radio ? (radio.htmode || '—') : '—'],
                ['TX power', radio && radio.txpower_actual != null ? radio.txpower_actual + ' dBm' : '—'],
            ];
            b.appendChild(kvGrid(apItems));

        } else {
            // STA config fields — add new fields here
            var staItems = [
                ['SSID',         ssid],
                ['Encryption',   encLabel(enc)],
                ['Interface',    iface.ifname  || '—'],
                ['Network (L3)', iface.network || '—'],
            ];
            b.appendChild(kvGrid(staItems));

            // Uplink connection status (live-updating)
            var uplink = (data.uplinks || []).find(function(u) { return u.sid === sid; });
            if (uplink) {
                var _staRid   = iface.device ? (Array.isArray(iface.device) ? iface.device[0] : iface.device) : null;
                var _staRadio = (_staRid && data.radios) ? data.radios.find(function(r) { return r.id === _staRid; }) : null;
                var _staNoise = _staRadio && _staRadio.noise != null ? _staRadio.noise : null;
                addConnStatus(b, uplink, _staNoise);
            }
        }

        var btnBar = node('div', { style: 'display:flex;gap:8px;margin-top:10px' });
        btnBar.appendChild(btn('Edit', null, function() { editMode = true; refresh(); }));
        btnBar.appendChild(btnDanger('Remove', function() {
            var warn = is_mld
                ? 'Remove "' + ssid + '"? All clients on all bands will disconnect.'
                : 'Remove "' + ssid + '"?';
            if (!confirm(warn)) return;
            applyFlow(applyDiv, function() {
                var isRelaydUplink = !is_mld && data.relayd && data.relayd.active &&
                    iface.network && iface.network === data.relayd.uplink_net;
                var isRepeaterSta = !is_mld && iface.repeater && iface.mode === 'sta';
                var prom = is_mld ? layer2.mld_remove(sid) : layer2.iface_remove(sid);
                if (isRelaydUplink) prom = prom.then(function() { return layer2.relayd_remove(); });
                if (isRepeaterSta) prom = prom.then(function() { return layer2.repeater_fw_remove(); });
                return prom.then(function(r) { return Object.assign({ restartRequired: 'reboot' }, r); });
            }, onApplied);
        }));
        b.appendChild(btnBar);
        return b;
    }

    function buildEditForm() {
        // Field definitions — add new editable fields here (one line each).
        // types: text | number | password | select | checkbox
        var defs;
        if (is_mld) {
            defs = [
                { label: 'SSID',             key: 'ssid',       type: 'text',     val: ssid },
                { label: 'Password',         key: 'key',        type: 'password', val: iface.key || '' },
                { label: 'Security',         key: 'encryption', type: 'select',   opts: [['sae','WPA3'],['sae-mixed','WPA2/WPA3'],['owe','OWE']], val: enc },
                { label: 'Network',          key: 'network',    type: 'network',  val: iface.network || 'lan' },
                { label: 'Client isolation', key: 'isolate',    type: 'checkbox', val: iface.isolate },
            ];
        } else if (iface.mode === 'ap') {
            var apRadio = rids.length ? (data.radios || []).find(function(r) { return r.id === rids[0]; }) : null;
            var apBand  = apRadio ? apRadio.id : 'radio1';
            var apHtOpts = apBand === 'radio2'
                ? [['EHT320','320 MHz'],['EHT160','160 MHz'],['EHT80','80 MHz'],['EHT40','40 MHz'],['EHT20','20 MHz']]
                : apBand === 'radio1'
                    ? [['EHT160','160 MHz'],['EHT80','80 MHz'],['EHT40','40 MHz'],['EHT20','20 MHz'],['VHT160','160 MHz (VHT)']]
                    : [['EHT40','40 MHz'],['EHT20','20 MHz'],['HT40+','HT40+'],['HT40-','HT40-'],['HT20','20 MHz (HT)']];
            var apChVal = apRadio ? (apRadio.channel === 'auto' || apRadio.channel == null ? 'auto' : String(apRadio.channel)) : 'auto';
            var apChIn  = inputField(apChVal, 'auto or number');
            var apHtIn  = selectEl(apHtOpts, apRadio ? apRadio.htmode : null);
            defs = [
                { label: 'SSID',             key: 'ssid',      type: 'text',     val: ssid },
                { label: 'Password',         key: 'key',       type: 'password', val: iface.key || '' },
                { label: 'Security',         key: 'encryption',type: 'select',   opts: [['psk2','WPA2'],['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['none','Open']], val: enc },
                { label: 'Network',          key: 'network',   type: 'network',  val: iface.network || 'lan' },
                { label: 'Max stations',     key: 'maxassoc',  type: 'number',   val: iface.maxassoc != null ? String(iface.maxassoc) : '', placeholder: 'unlimited' },
                { label: 'Hidden SSID',      key: 'hidden',    type: 'checkbox', val: iface.hidden },
                { label: 'Client isolation', key: 'isolate',   type: 'checkbox', val: iface.isolate },
                { label: 'WDS bridge',       key: 'wds',       type: 'checkbox', val: iface.wds },
            ];
        } else {
            defs = [
                { label: 'SSID',     key: 'ssid',       type: 'text',     val: ssid },
                { label: 'Password', key: 'key',        type: 'password', val: iface.key || '' },
                { label: 'Security', key: 'encryption', type: 'select',   opts: [['psk2','WPA2'],['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['none','Open']], val: enc },
                { label: 'Network',  key: 'network',    type: 'network',  val: iface.network || 'wwan', forSTA: true },
            ];
        }

        var ctrls = {};
        var b = node('div', {});
        defs.forEach(function(d) {
            var ctrl;
            if      (d.type === 'text' || d.type === 'number') ctrl = inputField(d.val || '', d.placeholder || '');
            else if (d.type === 'password') ctrl = inputField(d.val, 'password');
            else if (d.type === 'select')   ctrl = selectEl(d.opts, d.val);
            else if (d.type === 'checkbox') ctrl = checkbox(!!d.val);
            else if (d.type === 'network')  ctrl = networkSel(d.val, d.forSTA);
            ctrls[d.key] = ctrl;
            b.appendChild(d.type === 'password' ? formRow(d.label, pwdWrap(ctrl)) : formRow(d.label, ctrl));
        });

        // Radio-level controls for AP mode
        if (iface.mode === 'ap' && apRadio) {
            b.appendChild(node('div', { style: 'border-top:1px solid #1a2a3a;margin:10px 0 6px' }));
            var apChWrap = node('div', {});
            apChWrap.appendChild(apChIn);
            if (apBand === 'radio1') apChWrap.appendChild(sp('DFS (CAC ~60s): 52–144', 'display:block;color:#555;font-size:11px;margin-top:3px'));
            b.appendChild(formRow('Channel', apChWrap));
            b.appendChild(formRow('Channel width', apHtIn));
        }

        var saveBtn = btn('Save', null, function() {
            var p = {};
            defs.forEach(function(d) {
                var ctrl = ctrls[d.key];
                if (!ctrl) return;
                if      (d.type === 'checkbox') p[d.key] = ctrl.checked ? '1' : '0';
                else if (d.type === 'select')   p[d.key] = ctrl.value;
                else if (d.type === 'network')  { var nv = ctrl._getValue ? ctrl._getValue() : ''; if (nv) p[d.key] = nv; }
                else if (ctrl.value && ctrl.value.trim()) p[d.key] = ctrl.value.trim();
            });
            applyFlow(applyDiv, function() {
                var ifaceProm = is_mld ? layer2.mld_set(sid, p) : layer2.iface_set(sid, p);
                if (iface.mode === 'ap' && apRadio) {
                    var rp = { channel: apChIn.value.trim() || 'auto', htmode: apHtIn.value };
                    return layer2.radio_set(apRadio.id, rp).then(function(rr) {
                        if (!rr.ok) return Object.assign({ restartRequired: 'none' }, rr);
                        return ifaceProm.then(function(r) { return Object.assign({ restartRequired: r.ok ? 'reboot' : 'none' }, r); });
                    });
                }
                return ifaceProm.then(function(r) { return Object.assign({ restartRequired: r.ok ? 'reboot' : 'none' }, r); });
            }, function() { editMode = false; delete expandState[sid]; if (onApplied) onApplied(); });
        });
        b.appendChild(node('div', { style: 'display:flex;gap:8px;margin-top:10px' },
            saveBtn, btnSecondary('Cancel', function() { editMode = false; refresh(); })));
        return b;
    }

    wrapper.appendChild(row);

    var isStaLost = iface.mode === 'sta' && (status === 'DISCONNECTED' || status === 'SCANNING');
    if (isStaLost || status === 'INIT_FAILED') removeBtn.style.display = 'none';
    if (status === 'INIT_FAILED' || isStaLost) {
        var warnMsg = status === 'INIT_FAILED'
            ? 'Configuration lost — this network is no longer active. Remove it and set it up again using the wizard.'
            : 'Network unreachable — cannot connect to the target network. The network may be out of range or the password may have changed. Remove and reconnect via the wizard.';
        var warnBar = node('div', {
            style: 'background:#f5a62312;border-top:1px solid #f5a62330;padding:9px 14px;' +
                   'display:flex;align-items:center;gap:10px'
        });
        warnBar.appendChild(sp('⚠', 'color:#f5a623;font-size:13px;flex-shrink:0'));
        warnBar.appendChild(node('span', { style: 'color:#c8a04a;font-size:12px;flex:1;line-height:1.4' }, warnMsg));
        var fixBtn = btn('Remove and reconfigure', '#f5a623', function(e) {
            e.stopPropagation();
            if (!confirm('Remove "' + ssid + '" and open wizard to reconfigure?')) return;
            delete expandState[sid];
            applyFlow(applyDiv, function() {
                var prom = is_mld ? layer2.mld_remove(sid) : layer2.iface_remove(sid);
                return prom.then(function(r) {
                    return Object.assign({ restartRequired: 'reboot' }, r);
                });
            }, function() {
                if (onApplied) onApplied();
                if (is_mld) wizards.wizardMLO(onApplied, data);
                else        wizards.wizardStation(onApplied, data);
            });
        });
        fixBtn.style.cssText += ';padding:3px 10px;font-size:12px;flex-shrink:0';
        warnBar.appendChild(fixBtn);
        wrapper.appendChild(warnBar);
    }

    wrapper.appendChild(panel);
    wrapper.appendChild(applyDiv);
    if (expanded) refresh();
    return wrapper;
}


return baseclass.extend({ render: render });
