// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/ui as ui';
'require wifimgr/layer2 as layer2';
'require wifimgr/wizards as wizards';

// Radios tab: per-radio channel/width/TX-power controls, throughput
// sparklines, country change. render(data, onApplied).

var node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, statusBadge = ui.statusBadge, fmtMbps = ui.fmtMbps, drawSparkline = ui.drawSparkline, card = ui.card, lbl = ui.lbl, btn = ui.btn, btnSecondary = ui.btnSecondary, inputField = ui.inputField, selectEl = ui.selectEl, formRow = ui.formRow, collapsible = ui.collapsible, checkbox = ui.checkbox, applyFlow = ui.applyFlow;

var _pendingTxMode = null;              // user-picked TX mode not yet saved
var _tpBufs        = {};                // radio_id -> { rx:[], tx:[], prev:null }

function render(data, onApplied) {
    var radios = data.radios || [];
    var el     = node('div', {});

    // Country + TX power mode card — both system-wide settings
    var country = (radios.length ? radios[0].country : null) || '—';
    var curTxMode = (radios.length ? radios[0].txpower_mode : null) || 'regdb';
    var TX_MODES = [['regdb','Regulatory (country regdb)'],['efuse_max','eFuse max (hardware maximum)'],['manual','Manual (per-radio dBm)']];
    var txModeSel = selectEl(TX_MODES, _pendingTxMode || curTxMode);
    var radioTxInputs = []; // populated in radios.forEach below; used by system Apply button
    var sysApplyDiv = node('div', {});
    var modeHints = {
        regdb:     'Regulatory: country SKU table enforced — stays within legal limits.',
        efuse_max: 'eFuse max: hardware maximum, ignores country limits. Use only if you know what you\'re doing.',
        manual:    'Manual: enter dBm limits in the radio cards below, then click Apply here — mode and limits are saved in one step.'
    };
    var modeHintEl = sp(modeHints[curTxMode] || '', 'color:#555;font-size:11px;margin-bottom:8px;display:block');
    var applyTxBtn = btn('Apply & Reboot', null, function() {
        applyFlow(sysApplyDiv, function() {
            var mode = txModeSel.value;
            var modeChanged = mode !== curTxMode;
            if (!modeChanged && mode === 'manual') {
                var txPromises = radioTxInputs
                    .filter(function(item) { return item.txIn.value.trim(); })
                    .map(function(item) { return layer2.radio_set(item.rid, { txpower: item.txIn.value.trim() }); });
                if (!txPromises.length) return Promise.resolve({ ok: true, restartRequired: 'reboot', errors: [] });
                return Promise.all(txPromises).then(function() {
                    _pendingTxMode = null;
                    return { ok: true, restartRequired: 'reboot', errors: [] };
                });
            }
            return layer2.system_set_txpower_mode(mode).then(function(modeRes) {
                if (!modeRes.ok) return modeRes;
                _pendingTxMode = null;
                if (mode !== 'manual') return modeRes;
                var txPromises = radioTxInputs
                    .filter(function(item) { return item.txIn.value.trim(); })
                    .map(function(item) { return layer2.radio_set(item.rid, { txpower: item.txIn.value.trim() }); });
                if (!txPromises.length) return modeRes;
                return Promise.all(txPromises).then(function() { return modeRes; });
            });
        }, onApplied);
    });
    txModeSel.onchange = function() {
        var sel = txModeSel.value;
        _pendingTxMode = sel !== curTxMode ? sel : null;
        var isManual = sel === 'manual';
        el.querySelectorAll('.txpower-manual-row').forEach(function(row) { row.style.display = isManual ? '' : 'none'; });
        modeHintEl.textContent = modeHints[sel] || '';
        applyTxBtn.textContent = 'Apply & Reboot';
    };
    el.appendChild(card(node('div', {},
        node('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px' },
            node('div', {},
                lbl('Country '),
                node('span', { style: 'color:#ddd;font-size:15px;font-weight:bold' }, country),
                sp('  — reboot required to change', 'color:#555;font-size:11px')
            ),
            btn('Change', '#1e2a3a', function() { wizards.wizardCountry(onApplied, data); })
        ),
        formRow('TX power mode', txModeSel),
        modeHintEl,
        node('div', { style: 'display:flex;gap:8px' }, applyTxBtn),
        sysApplyDiv
    )));

    radios.forEach(function(r) {
        var applyDiv = node('div', {});
        var htOpts = r.id === 'radio2'
            ? [['EHT320','320 MHz (EHT)'],['EHT160','160 MHz (EHT)'],['EHT80','80 MHz'],['EHT40','40 MHz'],['EHT20','20 MHz']]
            : r.id === 'radio1'
                ? [['EHT160','160 MHz (EHT)'],['EHT80','80 MHz'],['EHT40','40 MHz'],['EHT20','20 MHz'],['VHT160','160 MHz (VHT)']]
                : [['EHT40','40 MHz (EHT)'],['EHT20','20 MHz'],['HT40+','HT40+'],['HT40-','HT40-'],['HT20','20 MHz (HT)']];

        var chIn   = inputField(r.channel === 'auto' || r.channel == null ? 'auto' : String(r.channel), 'auto or channel number');
        var htSel  = selectEl(htOpts, r.htmode);
        var txIn   = inputField(r.txpower_uci != null ? String(r.txpower_uci) : '', '1–30 dBm');
        radioTxInputs.push({ rid: r.id, txIn: txIn });
        var bgIn   = checkbox(r.background_radar);
        var nsIn   = checkbox(r.noscan);
        var disIn  = checkbox(r.disabled);
        // LPI — 6 GHz only
        var lpiPsdIn  = r.id === 'radio2' ? checkbox(r.lpi_psd)         : null;
        var lpiEnhIn  = r.id === 'radio2' ? checkbox(r.lpi_bcn_enhance) : null;
        var lpiSkuIn  = r.id === 'radio2' ? inputField(r.lpi_sku_idx != null ? String(r.lpi_sku_idx) : '', '0–255') : null;
        // Advanced radio params
        var twtIn     = checkbox(r.he_twt_responder);
        var legIn     = r.id === 'radio0' ? checkbox(r.legacy_rates) : null;
        var srIn      = checkbox(r.sr_enable);
        var txbfIn    = checkbox(r.etxbfen);
        // Preamble Puncturing — 5G/6G only
        var ppModeIn = null, ppBitmapWrap = null, ppBitButtons = null, ppBitCount = 0;
        if (r.id !== 'radio0') {
            ppModeIn = selectEl([['0','Disabled'],['1','Auto'],['2','Manual']], String(r.pp_mode || 0));
            ppBitCount = r.id === 'radio2' ? 16 : 8;
            ppBitButtons = [];
            ppBitmapWrap = node('div', { style: 'display:none' });
            var ppGrid = node('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px' });
            for (var _bi = 0; _bi < ppBitCount; _bi++) {
                (function(bi) {
                    var active = !((r.pp_bitmap || 0) & (1 << bi));
                    var btn = node('button', {
                        style: 'width:32px;height:26px;font-size:10px;border-radius:3px;cursor:pointer;border:1px solid;' +
                               (active ? 'background:#1a3a1a;border-color:#2a7a2a;color:#6f6' : 'background:#3a1a1a;border-color:#7a2a2a;color:#f66')
                    }, String(bi));
                    btn.title = active ? 'Active (click to puncture)' : 'Punctured (click to restore)';
                    btn._ppActive = active;
                    btn.onclick = function() {
                        btn._ppActive = !btn._ppActive;
                        btn.style.background    = btn._ppActive ? '#1a3a1a' : '#3a1a1a';
                        btn.style.borderColor   = btn._ppActive ? '#2a7a2a' : '#7a2a2a';
                        btn.style.color         = btn._ppActive ? '#6f6'    : '#f66';
                        btn.title = btn._ppActive ? 'Active (click to puncture)' : 'Punctured (click to restore)';
                    };
                    ppBitButtons.push(btn);
                    ppGrid.appendChild(btn);
                })(_bi);
            }
            ppBitmapWrap.appendChild(ppGrid);
            ppBitmapWrap.appendChild(sp('Each box = one 20 MHz subchannel. Green = active, red = punctured.', 'display:block;color:#555;font-size:10px;margin-top:3px'));
            ppModeIn.onchange = function() {
                ppBitmapWrap.style.display = ppModeIn.value === '2' ? '' : 'none';
            };
            if (r.pp_mode === 2) ppBitmapWrap.style.display = '';
        }

        // ── Live throughput ───────────────────────────────────────────────
        var tpIfname = null;
        (data.ifaces || []).forEach(function(iface) {
            if (!tpIfname && iface.device === r.id && iface.mode === 'ap' && iface.ifname)
                tpIfname = iface.ifname;
        });
        if (!tpIfname) {
            (data.mlds || []).forEach(function(mld) {
                if (!tpIfname && mld.ifname && mld.mode === 'ap' &&
                    Array.isArray(mld.radios) && mld.radios.indexOf(r.id) >= 0)
                    tpIfname = mld.ifname;
            });
        }
        if (!_tpBufs[r.id]) _tpBufs[r.id] = { rx: [], tx: [], prev: null };
        var tpState = _tpBufs[r.id];
        tpState.canvas = null;
        var TP_MAX = 30;
        var tpEl = sp('', 'color:#555;font-size:11px;font-family:monospace;margin-left:4px');
        if (tpIfname) {
            var _lt = tpState.tx.length ? tpState.tx[tpState.tx.length - 1] : null;
            var _lr = tpState.rx.length ? tpState.rx[tpState.rx.length - 1] : null;
            if (_lt !== null) tpEl.textContent = '↓ ' + fmtMbps(_lt) + '  ↑ ' + fmtMbps(_lr) + ' Mbit/s';
            if (!tpState.prev) layer2.iface_stats(tpIfname).then(function(res) { if (res.ok) tpState.prev = res.data; });
            var tpTimer = setInterval(function() {
                if (!tpEl.isConnected) { clearInterval(tpTimer); return; }
                layer2.iface_stats(tpIfname).then(function(res) {
                    if (!res.ok || !tpState.prev) { if (res.ok) tpState.prev = res.data; return; }
                    var cur = res.data, prev = tpState.prev;
                    var dt = (cur.ts - prev.ts) / 1000;
                    if (dt < 0.5) return;
                    var txM = Math.max(0, (cur.tx - prev.tx) * 8 / dt / 1e6);
                    var rxM = Math.max(0, (cur.rx - prev.rx) * 8 / dt / 1e6);
                    tpState.tx.push(txM); if (tpState.tx.length > TP_MAX) tpState.tx.shift();
                    tpState.rx.push(rxM); if (tpState.rx.length > TP_MAX) tpState.rx.shift();
                    tpEl.textContent = '↓ ' + fmtMbps(txM) + '  ↑ ' + fmtMbps(rxM) + ' Mbit/s';
                    if (tpState.canvas) drawSparkline(tpState.canvas, tpState.rx, tpState.tx);
                    tpState.prev = cur;
                });
            }, 5000);
        }

        var bodyFn = function() {
            var b = node('div', { style: 'margin-top:10px' });
            if (tpIfname) {
                var cvs = document.createElement('canvas');
                cvs.width = 240; cvs.height = 28;
                cvs.style.cssText = 'display:block;margin-bottom:6px;border-radius:3px;background:#0d1b2a';
                tpState.canvas = cvs;
                if (tpState.rx.length >= 2) drawSparkline(cvs, tpState.rx, tpState.tx);
                b.appendChild(node('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #1a2a3a' },
                    cvs,
                    node('div', {},
                        sp('↓ to clients', 'display:block;color:#5b9bd5;font-size:10px'),
                        sp('↑ from clients', 'display:block;color:#4caf50;font-size:10px')
                    )
                ));
            }

            // ── Channel Advisor ────────────────────────────────────────────
            var advResult = node('div', { style: 'margin-top:4px;min-height:18px' });
            var advBtn = btnSecondary('Scan channels', function() {
                advBtn.disabled = true;
                advBtn.textContent = 'Scanning…';
                layer2.uplink_scan(r.id).then(function(res) {
                    advBtn.disabled = false;
                    advBtn.textContent = 'Scan channels';
                    while (advResult.firstChild) advResult.removeChild(advResult.firstChild);
                    var aps = (res && res.data) || [];
                    if (!aps.length) {
                        advResult.appendChild(sp('No networks found.', 'color:#444;font-size:11px'));
                        return;
                    }
                    // Candidate channels per band
                    var cands = r.id === 'radio0'
                        ? [1,2,3,4,5,6,7,8,9,10,11,12,13]
                        : r.id === 'radio2'
                            ? [1,5,9,13,17,21,25,29,33,37,41,45,49,53,57,61,65,69,73,77,81,85,89,93]
                            : [36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,144,149,153,157,161,165];
                    var is2g = r.id === 'radio0';
                    // Score: lower = less interference
                    var scores = {};
                    cands.forEach(function(ch) { scores[ch] = 0; });
                    aps.forEach(function(ap) {
                        var apCh = ap.channel;
                        if (!apCh) return;
                        // linear weight from signal dBm (stronger AP = more interference)
                        var w = Math.pow(10, ((ap.signal || -90) + 100) / 20);
                        cands.forEach(function(ch) {
                            var dist = Math.abs(ch - apCh);
                            var overlap = is2g
                                ? (dist === 0 ? 1 : dist <= 2 ? 0.5 : dist <= 4 ? 0.25 : 0)
                                : (dist === 0 ? 1 : 0);
                            scores[ch] += w * overlap;
                        });
                    });
                    var sorted = cands.slice().sort(function(a, b) { return scores[a] - scores[b]; });
                    var top3 = sorted.slice(0, 3);
                    var worst = scores[sorted[sorted.length - 1]] || 1;
                    var wrap = node('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px' });
                    wrap.appendChild(sp('Best:', 'color:#555;font-size:11px'));
                    top3.forEach(function(ch, i) {
                        var apCount = aps.filter(function(ap) {
                            return is2g ? Math.abs((ap.channel||0) - ch) <= 2 : ap.channel === ch;
                        }).length;
                        var load = worst > 0 ? scores[ch] / worst : 0;
                        var color = load < 0.15 ? '#1d9e75' : load < 0.45 ? '#f5a623' : '#e24b4a';
                        var chBtn = node('button', {
                            title: apCount + ' AP' + (apCount !== 1 ? 's' : '') + ' nearby',
                            style: 'background:#0d1520;border:1px solid ' + color + '66;color:' + color +
                                   ';font-size:11px;padding:1px 8px;border-radius:3px;cursor:pointer'
                        }, 'CH ' + ch);
                        chBtn.onclick = function() { chIn.value = String(ch); };
                        wrap.appendChild(chBtn);
                        if (i < 2) wrap.appendChild(sp('·', 'color:#2a3a4a;font-size:11px'));
                    });
                    wrap.appendChild(sp('(' + aps.length + ' networks)', 'color:#333;font-size:10px;margin-left:2px'));
                    advResult.appendChild(wrap);
                }).catch(function() {
                    advBtn.disabled = false;
                    advBtn.textContent = 'Scan channels';
                    advResult.appendChild(sp('Scan failed.', 'color:#e24b4a;font-size:11px'));
                });
            });
            advBtn.style.cssText += ';padding:2px 10px;font-size:11px';

            var chWrap = node('div', {});
            chWrap.appendChild(node('div', { style: 'display:flex;align-items:center;gap:8px' }, chIn, advBtn));
            chWrap.appendChild(advResult);
            if (r.id === 'radio1') chWrap.appendChild(sp('DFS channels (CAC ~60s): 52–144', 'display:block;color:#555;font-size:11px;margin-top:3px'));
            b.appendChild(formRow('Channel', chWrap));
            b.appendChild(formRow('Channel width', htSel));
            var txRow = formRow('TX power (dBm)', txIn);
            txRow.className = 'txpower-manual-row';
            txRow.style.display = (r.txpower_mode === 'manual' || txModeSel.value === 'manual') ? '' : 'none';
            b.appendChild(txRow);
            b.appendChild(formRow('Background radar', bgIn));
            b.appendChild(formRow('No scan', nsIn));
            if (lpiPsdIn)  b.appendChild(formRow('LPI PSD', lpiPsdIn));
            if (lpiEnhIn)  b.appendChild(formRow('LPI beacon enhance', lpiEnhIn));
            if (lpiSkuIn)  b.appendChild(formRow('LPI SKU index', lpiSkuIn));
            b.appendChild(formRow('TWT responder', twtIn));
            if (legIn) {
                b.appendChild(formRow('Legacy rates (b/g)', legIn));
                b.appendChild(sp('Enable only if you have 802.11b/g devices — reduces 2.4GHz performance for all clients.', 'color:#555;font-size:11px;display:block;margin:-4px 0 4px'));
            }
            b.appendChild(formRow('Spatial reuse', srIn));
            b.appendChild(formRow('Explicit TxBF', txbfIn));
            if (ppModeIn) {
                b.appendChild(formRow('Preamble Puncturing', ppModeIn));
                b.appendChild(ppBitmapWrap);
            }
            b.appendChild(node('div', { style: 'background:#1a1a0044;border:1px solid #f5a62344;border-radius:4px;padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between' },
                sp('Disabled', 'color:#e24b4a99;font-size:12px'),
                disIn
            ));
            b.appendChild(node('div', { style: 'display:flex;gap:8px' },
                btn('Apply', null, function() {
                    if (disIn.checked && !r.disabled) {
                        if (!confirm('WARNING: Disabling this radio changes the WiFi 7 topology. Re-enabling requires a power cycle. Continue?')) return;
                    }
                    var p = { channel: chIn.value.trim() || 'auto', htmode: htSel.value,
                              background_radar: bgIn.checked ? '1' : '0',
                              noscan: nsIn.checked ? '1' : '0',
                              disabled: disIn.checked ? '1' : '0' };
                    if (txIn.value.trim()) p.txpower = txIn.value.trim();
                    if (lpiPsdIn  !== null) p.lpi_psd         = lpiPsdIn.checked  ? '1' : '0';
                    if (lpiEnhIn  !== null) p.lpi_bcn_enhance  = lpiEnhIn.checked  ? '1' : '0';
                    if (lpiSkuIn  !== null && lpiSkuIn.value.trim()) p.lpi_sku_idx = lpiSkuIn.value.trim();
                    p.he_twt_responder = twtIn.checked  ? '1' : '0';
                    p.sr_enable        = srIn.checked   ? '1' : '0';
                    p.etxbfen          = txbfIn.checked ? '1' : '0';
                    if (legIn !== null) p.legacy_rates  = legIn.checked  ? '1' : '0';
                    if (ppModeIn !== null) {
                        p.pp_mode = ppModeIn.value;
                        if (ppModeIn.value === '2' && ppBitButtons) {
                            var bmap = 0;
                            ppBitButtons.forEach(function(b, i) {
                                if (!b._ppActive) bmap |= (1 << i);
                            });
                            p.pp_bitmap = String(bmap);
                        }
                    }
                    applyFlow(applyDiv, function() { return layer2.radio_set(r.id, p); }, onApplied);
                })
            ));
            b.appendChild(applyDiv);
            return b;
        };

        var hdrEl = node('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
            bandPill(r.id),
            sp('CH ' + (r.channel || '?') + ' · ' + (r.htmode || '?') + ' · TX ' + (r.txpower_actual != null ? r.txpower_actual + ' dBm' : '?'), 'color:#888;font-size:12px'),
            statusBadge(r.disabled ? 'DOWN' : (r.up ? 'UP' : 'DOWN')),
            tpEl
        );

        el.appendChild(card(collapsible('radio_' + r.id, hdrEl, bodyFn, true)));
    });

    return el;
}

return baseclass.extend({ render: render });
