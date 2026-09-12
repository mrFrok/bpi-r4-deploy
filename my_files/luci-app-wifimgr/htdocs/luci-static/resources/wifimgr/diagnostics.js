// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/ui as ui';
'require wifimgr/layer2 as layer2';

// Diagnostics tab: firmware/thermal, per-radio stats, country, wireless
// backup/restore, kernel, MLO internals, TX power, logs.
// render(diag, data) - diag from layer3.load_diag(); data = main poll data.

var node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, renderUtilHistory = ui.renderUtilHistory, card = ui.card, lbl = ui.lbl, btnSecondary = ui.btnSecondary, collapsible = ui.collapsible;

function render(diag, data) {
    var el  = node('div', {});

    if (!diag) {
        el.appendChild(node('div', { style: 'color:#555;padding:20px 0' }, 'Loading diagnostics...'));
        return el;
    }

    var sysinfo = diag.sysinfo || {};
    var radios  = (data && data.radios)  || [];
    var clients = (data && data.clients) || [];

    // Thermal inline — compact, tucked into Firmware card footer
    var wifiTemp = sysinfo.wifi_temp || {};
    var thermal  = sysinfo.thermal  || {};
    var TEMP_BANDS = [['band0','2.4G'],['band1','5G'],['band2','6G']];
    var socTemps = ['eth2p5g-thermal','eth2p5g-1-thermal'].map(function(n) { return thermal[n]; }).filter(function(v) { return v != null; });
    var tempRow = node('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:6px;border-top:1px solid #1a2a3a' },
        sp('Temp:', 'color:#444;font-size:11px')
    );
    TEMP_BANDS.forEach(function(b) {
        var mc = wifiTemp[b[0]];
        if (mc == null) return;
        var t = Math.round(mc / 1000);
        var c = t > 80 ? '#e24b4a' : t > 65 ? '#f5a623' : '#1d9e75';
        tempRow.appendChild(sp(b[1] + ' ' + t + '°', 'font-size:11px;color:' + c));
    });
    if (socTemps.length) {
        var st = Math.round(Math.max.apply(null, socTemps) / 1000);
        tempRow.appendChild(sp('SoC ' + st + '°', 'font-size:11px;color:#444'));
    }

    // FW version + temp footer
    el.appendChild(card(
        sp('FIRMWARE', 'display:block;color:#88888899;font-size:11px;font-weight:bold;margin-bottom:6px;letter-spacing:0.5px'),
        node('pre', { style: 'color:#aaa;font-size:12px;font-family:monospace;margin:0;white-space:pre-wrap;word-break:break-all' },
            sysinfo.fw_version || '—'),
        tempRow
    ));

    // Per-radio WiFi stats card
    if (radios.length) {
        var statsCard = card(
            sp('RADIO STATS', 'display:block;color:#88888899;font-size:11px;font-weight:bold;margin-bottom:10px;letter-spacing:0.5px')
        );
        var activeRadios = radios.filter(function(r) { return r.up; });
        activeRadios.forEach(function(r, ri) {
            var clientCount = clients.filter(function(c) {
                var phyIdx = r.id.replace('radio', '');
                return c.ifname && c.ifname.indexOf('phy0.' + phyIdx) === 0;
            }).length;
            var row = node('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' +
                (ri < activeRadios.length - 1 ? ';margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #0d1b2a' : '') });
            row.appendChild(bandPill(r.id));
            var fields = [];
            if (r.channel)                fields.push(['CH',      String(r.channel)]);
            fields.push(['Util', r.chan_util != null ? Math.min(r.chan_util, 100) + '%' : 'n/a']);
            if (r.noise != null)          fields.push(['Noise',   r.noise + ' dBm']);
            if (r.txpower_actual != null) fields.push(['TX',      r.txpower_actual + ' dBm']);
            fields.push(['Clients', String(clientCount)]);
            fields.forEach(function(f) {
                row.appendChild(node('span', { style: 'font-size:12px;white-space:nowrap' },
                    sp(f[0] + ' ', 'color:#555'), sp(f[1], 'color:#ccc')));
            });
            statsCard.appendChild(row);
            var uSparkEl = node('div', { style: 'font-family:monospace;font-size:14px;letter-spacing:2px;padding-left:42px;margin-top:3px' });
            var uStatsEl = node('div', { style: 'color:#555;font-size:11px;padding-left:42px;margin-bottom:' + (ri < activeRadios.length - 1 ? '8' : '2') + 'px' });
            renderUtilHistory(r.id, uSparkEl, uStatsEl);
            statsCard.appendChild(uSparkEl);
            statsCard.appendChild(uStatsEl);
        });
        el.appendChild(statsCard);
    }

    // Country
    el.appendChild(card(
        node('div', {}, lbl('Country'), node('div', { style: 'color:#ddd;font-size:16px;font-weight:bold;margin-top:2px' }, sysinfo.country || '—'))
    ));

    // Wireless config backup/restore
    (function() {
        var _wcStatus = sp('', 'font-size:12px;color:#555;margin-left:8px');
        var _wcFileIn = node('input', { type: 'file', accept: '.txt,.uci', style: 'display:none' });
        var _wcDlBtn  = btnSecondary('Download backup', function() {
            _wcStatus.textContent = 'Reading…';
            layer2.wireless_backup().then(function(res) {
                if (!res.ok) { _wcStatus.textContent = 'Error: read failed'; return; }
                var d = new Date();
                var fname = 'wireless-' + d.getFullYear() + '-' +
                    String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0') + '.txt';
                var blob = new Blob([res.data], { type: 'text/plain' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fname;
                a.click();
                URL.revokeObjectURL(a.href);
                _wcStatus.textContent = 'Downloaded — ' + fname;
            });
        });
        _wcDlBtn.style.cssText = 'font-size:12px;padding:3px 12px';
        var _wcRestBtn = btnSecondary('Upload & Restore', function() { _wcFileIn.click(); });
        _wcRestBtn.style.cssText = 'font-size:12px;padding:3px 12px';
        _wcFileIn.addEventListener('change', function() {
            var f = _wcFileIn.files && _wcFileIn.files[0];
            if (!f) return;
            _wcStatus.textContent = 'Uploading…';
            var reader = new FileReader();
            reader.onload = function(ev) {
                layer2.wireless_restore(ev.target.result).then(function(res) {
                    _wcStatus.textContent = res.ok
                        ? 'Restored — wifi reloading…'
                        : 'Error: ' + (res.error || 'failed');
                });
            };
            reader.readAsText(f);
        });
        el.appendChild(card(
            sp('WIRELESS CONFIG', 'display:block;color:#88888899;font-size:11px;font-weight:bold;margin-bottom:10px;letter-spacing:0.5px'),
            node('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
                _wcFileIn, _wcDlBtn, _wcRestBtn, _wcStatus
            ),
            node('div', { style: 'color:#555;font-size:11px;margin-top:6px' },
                'Before sysupgrade: download backup. After sysupgrade: upload & restore.')
        ));
    })();

    // Kernel
    if (sysinfo.kernel) {
        el.appendChild(card(collapsible('diag_kernel', 'Kernel', function() {
            return node('pre', { style: 'color:#666;font-size:11px;margin:6px 0 0;white-space:pre-wrap;word-break:break-all' }, sysinfo.kernel);
        }, false)));
    }

    // MLO internals
    var mlds = (data && data.mlds) || [];
    if (mlds.length) {
        el.appendChild(card(collapsible('diag_mld', 'MLO / WiFi 7', function() {
            var wrap = node('div', { style: 'margin-top:6px' });
            mlds.forEach(function(m, mi) {
                if (mi > 0) wrap.appendChild(node('div', { style: 'margin-top:10px;padding-top:10px;border-top:1px solid #0d1b2a' }));
                var hdr = node('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px' });
                hdr.appendChild(sp('"' + (m.ssid || '?') + '"', 'color:#ddd;font-weight:bold;font-size:12px'));
                hdr.appendChild(sp(m.ifname || '?', 'color:#777;font-size:11px;font-family:monospace'));
                wrap.appendChild(hdr);
                var allowedStr = (function() {
                    var v = m.mld_allowed_links;
                    if (v == null) {
                        var bands = (m.radios || []).map(function(r) {
                            return r === 'radio0' ? '2.4G' : r === 'radio1' ? '5G' : r === 'radio2' ? '6G' : r;
                        });
                        return bands.length ? 'all  (' + bands.join(' + ') + ')' : '—';
                    }
                    var bands = [];
                    if (v & 1) bands.push('2.4G');
                    if (v & 2) bands.push('5G');
                    if (v & 4) bands.push('6G');
                    return '0x' + v.toString(16).toUpperCase() + (bands.length ? '  (' + bands.join(' + ') + ')' : '');
                })();
                var emlsrStr = (function() {
                    var t = m.ap_mld_type || '';
                    if (t.indexOf('EMLSR') >= 0) return 'active — ' + t;
                    if (m.eml_disable) return 'disabled';
                    return 'STR (simultaneous TX/RX)';
                })();
                var rows = [
                    ['MLD address',   m.mld_addr  || '—'],
                    ['Active links',  m.num_links != null ? String(m.num_links) : '—'],
                    ['Allowed links', allowedStr],
                    ['EMLSR',         emlsrStr],
                ];
                rows.forEach(function(f) {
                    wrap.appendChild(node('div', { style: 'display:flex;gap:8px;font-size:12px;margin-bottom:3px' },
                        sp(f[0], 'color:#888;min-width:100px;flex-shrink:0'), sp(f[1], 'color:#ccc;font-family:monospace')));
                });
                if (m.links && m.links.length) {
                    wrap.appendChild(sp('Per-link:', 'display:block;color:#888;font-size:12px;margin:8px 0 4px'));
                    m.links.forEach(function(lk) {
                        var band = lk.freq < 3000 ? '2.4G' : lk.freq < 5900 ? '5G' : '6G';
                        var lstr = 'link' + (lk.link_id != null ? lk.link_id : '?') +
                            '  ' + band +
                            (lk.freq   ? '  ' + lk.freq + ' MHz'   : '') +
                            (lk.channel ? '  CH' + lk.channel      : '') +
                            (lk.bw_mhz  ? '  ' + lk.bw_mhz + ' MHz BW' : '') +
                            (lk.bssid   ? '  ' + lk.bssid          : '') +
                            (lk.dfs_active ? '  [CAC]'             : '');
                        wrap.appendChild(node('div', { style: 'font-size:12px;color:#999;font-family:monospace;padding-left:8px;margin-bottom:2px' }, lstr));
                    });
                }

                // ── MLD Capabilities breakdown (collapsible) ───────────────
                var _mi = mi, _m = m;
                wrap.appendChild(node('div', { style: 'margin-top:10px;padding-top:8px;border-top:1px solid #1e3040' },
                    collapsible('diag_mld_caps_' + _mi, 'MLD Capabilities detail  (IEEE 802.11be)', function() {
                        var capsDiv = node('div', { style: 'margin-top:6px' });

                        // Hex derivation note
                        capsDiv.appendChild(node('pre', { style: 'font-size:11px;color:#6080a0;font-family:monospace;margin:0 0 10px;line-height:1.8;white-space:pre-wrap' },
                            '  0x0062  driver base (MT7996 · mt7996/init.c)\n' +
                            '+ 0x2000  Link Reconfiguration  (hostapd unconditional)\n' +
                            '+ 0x0020  TID-to-Link All-to-All  (hostapd unconditional)\n' +
                            '+ link_id  per-link active_links  (varies per beacon element)\n' +
                            '= 0x2062 / 0x2061  (beacon frames · tshark wlan.mle.mld_capa)'));

                        function capRow(label, value, valColor, note) {
                            var r = node('div', { style: 'display:flex;gap:0;font-size:12px;margin-bottom:4px;align-items:baseline' });
                            r.appendChild(sp(label, 'color:#888;min-width:200px;flex-shrink:0'));
                            r.appendChild(sp(value, 'color:' + valColor + ';min-width:130px;flex-shrink:0;font-family:monospace'));
                            r.appendChild(sp(note,  'color:#6a8a70;font-size:11px'));
                            return r;
                        }
                        capsDiv.appendChild(capRow('Max simultaneous links',   '2  (3-band capable)', '#ccc',    'MT7996 · mld_capa_and_ops bits 0–3'));
                        capsDiv.appendChild(capRow('TID-to-Link negotiation',  'DIFF  (mode 3)',       '#ccc',    'MT7996 · IEEE80211_MLD_CAP_OP_TID_TO_LINK_MAP_NEG_SUPP_DIFF'));
                        capsDiv.appendChild(capRow('Link Reconfiguration',     'advertised  ⚠',       '#f5a623', 'firmware unconditional · EHT_ML_MLD_CAPA_LINK_RECONF_OP_SUPPORT · not functional'));
                        capsDiv.appendChild(capRow('TID-to-Link All-to-All',   'advertised  ⚠',       '#f5a623', 'firmware unconditional · TODO comment in hostapd source'));
                        capsDiv.appendChild(capRow('Aligned TWT',              'not supported',        '#666',    'MT7996 Connac 3 · intentionally omitted from driver + hostapd'));

                        // EMLSR sub-section
                        capsDiv.appendChild(node('div', { style: 'margin-top:10px;padding-top:8px;border-top:1px solid #1e3040;color:#999;font-size:12px;letter-spacing:0.3px;font-weight:bold;margin-bottom:6px' },
                            'EMLSR  (Enhanced Multi-Link Single Radio)'));

                        var emlDis = !!_m.eml_disable;
                        capsDiv.appendChild(capRow('EMLSR support',              'advertised in beacon',   '#ccc',    'MT7996 driver · NL80211_ATTR_EML_CAPABILITY · AP iftype only'));
                        capsDiv.appendChild(capRow('EMLSR on one link',          'disabled  (default)',    '#666',    'emlsr_on_one_link=0 · hostapd opt-in · not yet in netifd UCI'));
                        capsDiv.appendChild(capRow('Extended MLD Cap in beacon',
                            emlDis ? 'suppressed' : 'not present',
                            emlDis ? '#e24b4a' : '#666',
                            emlDis ? 'eml_disable=1 · ML Control bit 10 = 0 · subelement omitted'
                                   : 'emlsr_on_one_link=0 · ML Control bit 10 = 0 · no Extended MLD Cap subelement'));
                        capsDiv.appendChild(capRow('SDK patch',                  '0237-mtk-hostapd',      '#666',    'add-support-for-emlsr-enablement-on-one-link · ML Control bit + subelement gated symmetrically'));

                        // tshark hint
                        capsDiv.appendChild(node('div', {
                            style: 'margin-top:10px;font-size:11px;color:#6a9a70;font-family:monospace;overflow-x:auto;white-space:nowrap;padding:6px 8px;background:#0a1510;border-radius:3px'
                        }, 'tshark -r cap.pcap -Y \'wlan.fc.type_subtype==8\' -T fields -e wlan.mle.mld_capa -e wlan_radio.frequency 2>/dev/null | sort -u'));

                        return capsDiv;
                    }, false)
                ));
            });
            return wrap;
        }, false)));
    }

    // TX power info per band
    var BAND_NAMES = ['2.4 GHz', '5 GHz', '6 GHz'];
    (diag.txpower || []).forEach(function(raw, i) {
        if (!raw) return;
        el.appendChild(card(collapsible('diag_txp' + i, 'TX Power Info — ' + BAND_NAMES[i], function() {
            return node('pre', { style: 'color:#666;font-size:11px;margin:6px 0 0;overflow-x:auto;white-space:pre-wrap' }, raw);
        }, false)));
    });

    // Logs
    if (diag.logs) {
        el.appendChild(card(collapsible('diag_logs', 'System Logs', function() {
            var tail = diag.logs.split('\n').slice(-100).join('\n');
            var dlBtn = btnSecondary('Download .txt', function() {
                var blob = new Blob([diag.logs], { type: 'text/plain' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'wifimgr-syslog.txt';
                a.click();
            });
            dlBtn.style.cssText = 'margin-bottom:6px;font-size:11px;padding:2px 10px';
            var wrap = node('div', { style: 'margin-top:6px' });
            wrap.appendChild(dlBtn);
            wrap.appendChild(node('pre', { style: 'color:#555;font-size:11px;max-height:280px;overflow-y:auto;margin:6px 0 0;white-space:pre-wrap' }, tail));
            return wrap;
        }, false)));
    }

    return el;
}

return baseclass.extend({ render: render });
