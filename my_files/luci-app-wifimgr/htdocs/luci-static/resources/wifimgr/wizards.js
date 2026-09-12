// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/ui as ui';
'require wifimgr/layer2 as layer2';
'require wifimgr/layer3 as layer3';

// Setup wizards (modal dialogs): AP, AP-MLO, Station, WDS/Bridge, Repeater,
// Country, plus the nearby-scan helper. Each wizard(onDone, data): onDone is the
// caller's apply callback; data is a snapshot of main poll data at open time.

var node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, sigColor = ui.sigColor, muted = ui.muted, strong = ui.strong, btn = ui.btn, btnSecondary = ui.btnSecondary, inputField = ui.inputField, pwdWrap = ui.pwdWrap, selectEl = ui.selectEl, networkSel = ui.networkSel, formRow = ui.formRow, inlineErr = ui.inlineErr, collapsible = ui.collapsible, checkbox = ui.checkbox, applyFlow = ui.applyFlow, openModal = ui.openModal, BANDS = ui.BANDS;

function wizardAP(onDone, data) {
    openModal('Add Access Point', function(body, close, setCloseable) {
        var ssidIn = inputField('', 'Network name (SSID)');
        var passIn = inputField('', 'Password', 'password');
        var ENC_OPTS = {
            radio0: [['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['psk2','WPA2'],['none','Open']],
            radio1: [['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['psk2','WPA2'],['none','Open']],
            radio2: [['sae','WPA3'],['owe','OWE (open secure)']]
        };
        var encSel = selectEl(ENC_OPTS.radio1, 'sae-mixed');
        var applyDiv = node('div', {});
        var errDiv   = node('div', {});

        body.appendChild(formRow('SSID', ssidIn));
        body.appendChild(formRow('Password', pwdWrap(passIn)));
        body.appendChild(formRow('Security', encSel));
        body.appendChild(errDiv);

        // Advanced collapsible
        var radioSel  = selectEl([['radio0','2.4 GHz'],['radio1','5 GHz'],['radio2','6 GHz']], 'radio1');

        // Disable radios at MBSSID limit: MLO AP link + existing legacy AP = 2 → adding 3rd via wifi reload crashes MCU
        var _apAllBlocked = false;
        (function() {
            var mloApRadios = new Set();
            (data.mlds || []).filter(function(m) { return m.mode === 'ap'; }).forEach(function(m) {
                (m.radios || []).forEach(function(r) { mloApRadios.add(r); });
            });
            Array.from(radioSel.options).forEach(function(opt) {
                if (!mloApRadios.has(opt.value)) return;
                var existingAps = (data.ifaces || []).filter(function(i) {
                    return !i.mlo && i.mode === 'ap' && Array.isArray(i.device) && i.device.indexOf(opt.value) !== -1;
                }).length;
                if (existingAps >= 1) {
                    opt.disabled = true;
                    opt.text += ' — at limit';
                }
            });
            var firstFree = Array.from(radioSel.options).find(function(o) { return !o.disabled; });
            if (firstFree) { radioSel.value = firstFree.value; } else { _apAllBlocked = true; }
        })();
        var CHAN_OPTS  = {
            radio0: [['auto','auto'],['1','1'],['6','6'],['11','11']],
            radio1: [['auto','auto'],['36','36'],['40','40'],['44','44'],['48','48'],['52','52 (DFS)'],['56','56 (DFS)'],['60','60 (DFS)'],['64','64 (DFS)'],['100','100 (DFS)'],['104','104 (DFS)'],['108','108 (DFS)'],['112','112 (DFS)'],['116','116 (DFS)'],['120','120 (DFS)'],['124','124 (DFS)'],['128','128 (DFS)'],['132','132 (DFS)'],['136','136 (DFS)'],['140','140 (DFS)'],['144','144 (DFS)'],['149','149'],['153','153'],['157','157'],['161','161'],['165','165']],
            radio2: [['auto','auto'],['1','1'],['5','5'],['9','9'],['33','33'],['37','37'],['69','69']]
        };
        var WIDTH_OPTS = {
            radio0: [['auto','auto'],['20','20 MHz'],['40','40 MHz']],
            radio1: [['auto','auto'],['20','20 MHz'],['40','40 MHz'],['80','80 MHz'],['160','160 MHz']],
            radio2: [['auto','auto'],['20','20 MHz'],['40','40 MHz'],['80','80 MHz'],['160','160 MHz'],['320','320 MHz']]
        };
        var chanSel  = selectEl(CHAN_OPTS[radioSel.value]  || CHAN_OPTS.radio1,  'auto');
        var widthSel = selectEl(WIDTH_OPTS[radioSel.value] || WIDTH_OPTS.radio1, 'auto');
        var ifaceSel = networkSel('lan');
        var isoIn    = checkbox(false);
        var hidIn    = checkbox(false);
        var wdsCbAP  = checkbox(false);
        var maxIn    = inputField('', 'unlimited');

        var dfsNote = node('div', { style: 'color:#f5a623;font-size:11px;margin-top:3px;display:none' },
            'DFS channels (52+) require ~60 s CAC scan — network appears after restart');

        radioSel.onchange = function() {
            var opts = CHAN_OPTS[radioSel.value] || CHAN_OPTS.radio1;
            while (chanSel.firstChild) chanSel.removeChild(chanSel.firstChild);
            opts.forEach(function(o) { chanSel.appendChild(node('option', { value: o[0] }, o[1])); });
            var wOpts = WIDTH_OPTS[radioSel.value] || WIDTH_OPTS.radio1;
            while (widthSel.firstChild) widthSel.removeChild(widthSel.firstChild);
            wOpts.forEach(function(o) { widthSel.appendChild(node('option', { value: o[0] }, o[1])); });
            var eOpts = ENC_OPTS[radioSel.value] || ENC_OPTS.radio0;
            while (encSel.firstChild) encSel.removeChild(encSel.firstChild);
            eOpts.forEach(function(o) { encSel.appendChild(node('option', { value: o[0] }, o[1])); });
            dfsNote.style.display = radioSel.value === 'radio1' ? '' : 'none';
        };
        var advBody = node('div', { style: 'margin-top:4px' });
        advBody.appendChild(formRow('Radio', radioSel));
        advBody.appendChild(dfsNote);
        advBody.appendChild(formRow('Channel', chanSel));
        advBody.appendChild(formRow('Width', widthSel));
        advBody.appendChild(formRow('Network', ifaceSel));
        advBody.appendChild(formRow('Isolate clients', isoIn));
        advBody.appendChild(sp('Blocks direct traffic between connected clients — useful for guest networks.', 'color:#555;font-size:11px;display:block;margin:-4px 0 4px'));
        advBody.appendChild(formRow('Hidden SSID', hidIn));
        advBody.appendChild(formRow('WDS bridge', wdsCbAP));
        advBody.appendChild(formRow('Max clients', maxIn));
        body.appendChild(collapsible('wiz_ap_adv', 'Advanced parameters', function() { return advBody; }, false));

        var goBtn = btn('Add Network', null, function() {
            if (_apAllBlocked) return;
            var ssid = ssidIn.value.trim();
            if (!ssid) { while(errDiv.firstChild) errDiv.removeChild(errDiv.firstChild); errDiv.appendChild(inlineErr('SSID is required')); return; }
            var rid = radioSel.value;
            if (radioSel.options[radioSel.selectedIndex] && radioSel.options[radioSel.selectedIndex].disabled) {
                errDiv.appendChild(inlineErr('Selected radio is at capacity — choose a different radio or remove an existing network first.')); return;
            }
            var p = { ssid: ssid, encryption: encSel.value };
            if (passIn.value)   p.key     = passIn.value;
            if (isoIn.checked)   p.isolate = '1';
            if (hidIn.checked)   p.hidden  = '1';
            if (wdsCbAP.checked) p.wds     = '1';
            if (parseInt(maxIn.value) > 0) p.maxassoc = maxIn.value;
            p.network = ifaceSel._getValue();

            applyFlow(applyDiv, function() {
                var rp = {};
                if (chanSel.value  !== 'auto') rp.channel = chanSel.value;
                if (widthSel.value !== 'auto') rp.htmode  = 'EHT' + widthSel.value;
                var radioPromise = Object.keys(rp).length
                    ? layer2.radio_set(rid, rp)
                    : Promise.resolve({ ok: true, errors: [] });
                return radioPromise.then(function(rR) {
                    if (!rR.ok) return { ok: false, errors: rR.errors || ['Radio settings failed'], restartRequired: 'none' };
                    return layer3.wizard_ap(rid, p);
                });
            }, function() { close(); if (onDone) onDone(); }, setCloseable);
        });

        if (_apAllBlocked) {
            goBtn.disabled = true; goBtn.style.background = '#555'; goBtn.style.borderColor = '#444'; goBtn.style.cursor = 'not-allowed';
            body.insertBefore(node('div', { style: 'color:#e53935;font-size:12px;margin-bottom:10px;padding:8px;background:#3a070744;border-radius:4px;border-left:3px solid #e53935' },
                'All radios are at capacity — each MLO radio already has a network. Remove an existing network first.'), body.firstChild);
        }
        body.appendChild(node('div', { style: 'margin-top:12px' }, goBtn));
        body.appendChild(applyDiv);
    });
}

function wizardMLO(onDone, data) {
    openModal('Add WiFi 7 Network', function(body, close, setCloseable) {
        var ssidIn   = inputField('', 'Network name (SSID)');
        var passIn   = inputField('', 'Password (min 8 chars)', 'password');
        var applyDiv = node('div', {});

        body.appendChild(node('div', { style: 'color:#f5a623;font-size:12px;margin-bottom:12px;padding:8px;background:#2a180044;border-radius:4px;border-left:3px solid #f5a623' },
            'WPA3 will be used automatically. Select at least 2 bands.'));
        body.appendChild(formRow('SSID', ssidIn));
        body.appendChild(formRow('Password', pwdWrap(passIn)));

        // Link toggle buttons
        var linkActive = { radio0: true, radio1: true, radio2: true };
        var linkBtns = {};
        var linkRow = node('div', { style: 'display:flex;gap:6px' });
        [['radio0','2.4 GHz'],['radio1','5 GHz'],['radio2','6 GHz']].forEach(function(pair) {
            var rid = pair[0], label = pair[1];
            var b2 = BANDS[rid];
            var el = node('button', {
                style: 'padding:4px 12px;font-size:12px;border-radius:4px;cursor:pointer;border:1px solid ' + b2.fg + ';background:' + b2.bg + ';color:' + b2.fg
            }, label);
            el.onclick = function() {
                linkActive[rid] = !linkActive[rid];
                el.style.border   = '1px solid ' + (linkActive[rid] ? b2.fg : '#2a3a50');
                el.style.background = linkActive[rid] ? b2.bg : 'none';
                el.style.color    = linkActive[rid] ? b2.fg : '#555';
            };
            linkBtns[rid] = el;
            linkRow.appendChild(el);
        });

        // Protection: disable link buttons for radios already in an MLO AP group
        var _mloBlocked = false; var _mloBlockMsg = null;
        (function() {
            var usedInMlo = new Set();
            (data.mlds || []).forEach(function(m) {
                (m.radios || []).forEach(function(r) { usedInMlo.add(r); });
            });
            ['radio0','radio1','radio2'].forEach(function(rid) {
                if (!usedInMlo.has(rid)) return;
                linkActive[rid] = false;
                var el = linkBtns[rid]; var b2 = BANDS[rid];
                el.disabled = true; el.onclick = null;
                el.style.border = '1px solid #2a3a50'; el.style.background = 'none';
                el.style.color = '#555'; el.style.cursor = 'not-allowed';
                el.title = 'Already part of an MLO group — remove existing MLO first';
            });
            var free = ['radio0','radio1','radio2'].filter(function(r) { return !usedInMlo.has(r); }).length;
            if (free < 2) {
                _mloBlocked = true;
                _mloBlockMsg = node('div', { style: 'color:#e53935;font-size:12px;margin-bottom:10px;padding:8px;background:#3a070744;border-radius:4px;border-left:3px solid #e53935' },
                    free === 0 ? 'All radios are already part of an MLO group (AP or STA). Remove the existing MLO network first.'
                               : 'Only 1 free radio — MLO requires at least 2. Remove an existing MLO network first.');
            }
        })();

        body.appendChild(formRow('Links', linkRow));

        // Advanced collapsible — per-link channel/width/TX, L3, interface, isolate
        var advBody = node('div', { style: 'margin-top:4px' });

        // Per-link channel/width/TX controls
        var CHAN_MLO = {
            radio0: [['auto','auto'],['1','1'],['6','6'],['11','11']],
            radio1: [['auto','auto'],['36','36'],['48','48'],['100','100'],['149','149']],
            radio2: [['auto','auto'],['1','1'],['37','37'],['69','69']]
        };
        var linkControls = {};
        [['radio0','2.4 GHz'],['radio1','5 GHz'],['radio2','6 GHz']].forEach(function(pair) {
            var rid = pair[0], label = pair[1];
            var cSel = selectEl(CHAN_MLO[rid], 'auto');
            var wSel = selectEl([['auto','auto'],['20','20 MHz'],['40','40 MHz'],['80','80 MHz'],['160','160 MHz']], 'auto');
            advBody.appendChild(node('div', { style: 'color:#aaa;font-size:12px;margin:8px 0 4px;font-weight:bold' }, label));
            advBody.appendChild(formRow('Channel', cSel));
            advBody.appendChild(formRow('Width', wSel));
            linkControls[rid] = { chanSel: cSel, widthSel: wSel };
        });

        var ifaceSel    = networkSel('lan');
        var isoIn       = checkbox(false);
        var emlDisableIn = checkbox(false);
        advBody.appendChild(formRow('Network', ifaceSel));
        advBody.appendChild(formRow('Isolate clients', isoIn));
        advBody.appendChild(sp('Blocks direct traffic between connected clients — useful for guest networks.', 'color:#555;font-size:11px;display:block;margin:-4px 0 4px'));
        advBody.appendChild(formRow('Disable EML', emlDisableIn));
        body.appendChild(collapsible('wiz_mlo_adv', 'Advanced parameters', function() { return advBody; }, false));

        var goBtn = btn('Create WiFi 7 Network', null, function() {
            var ssid = ssidIn.value.trim();
            if (!ssid) { body.appendChild(inlineErr('SSID is required')); return; }
            if (_mloBlocked) return;
            var rids = ['radio0','radio1','radio2'].filter(function(r) { return linkActive[r]; });
            if (rids.length < 2) { body.appendChild(inlineErr('Select at least 2 bands')); return; }
            var p = { ssid: ssid, encryption: 'sae', network: ifaceSel._getValue() };
            if (passIn.value) p.key = passIn.value;
            if (isoIn.checked) p.isolate = '1';
            if (emlDisableIn.checked) p.eml_disable = '1';

            applyFlow(applyDiv, function() {
                return rids.reduce(function(chain, rid) {
                    return chain.then(function(prev) {
                        if (!prev.ok) return prev;
                        var lc = linkControls[rid];
                        var rp = {};
                        if (lc.chanSel.value !== 'auto')  rp.channel = lc.chanSel.value;
                        if (lc.widthSel.value !== 'auto') rp.htmode  = 'EHT' + lc.widthSel.value;
                        return Object.keys(rp).length ? layer2.radio_set(rid, rp) : Promise.resolve({ ok: true, errors: [] });
                    });
                }, Promise.resolve({ ok: true, errors: [] })).then(function(last) {
                    if (!last.ok) return { ok: false, errors: last.errors || ['Radio set failed'], restartRequired: 'none' };
                    return layer3.wizard_mlo(rids, p);
                });
            }, function() { close(); if (onDone) onDone(); }, setCloseable);
        });

        if (_mloBlocked) {
            goBtn.disabled = true; goBtn.style.background = '#555'; goBtn.style.borderColor = '#444'; goBtn.style.cursor = 'not-allowed';
            body.insertBefore(_mloBlockMsg, body.firstChild);
        }
        body.appendChild(node('div', { style: 'margin-top:12px' }, goBtn));
        body.appendChild(applyDiv);
    });
}

function wizardStation(onDone, data) {
    openModal('Add Station', function(body, close, setCloseable) {
        var ssidIn   = inputField('', 'Upstream SSID');
        var passIn   = inputField('', 'Password', 'password');
        var mloCb    = checkbox(false);
        var bandSel  = selectEl([['radio0','2.4 GHz'],['radio1','5 GHz']], 'radio1');
        var assocSel = selectEl([['1','5 GHz'],['0','2.4 GHz']], '1');
        var applyDiv = node('div', {});

        var mloRow   = formRow('MLO', mloCb);
        var mloHint  = sp('WiFi 7 multi-band connection — requires an active MLO AP on the other router.', 'color:#555;font-size:11px;display:block;margin:-4px 0 4px');
        var mloConflictNote = node('div', { style: 'color:#e53935;font-size:11px;margin-top:3px;display:none' }, '');
        var assocRow = formRow('Assoc band', assocSel);
        assocRow.style.display = 'none';
        var bandRow  = formRow('Band', bandSel);

        var scanErrDiv = node('div', {});
        var scanBtn = btnSecondary('Scan', function() {
            var radio = mloCb.checked ? 'radio1' : bandSel.value;
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning…';
            while (scanErrDiv.firstChild) scanErrDiv.removeChild(scanErrDiv.firstChild);
            layer2.uplink_scan(radio).then(function(res) {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Scan';
                if (!res.ok || !res.data.length) {
                    scanErrDiv.appendChild(inlineErr('No networks found — try again'));
                    return;
                }
                openModal('Available Networks', function(scanBody, scanClose) {
                    var refreshTimer = null;
                    var autoOn = true;
                    var tbl = node('table', { style: 'width:100%;border-collapse:collapse' });
                    var hdr = node('tr', {});
                    ['Signal','Band','SSID','Ch','Encryption'].forEach(function(h) {
                        hdr.appendChild(node('th', { style: 'text-align:left;padding:4px 8px;opacity:.6;font-size:11px' }, h));
                    });
                    tbl.appendChild(hdr);

                    function renderRows(data) {
                        while (tbl.rows.length > 1) tbl.deleteRow(1);
                        data.forEach(function(bss) {
                            var b = (bss.mhz >= 5925) ? 6 : (bss.mhz >= 5000) ? 5 : 2;
                            var bandLabel = b === 6 ? '6 GHz' : b === 5 ? '5 GHz' : '2.4 GHz';
                            var bandRadio = b === 6 ? 'radio2' : b === 5 ? 'radio1' : 'radio0';
                            var sigPct = bss.quality_max ? Math.round(100 * bss.quality / bss.quality_max) : 0;
                            var sigColor = sigPct >= 66 ? '#4caf50' : sigPct >= 33 ? '#f5a623' : '#e53935';
                            var row = node('tr', { style: 'cursor:pointer;border-top:1px solid rgba(255,255,255,.08)' });
                            row.appendChild(node('td', { style: 'padding:6px 8px' },
                                node('span', { style: 'color:' + sigColor }, sigPct + '%')));
                            row.appendChild(node('td', { style: 'padding:6px 8px' }, bandPill(bandRadio)));
                            row.appendChild(node('td', { style: 'padding:6px 8px;font-weight:500' }, bss.ssid || ''));
                            row.appendChild(node('td', { style: 'padding:6px 8px;opacity:.6' }, String(bss.channel || '')));
                            row.appendChild(node('td', { style: 'padding:6px 8px;opacity:.6;font-size:11px' }, bss.encryption || 'open'));
                            row.addEventListener('mouseenter', function() { row.style.background = 'rgba(255,255,255,.06)'; });
                            row.addEventListener('mouseleave', function() { row.style.background = ''; });
                            row.addEventListener('click', function() {
                                ssidIn.value = bss.ssid || '';
                                if (!mloCb.checked) {
                                    bandSel.value = bandRadio;
                                    bandSel.dispatchEvent(new Event('change'));
                                }
                                var encMap = { 'sae': 'sae', 'sae-mixed': 'sae-mixed', 'psk2': 'psk2', 'psk': 'psk2', 'none': 'none', 'owe': 'owe' };
                                var encVal = encMap[bss.encryption] || 'auto';
                                if (encSel.querySelector('option[value="' + encVal + '"]'))
                                    encSel.value = encVal;
                                passIn.focus();
                                clearInterval(refreshTimer);
                                scanClose();
                            });
                            tbl.appendChild(row);
                        });
                    }
                    renderRows(res.data);

                    var stopBtn = node('button', {}, '■ Stop');
                    stopBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:0;margin-left:6px';
                    stopBtn.onclick = function() {
                        autoOn = !autoOn;
                        if (autoOn) {
                            refreshTimer = setInterval(doRefresh, 8000);
                            stopBtn.textContent = '■ Stop';
                        } else {
                            clearInterval(refreshTimer);
                            stopBtn.textContent = '▶ Resume';
                        }
                    };
                    function doRefresh() {
                        if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
                        layer2.uplink_scan(radio).then(function(newRes) {
                            if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
                            if (newRes.ok && newRes.data.length) renderRows(newRes.data);
                        });
                    }
                    refreshTimer = setInterval(doRefresh, 8000);

                    scanBody.appendChild(node('div', { style: 'display:flex;align-items:center;margin-bottom:6px' },
                        muted('Auto-refresh every 8s ·'), stopBtn));
                    scanBody.appendChild(tbl);
                });
            }).catch(function() {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Scan';
                scanErrDiv.appendChild(inlineErr('Scan failed — try again'));
            });
        });

        var ssidRow = node('div', { style: 'display:flex;gap:8px;align-items:center' },
            node('div', { style: 'flex:1' }, ssidIn), scanBtn);

        body.appendChild(formRow('SSID', ssidRow));
        body.appendChild(scanErrDiv);
        body.appendChild(formRow('Password', pwdWrap(passIn)));
        body.appendChild(mloRow);
        body.appendChild(mloHint);
        body.appendChild(mloConflictNote);
        body.appendChild(assocRow);
        body.appendChild(bandRow);

        mloCb.addEventListener('change', function() {
            var mlo = mloCb.checked;
            assocRow.style.display = mlo ? '' : 'none';
            bandRow.style.display  = mlo ? 'none' : '';
            var hasLocalMloAp  = mlo && (data.mlds || []).some(function(m) { return m.mode === 'ap'; });
            var hasLocalMloSta = mlo && (data.mlds || []).some(function(m) { return m.mode === 'sta'; });
            var blocked = hasLocalMloAp || hasLocalMloSta;
            while (mloConflictNote.firstChild) mloConflictNote.removeChild(mloConflictNote.firstChild);
            if (hasLocalMloAp)  mloConflictNote.appendChild(document.createTextNode('Cannot add MLO STA — a local MLO AP is active on the same radios. Remove it first (Networks tab).'));
            if (hasLocalMloSta) mloConflictNote.appendChild(document.createTextNode('Cannot add a second MLO STA — one is already active. Remove it first (Networks tab).'));
            mloConflictNote.style.display = blocked ? 'block' : 'none';
            goBtn.disabled = blocked;
            goBtn.style.background  = blocked ? '#555' : '';
            goBtn.style.borderColor = blocked ? '#444' : '';
            goBtn.style.cursor      = blocked ? 'not-allowed' : '';
        });

        var ipSel    = selectEl([['dhcp','DHCP'],['static','Static']], 'dhcp');
        var ifaceSel = networkSel('wwan', true);
        var bssidIn  = inputField('', 'AA:BB:CC:DD:EE:FF');
        var STA_ENC_OPTS = {
            radio0: [['auto','auto'],['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['psk2','WPA2'],['none','Open']],
            radio1: [['auto','auto'],['sae-mixed','WPA2/WPA3'],['sae','WPA3'],['psk2','WPA2'],['none','Open']],
            mlo:    [['sae','WPA3'],['sae-mixed','WPA2/WPA3']]
        };
        var encSel   = selectEl(STA_ENC_OPTS.radio1, 'auto');
        var wdsCb    = checkbox(false);

        function updateStaEnc() {
            var band = mloCb.checked ? 'mlo' : bandSel.value;
            var opts = STA_ENC_OPTS[band] || STA_ENC_OPTS.radio1;
            while (encSel.firstChild) encSel.removeChild(encSel.firstChild);
            opts.forEach(function(o) { encSel.appendChild(node('option', { value: o[0] }, o[1])); });
        }
        bandSel.addEventListener('change', function() { updateStaEnc(); updateBandNote(); });
        mloCb.addEventListener('change', updateStaEnc);

        var advBody = node('div', { style: 'margin-top:4px' });
        advBody.appendChild(formRow('IP mode', ipSel));
        advBody.appendChild(formRow('Network', ifaceSel));
        advBody.appendChild(formRow('BSSID lock', bssidIn));
        advBody.appendChild(formRow('Encryption', encSel));
        advBody.appendChild(formRow('WDS mode', wdsCb));
        body.appendChild(collapsible('wiz_sta_adv', 'Advanced parameters', function() { return advBody; }, false));

        var goBtn = btn('Add Station', null, function() {
            var ssid = ssidIn.value.trim();
            if (!ssid) { body.appendChild(inlineErr('SSID is required')); return; }
            var isMlo = mloCb.checked;
            var p = { ssid: ssid, network: ifaceSel._getValue() };
            if (passIn.value)            p.key        = passIn.value;
            if (bssidIn.value.trim())    p.bssid      = bssidIn.value.trim();
            if (encSel.value !== 'auto') p.encryption = encSel.value;
            if (wdsCb.checked)           p.wds        = '1';
            if (isMlo) {
                p.mlo                    = '1';
                p.mld_assoc_phy          = parseInt(assocSel.value);
                p.mld_allowed_phy_bitmap = 7;
            }
            applyFlow(applyDiv, function() {
                return layer3.wizard_sta(isMlo ? 'radio1' : bandSel.value, p);
            }, function() { close(); if (onDone) onDone(); }, setCloseable);
        });
        body.appendChild(node('div', { style: 'margin-top:12px' }, goBtn));
        body.appendChild(applyDiv);
    });
}

function wizardWDS(onDone, data) {
    openModal('Add WDS / Bridge', function(body, close, setCloseable) {
        var ssidIn    = inputField('', 'Upstream SSID');
        var passIn    = inputField('', 'Password', 'password');
        var remoteMac = inputField('', 'AA:BB:CC:DD:EE:FF (optional)');
        var bandSel   = selectEl([['radio0','2.4 GHz'],['radio1','5 GHz']], 'radio1');
        var typeSel   = selectEl([['wds','WDS (4-address)'],['relayd','relayd (ARP proxy)']], 'wds');
        var applyDiv  = node('div', {});

        var _wdsMloRids = new Set();
        (data.mlds || []).forEach(function(m) { (m.radios || []).forEach(function(r) { _wdsMloRids.add(r); }); });
        var _wdsBlocked = false;
        Array.from(bandSel.options).forEach(function(opt) {
            if (!_wdsMloRids.has(opt.value)) return;
            opt.disabled = true; opt.text += ' — MLO active';
        });
        var _wdsFree = Array.from(bandSel.options).find(function(o) { return !o.disabled; });
        if (_wdsFree) { bandSel.value = _wdsFree.value; } else { _wdsBlocked = true; }

        var WDS_ENC_OPTS = {
            radio0: [['none','Open'],['psk2','WPA2'],['sae-mixed','WPA2/WPA3']],
            radio1: [['none','Open'],['psk2','WPA2'],['sae-mixed','WPA2/WPA3']]
        };
        var encSel  = selectEl(WDS_ENC_OPTS.radio1, 'none');
        var ifaceSel = networkSel('lan');

        function updateEnc() {
            var opts = WDS_ENC_OPTS[bandSel.value] || WDS_ENC_OPTS.radio1;
            while (encSel.firstChild) encSel.removeChild(encSel.firstChild);
            opts.forEach(function(o) { encSel.appendChild(node('option', { value: o[0] }, o[1])); });
        }
        bandSel.addEventListener('change', updateEnc);

        var wdsErrDiv = node('div', {});
        var wdsScanBtn = btnSecondary('Scan', function() {
            var wdsScanRadio = bandSel.value;
            wdsScanBtn.disabled = true;
            wdsScanBtn.textContent = 'Scanning…';
            while (wdsErrDiv.firstChild) wdsErrDiv.removeChild(wdsErrDiv.firstChild);
            layer2.uplink_scan(wdsScanRadio).then(function(res) {
                wdsScanBtn.disabled = false;
                wdsScanBtn.textContent = 'Scan';
                if (!res.ok || !res.data.length) {
                    wdsErrDiv.appendChild(inlineErr('No networks found — try again'));
                    return;
                }
                openModal('Available Networks', function(scanBody, scanClose) {
                    var refreshTimer = null;
                    var autoOn = true;
                    var tbl = node('table', { style: 'width:100%;border-collapse:collapse' });
                    var hdr = node('tr', {});
                    ['Signal','Band','SSID','Ch','Encryption'].forEach(function(h) {
                        hdr.appendChild(node('th', { style: 'text-align:left;padding:4px 8px;opacity:.6;font-size:11px' }, h));
                    });
                    tbl.appendChild(hdr);

                    function renderRows(data) {
                        while (tbl.rows.length > 1) tbl.deleteRow(1);
                        data.forEach(function(bss) {
                            var b = (bss.mhz >= 5925) ? 6 : (bss.mhz >= 5000) ? 5 : 2;
                            var bandLabel = b === 6 ? '6 GHz' : b === 5 ? '5 GHz' : '2.4 GHz';
                            var bandRadio = b === 6 ? 'radio2' : b === 5 ? 'radio1' : 'radio0';
                            var sigPct = bss.quality_max ? Math.round(100 * bss.quality / bss.quality_max) : 0;
                            var sigColor = sigPct >= 66 ? '#4caf50' : sigPct >= 33 ? '#f5a623' : '#e53935';
                            var row = node('tr', { style: 'cursor:pointer;border-top:1px solid rgba(255,255,255,.08)' });
                            row.appendChild(node('td', { style: 'padding:6px 8px' },
                                node('span', { style: 'color:' + sigColor }, sigPct + '%')));
                            row.appendChild(node('td', { style: 'padding:6px 8px' }, bandPill(bandRadio)));
                            row.appendChild(node('td', { style: 'padding:6px 8px;font-weight:500' }, bss.ssid || ''));
                            row.appendChild(node('td', { style: 'padding:6px 8px;opacity:.6' }, String(bss.channel || '')));
                            row.appendChild(node('td', { style: 'padding:6px 8px;opacity:.6;font-size:11px' }, bss.encryption || 'open'));
                            row.addEventListener('mouseenter', function() { row.style.background = 'rgba(255,255,255,.06)'; });
                            row.addEventListener('mouseleave', function() { row.style.background = ''; });
                            row.addEventListener('click', function() {
                                ssidIn.value = bss.ssid || '';
                                bandSel.value = bandRadio;
                                bandSel.dispatchEvent(new Event('change'));
                                var encMap = { 'sae': 'sae-mixed', 'sae-mixed': 'sae-mixed', 'psk2': 'psk2', 'none': 'none' };
                                var encVal = encMap[bss.encryption] || 'auto';
                                if (encSel.querySelector('option[value="' + encVal + '"]'))
                                    encSel.value = encVal;
                                passIn.focus();
                                clearInterval(refreshTimer);
                                scanClose();
                            });
                            tbl.appendChild(row);
                        });
                    }
                    renderRows(res.data);

                    var stopBtn = node('button', {}, '■ Stop');
                    stopBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:0;margin-left:6px';
                    stopBtn.onclick = function() {
                        autoOn = !autoOn;
                        if (autoOn) {
                            refreshTimer = setInterval(doRefresh, 8000);
                            stopBtn.textContent = '■ Stop';
                        } else {
                            clearInterval(refreshTimer);
                            stopBtn.textContent = '▶ Resume';
                        }
                    };
                    function doRefresh() {
                        if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
                        layer2.uplink_scan(wdsScanRadio).then(function(newRes) {
                            if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
                            if (newRes.ok && newRes.data.length) renderRows(newRes.data);
                        });
                    }
                    refreshTimer = setInterval(doRefresh, 8000);

                    scanBody.appendChild(node('div', { style: 'display:flex;align-items:center;margin-bottom:6px' },
                        muted('Auto-refresh every 8s ·'), stopBtn));
                    scanBody.appendChild(tbl);
                });
            }).catch(function() {
                wdsScanBtn.disabled = false;
                wdsScanBtn.textContent = 'Scan';
                wdsErrDiv.appendChild(inlineErr('Scan failed — try again'));
            });
        });

        var ssidRow = node('div', { style: 'display:flex;gap:8px;align-items:center' },
            node('div', { style: 'flex:1' }, ssidIn), wdsScanBtn);

        body.appendChild(formRow('SSID', ssidRow));
        body.appendChild(wdsErrDiv);
        body.appendChild(formRow('Password', pwdWrap(passIn)));
        body.appendChild(formRow('Band', bandSel));
        body.appendChild(formRow('Bridge type', typeSel));
        body.appendChild(sp('WDS: L2 bridge, clients share upstream subnet — upstream AP must also have WDS/4-address mode enabled. relayd: ARP proxy, similar result, no AP-side config needed.', 'color:#555;font-size:11px;display:block;margin:-4px 0 4px'));

        var relaydNote = node('div', { style: 'display:none;margin:6px 0 2px;padding:8px 10px;background:rgba(255,165,0,.12);border-left:3px solid #f5a623;border-radius:3px;font-size:12px;color:#f5a623' },
            'Requires the ', node('b', {}, 'relayd'), ' package on this router (apk add relayd).');
        body.appendChild(relaydNote);
        typeSel.addEventListener('change', function() {
            relaydNote.style.display = typeSel.value === 'relayd' ? '' : 'none';
        });

        var advBody = node('div', { style: 'margin-top:4px' });
        advBody.appendChild(formRow('Remote AP MAC', remoteMac));
        advBody.appendChild(formRow('Encryption', encSel));
        advBody.appendChild(formRow('Network', ifaceSel));
        body.appendChild(collapsible('wiz_wds_adv', 'Advanced parameters', function() { return advBody; }, false));

        if (_wdsBlocked) {
            var _wdsBlockDiv = node('div', { style: 'color:#e53935;font-size:12px;margin-bottom:10px;padding:8px;background:#3a070744;border-radius:4px;border-left:3px solid #e53935' },
                'Both radios (2.4 GHz and 5 GHz) are part of an MLO group — WDS / relayd uplink is not possible. Remove the MLO network first.');
            body.insertBefore(_wdsBlockDiv, body.firstChild);
        }

        var goBtn = btn('Add WDS / Bridge', null, function() {
            if (_wdsBlocked) return;
            if (bandSel.options[bandSel.selectedIndex] && bandSel.options[bandSel.selectedIndex].disabled) {
                body.appendChild(inlineErr('Selected band is part of an MLO group — choose a different band.')); return;
            }
            var ssid = ssidIn.value.trim();
            if (!ssid) { body.appendChild(inlineErr('SSID is required')); return; }
            var useRelayd = typeSel.value === 'relayd';
            applyFlow(applyDiv, function() {
                if (useRelayd) {
                    var p = { ssid: ssid, encryption: encSel.value };
                    if (passIn.value) p.key = passIn.value;
                    if (remoteMac.value.trim()) p.bssid = remoteMac.value.trim();
                    return layer3.wizard_relayd(bandSel.value, p);
                } else {
                    var p = { ssid: ssid, wds: '1', network: ifaceSel._getValue(), encryption: encSel.value };
                    if (passIn.value)           p.key   = passIn.value;
                    if (remoteMac.value.trim()) p.bssid = remoteMac.value.trim();
                    return layer3.wizard_sta(bandSel.value, p);
                }
            }, function() { close(); if (onDone) onDone(); }, setCloseable);
        });
        if (_wdsBlocked) { goBtn.disabled = true; goBtn.style.background = '#555'; goBtn.style.borderColor = '#444'; goBtn.style.cursor = 'not-allowed'; }
        body.appendChild(node('div', { style: 'margin-top:12px' }, goBtn));
        body.appendChild(applyDiv);
    });
}

function wizardRepeater(onDone, data) {
    openModal('Set Up Repeater', function(body, close, setCloseable) {
        var uplinkRadioSel = selectEl([['radio1','5 GHz'],['radio0','2.4 GHz']], 'radio1');
        var scanErrDiv = node('div', {});
        var scanArea   = node('div', {});
        var step2      = node('div', { style: 'display:none' });
        var applyDiv   = node('div', {});

        // Block uplink radios that are part of any MLO group (AP or STA)
        var _repMloRids = new Set();
        (data.mlds || []).forEach(function(m) { (m.radios || []).forEach(function(r) { _repMloRids.add(r); }); });
        var _repBlocked = false;
        Array.from(uplinkRadioSel.options).forEach(function(opt) {
            if (!_repMloRids.has(opt.value)) return;
            opt.disabled = true; opt.text += ' — MLO active';
        });
        var _repFree = Array.from(uplinkRadioSel.options).find(function(o) { return !o.disabled; });
        if (_repFree) { uplinkRadioSel.value = _repFree.value; } else { _repBlocked = true; }

        var passIn      = inputField('', 'Upstream password', 'password');
        var localSsidIn = inputField('', 'Local SSID');
        var localPassIn = inputField('', 'Local password', 'password');
        var apRadioSel  = selectEl([['radio0','2.4 GHz'],['radio1','5 GHz']], 'radio0');

        var _repRefreshTimer = null;

        function renderRepRows(data) {
            while (scanArea.firstChild) scanArea.removeChild(scanArea.firstChild);
            data.forEach(function(n) {
                var b = (n.mhz >= 5925) ? 6 : (n.mhz >= 5000) ? 5 : 2;
                if (b === 6) return; // 6 GHz STA not supported (driver limitation)
                var bandRadio = b === 5 ? 'radio1' : 'radio0';
                var sigPct = n.quality_max ? Math.round(100 * n.quality / n.quality_max) : 0;
                var sigColor = sigPct >= 66 ? '#4caf50' : sigPct >= 33 ? '#f5a623' : '#e53935';
                var r = node('div', {
                    style: 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;' +
                           'margin-bottom:4px;border-radius:4px;cursor:pointer;background:#0d1b2a;border:1px solid #2a3a50'
                },
                    node('div', {},
                        sp(n.ssid || '(hidden)', 'color:#ddd;font-size:13px'),
                        muted('  ' + (n.encryption || 'open'))
                    ),
                    node('div', { style: 'display:flex;align-items:center;gap:8px' },
                        bandPill(bandRadio),
                        node('span', { style: 'color:' + sigColor }, sigPct + '%')
                    )
                );
                r.addEventListener('mouseenter', function() { r.style.background = 'rgba(255,255,255,.06)'; });
                r.addEventListener('mouseleave', function() { r.style.background = '#0d1b2a'; });
                r.onclick = function() {
                    clearInterval(_repRefreshTimer);
                    uplinkRadioSel.value = bandRadio; // sync uplink band to selected network
                    scanArea.style.display = 'none';
                    step2.style.display = 'block';
                    while (step2.firstChild) step2.removeChild(step2.firstChild);
                    step2.appendChild(node('div', { style: 'color:#ddd;margin-bottom:10px;font-size:13px' },
                        'Upstream: ', node('strong', {}, n.ssid || '(hidden)')));
                    if (n.encryption !== 'none')
                        step2.appendChild(formRow('Upstream password', pwdWrap(passIn)));
                    if (apRadioSel.value === uplinkRadioSel.value)
                        apRadioSel.value = apRadioSel.value === 'radio0' ? 'radio1' : 'radio0';
                    step2.appendChild(formRow('Local AP radio', apRadioSel));
                    step2.appendChild(formRow('Local SSID', localSsidIn));
                    step2.appendChild(formRow('Local password', pwdWrap(localPassIn)));
                    var backBtn = btnSecondary('Back', function() {
                        step2.style.display = 'none';
                        scanArea.style.display = 'block';
                    });
                    step2.appendChild(node('div', { style: 'display:flex;gap:8px;margin-top:12px' },
                        btn('Set Up Repeater', null, function() {
                            if (uplinkRadioSel.value === apRadioSel.value) {
                                while (applyDiv.firstChild) applyDiv.removeChild(applyDiv.firstChild);
                                applyDiv.appendChild(inlineErr('Uplink and local AP must use different radios'));
                                return;
                            }
                            var _mloApRids = new Set();
                            (data.mlds || []).filter(function(m) { return m.mode === 'ap'; }).forEach(function(m) {
                                (m.radios || []).forEach(function(r) { _mloApRids.add(r); });
                            });
                            var apRid = apRadioSel.value;
                            if (_mloApRids.has(apRid)) {
                                var apCount = (data.ifaces || []).filter(function(i) {
                                    return !i.mlo && i.mode === 'ap' && Array.isArray(i.device) && i.device.indexOf(apRid) !== -1;
                                }).length;
                                if (apCount >= 1) {
                                    while (applyDiv.firstChild) applyDiv.removeChild(applyDiv.firstChild);
                                    applyDiv.appendChild(inlineErr('Local AP radio is at capacity — MLO radio already has a network. Choose the other radio.'));
                                    return;
                                }
                            }
                            if (!localSsidIn.value.trim()) {
                                while (applyDiv.firstChild) applyDiv.removeChild(applyDiv.firstChild);
                                applyDiv.appendChild(inlineErr('Local SSID is required'));
                                return;
                            }
                            applyFlow(applyDiv, function() {
                                return layer3.wizard_repeater(
                                    uplinkRadioSel.value, apRadioSel.value,
                                    { ssid: n.ssid, encryption: n.encryption, key: passIn.value || undefined, network: 'wwan' },
                                    { ssid: localSsidIn.value, key: localPassIn.value || undefined }
                                );
                            }, function() { close(); if (onDone) onDone(); }, setCloseable);
                        }),
                        backBtn
                    ));
                };
                scanArea.appendChild(r);
            });
        }

        function doScan() {
            var repScanRadio = uplinkRadioSel.value;
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning…';
            while (scanErrDiv.firstChild) scanErrDiv.removeChild(scanErrDiv.firstChild);
            layer2.uplink_scan(repScanRadio).then(function(res) {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Scan';
                if (!res.ok || !res.data.length) {
                    while (scanArea.firstChild) scanArea.removeChild(scanArea.firstChild);
                    scanErrDiv.appendChild(inlineErr('No networks found — try again'));
                    return;
                }
                renderRepRows(res.data);
                clearInterval(_repRefreshTimer);
                _repRefreshTimer = setInterval(function() {
                    if (!scanArea.isConnected || step2.style.display !== 'none') return;
                    layer2.uplink_scan(repScanRadio).then(function(newRes) {
                        if (!scanArea.isConnected || step2.style.display !== 'none') return;
                        if (newRes.ok && newRes.data.length) renderRepRows(newRes.data);
                    });
                }, 8000);
            }).catch(function() {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Scan';
                scanErrDiv.appendChild(inlineErr('Scan failed — try again'));
            });
        }

        uplinkRadioSel.addEventListener('change', function() {
            if (apRadioSel.value === uplinkRadioSel.value)
                apRadioSel.value = apRadioSel.value === 'radio0' ? 'radio1' : 'radio0';
        });

        var scanBtn = btnSecondary('Scan', doScan);
        if (_repBlocked) { scanBtn.disabled = true; }

        body.appendChild(node('div', { style: 'color:#666;font-size:12px;margin-bottom:14px;line-height:1.5' },
            'L3 / NAT — connects to upstream WiFi on one radio (STA), re-broadcasts on a different radio (AP). ',
            'Clients get this router\'s LAN IP address.'));
        if (_repBlocked) body.appendChild(node('div', { style: 'color:#e53935;font-size:12px;margin-bottom:10px;padding:8px;background:#3a070744;border-radius:4px;border-left:3px solid #e53935' },
            'Both uplink radios (2.4 GHz and 5 GHz) are part of an MLO group — Repeater is not possible. Remove the MLO network first.'));
        body.appendChild(formRow('Uplink band', uplinkRadioSel));
        body.appendChild(node('div', { style: 'margin:8px 0' }, scanBtn));
        body.appendChild(scanErrDiv);
        body.appendChild(scanArea);
        body.appendChild(step2);
        body.appendChild(applyDiv);
    });
}

function wizardCountry(onDone, data) {
    openModal('Change Country / Regulatory', function(body, close, setCloseable) {
        var COUNTRIES = [['AT','Austria'],['AU','Australia'],['BE','Belgium'],['BR','Brazil'],
            ['CA','Canada'],['CH','Switzerland'],['CN','China'],['CZ','Czech Republic'],
            ['DE','Germany'],['DK','Denmark'],['ES','Spain'],['FI','Finland'],['FR','France'],
            ['GB','United Kingdom'],['HU','Hungary'],['IE','Ireland'],['IT','Italy'],['JP','Japan'],
            ['KR','Korea'],['NL','Netherlands'],['NO','Norway'],['NZ','New Zealand'],['PL','Poland'],
            ['PT','Portugal'],['RU','Russia'],['SE','Sweden'],['SK','Slovakia'],['TR','Turkey'],
            ['TW','Taiwan'],['US','United States']];
        var curCountry = (data && data.radios && data.radios[0]) ? (data.radios[0].country || 'CZ') : 'CZ';
        var countrySel = selectEl(COUNTRIES, curCountry);
        var applyDiv   = node('div', {});

        body.appendChild(node('div', {
            style: 'color:#f5a623;font-size:12px;margin-bottom:12px;padding:8px 10px;background:#2a180044;border-radius:4px;border-left:3px solid #f5a623'
        }, 'Router will reboot after changing the country (~60 seconds to reconnect).'));
        body.appendChild(formRow('Country', countrySel));

        body.appendChild(node('div', { style: 'margin-top:14px' },
            btn('Apply & Reboot', null, function() {
                applyFlow(applyDiv, function() { return layer3.wizard_country(countrySel.value); },
                    function() { close(); if (onDone) onDone(); }, setCloseable);
            })
        ));
        body.appendChild(applyDiv);
    });
}

function scanWidth(bss) {
    var w = '20';
    var ht = bss.ht_op, vht = bss.vht_op, he = bss.he_op, eht = bss.eht_op;
    if (ht) {
        if (ht.secondary_channel_offset === 'above' || ht.secondary_channel_offset === 'below') w = '40';
    }
    if (vht && vht.channel_width > 40) {
        var diff = (vht.center_freq_2 && vht.center_freq_1) ? Math.abs(vht.center_freq_2 - vht.center_freq_1) : 0;
        w = vht.channel_width === 160 ? '160' : diff === 8 ? '160' : diff > 8 ? '80+80' : '80';
    }
    if (he && he.channel_width > 20) w = String(he.channel_width);
    if (eht && eht.channel_width === 320) w = '320';
    return w + ' MHz';
}

function openScanNearby(data) {
    openModal('Nearby Networks', function(body, close) {
        var refreshTimer = null;
        var autoOn = true;

        var tbl = node('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
        var hdr = node('tr', {});
        ['Signal','Band','SSID','Ch','Width','BSSID','Encryption'].forEach(function(h) {
            hdr.appendChild(node('th', { style: 'text-align:left;padding:3px 8px;opacity:.5;font-size:11px;white-space:nowrap' }, h));
        });
        tbl.appendChild(hdr);

        function renderRows(data) {
            while (tbl.rows.length > 1) tbl.deleteRow(1);
            data.forEach(function(bss) {
                var b = (bss.mhz >= 5925) ? 6 : (bss.mhz >= 5000) ? 5 : 2;
                var bandRadio = b === 6 ? 'radio2' : b === 5 ? 'radio1' : 'radio0';
                var sigPct = bss.quality_max ? Math.round(100 * bss.quality / bss.quality_max) : 0;
                var sigColor = sigPct >= 66 ? '#4caf50' : sigPct >= 33 ? '#f5a623' : '#e53935';
                var row = node('tr', { style: 'border-top:1px solid rgba(255,255,255,.06)' });
                row.appendChild(node('td', { style: 'padding:4px 8px' }, node('span', { style: 'color:' + sigColor }, sigPct + '%')));
                row.appendChild(node('td', { style: 'padding:4px 8px' }, bandPill(bandRadio)));
                row.appendChild(node('td', { style: 'padding:4px 8px;color:#ddd;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, bss.ssid || ''));
                row.appendChild(node('td', { style: 'padding:4px 8px;color:#aaa' }, String(bss.channel || '')));
                row.appendChild(node('td', { style: 'padding:4px 8px;color:#aaa;white-space:nowrap' }, scanWidth(bss)));
                row.appendChild(node('td', { style: 'padding:4px 8px;color:#555;font-size:11px;white-space:nowrap' }, bss.bssid || ''));
                row.appendChild(node('td', { style: 'padding:4px 8px;color:#555;font-size:11px' }, bss.encryption || 'open'));
                tbl.appendChild(row);
            });
        }

        function doRefresh() {
            if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
            layer2.uplink_scan_all().then(function(res) {
                if (!tbl.isConnected) { clearInterval(refreshTimer); return; }
                if (res.ok && res.data.length) renderRows(res.data);
            });
        }

        var stopBtn = node('button', {}, '■ Stop');
        stopBtn.style.cssText = 'background:none;border:none;color:#666;cursor:pointer;font-size:11px;padding:0;margin-left:6px';
        stopBtn.onclick = function() {
            autoOn = !autoOn;
            if (autoOn) { refreshTimer = setInterval(doRefresh, 8000); stopBtn.textContent = '■ Stop'; }
            else        { clearInterval(refreshTimer); stopBtn.textContent = '▶ Resume'; }
        };

        var statusRow = node('div', { style: 'display:flex;align-items:center;margin-bottom:8px' },
            node('span', { style: 'color:#555;font-size:11px' }, 'Scanning…'));

        body.appendChild(statusRow);
        body.appendChild(tbl);

        layer2.uplink_scan_all().then(function(res) {
            while (statusRow.firstChild) statusRow.removeChild(statusRow.firstChild);
            if (!res.ok || !res.data.length) {
                statusRow.appendChild(muted('No networks found'));
                return;
            }
            renderRows(res.data);
            statusRow.appendChild(muted('Auto-refresh every 8s ·'));
            statusRow.appendChild(stopBtn);
            refreshTimer = setInterval(doRefresh, 8000);
        });
    });
}

return baseclass.extend({
    wizardAP: wizardAP,
    wizardMLO: wizardMLO,
    wizardStation: wizardStation,
    wizardWDS: wizardWDS,
    wizardRepeater: wizardRepeater,
    wizardCountry: wizardCountry,
    openScanNearby: openScanNearby,
    scanWidth: scanWidth
});
