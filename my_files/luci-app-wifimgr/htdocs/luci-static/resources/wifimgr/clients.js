// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/ui as ui';
'require wifimgr/layer2 as layer2';

// Clients tab: connected stations, per-client signal/rate, MLO link detail.
// render(data) - data = main poll data (radios/clients/mlds).

var node = ui.node, sp = ui.sp, div = ui.div, bandPill = ui.bandPill, signalBars = ui.signalBars, modeBadge = ui.modeBadge, clientLinkBand = ui.clientLinkBand, parseBitrate = ui.parseBitrate, bestClientSignal = ui.bestClientSignal, bestClientSpeed = ui.bestClientSpeed, bestClientDetail = ui.bestClientDetail, card = ui.card, rowEl = ui.rowEl, lbl = ui.lbl, val = ui.val, muted = ui.muted, btnDanger = ui.btnDanger, inlineErr = ui.inlineErr, successBadge = ui.successBadge, collapsible = ui.collapsible, formatDuration = ui.formatDuration;

function render(data) {
    var clients = data.clients || [];
    var el      = node('div', {});

    var ssidMap = {};
    (data.ifaces || []).forEach(function(f) { if (f.ifname && f.ssid) ssidMap[f.ifname] = f.ssid; });
    (data.mlds   || []).forEach(function(m) { if (m.ifname && m.ssid) ssidMap[m.ifname] = m.ssid; });

    var eht  = clients.filter(function(c) { return c.is_mld; }).length;
    var sigs = clients.map(function(c) { return bestClientSignal(c); }).filter(function(s) { return s != null; });
    var avg  = sigs.length ? Math.round(sigs.reduce(function(a,b){ return a+b; }, 0) / sigs.length) : null;

    el.appendChild(node('div', { style: 'color:#666;font-size:12px;margin-bottom:12px' },
        'Total: ' + clients.length + ' client' + (clients.length !== 1 ? 's' : '') +
        (eht ? ' · WiFi 7: ' + eht : '') +
        (avg != null ? ' · Average signal: ' + avg + ' dBm' : '')
    ));

    if (!clients.length) {
        el.appendChild(node('div', { style: 'color:#444;padding:20px 0;font-size:14px' }, 'No clients connected.'));
        return el;
    }

    clients.forEach(function(c) {
        var mac_key = c.mac.replace(/:/g, '');

        // ── HEADER (always visible) ───────────────────────────────────────
        var hdrEl = node('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' });
        hdrEl.appendChild(sp(c.mac, 'color:#ddd;font-family:monospace;font-size:13px'));

        // WiFi gen badge
        var mb = modeBadge((c.tx_bitrate || '') + ' ' + (c.rx_bitrate || ''), c.is_mld);
        if (mb) hdrEl.appendChild(mb);

        // Band pills per active link (or from iface for legacy)
        if (c.links && c.links.length) {
            c.links.forEach(function(lk) {
                var rid = clientLinkBand(c.ifname, lk.link_id, data);
                if (rid) hdrEl.appendChild(bandPill(rid));
            });
        } else {
            var iface = (data.ifaces || []).find(function(f) { return f.ifname === c.ifname; });
            if (iface && iface.device) hdrEl.appendChild(bandPill(Array.isArray(iface.device) ? iface.device[0] : iface.device));
        }

        // Signal (best per-link for MLO — iw top-level is 0 for MLO)
        hdrEl.appendChild(signalBars(bestClientSignal(c)));

        // Best speed
        var spd = bestClientSpeed(c);
        if (spd) hdrEl.appendChild(muted(spd));
        var det = bestClientDetail(c);
        if (det) hdrEl.appendChild(sp(det, 'font-size:11px;color:#555;font-family:monospace'));

        // Connected time
        if (c.connected_time) hdrEl.appendChild(muted(formatDuration(c.connected_time)));

        // SSID
        if (c.ifname) {
            var cSsid = ssidMap[c.ifname];
            if (cSsid) hdrEl.appendChild(sp('"' + cSsid + '"', 'color:#85b7eb;font-size:12px'));
        }

        // ── BODY (expanded) ───────────────────────────────────────────────
        var deauthDiv = node('div', {});
        var bodyFn = function() {
            var b = node('div', { style: 'margin-top:8px' });

            if (c.flags && c.flags.length) {
                var flags = node('div', { style: 'margin-bottom:8px' });
                c.flags.forEach(function(f) {
                    flags.appendChild(sp(f, 'font-size:11px;padding:1px 6px;background:#1a2a4a;color:#85b7eb;border-radius:3px;margin-right:4px'));
                });
                b.appendChild(flags);
            }

            // For legacy (non-MLO) show TX/RX as plain text; for MLO the per-link table has the real data
            if (!c.is_mld) {
                b.appendChild(rowEl(lbl('TX / RX'), val((c.tx_bitrate || '?') + ' / ' + (c.rx_bitrate || '?'))));
            }

            // Per-link table
            if (c.links && c.links.length) {
                b.appendChild(sp('Per-link', 'display:block;color:#888;font-size:12px;margin:8px 0 4px'));
                var tbl = node('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
                var th = node('tr', { style: 'color:#555' });
                ['Band', 'Signal', '↓ Download', '↑ Upload'].forEach(function(h) {
                    th.appendChild(node('th', { style: 'text-align:left;padding:2px 6px;font-weight:normal' }, h));
                });
                tbl.appendChild(th);
                c.links.forEach(function(lk) {
                    var tr = node('tr', { style: 'color:#aaa;vertical-align:top' });
                    // Band
                    var bandTd = node('td', { style: 'padding:4px 6px' });
                    var rid = clientLinkBand(c.ifname, lk.link_id, data);
                    if (rid) bandTd.appendChild(bandPill(rid)); else bandTd.appendChild(document.createTextNode('—'));
                    tr.appendChild(bandTd);
                    // Signal — 0 means unmeasured/idle
                    var sigTd = node('td', { style: 'padding:4px 6px;white-space:nowrap' });
                    var lkSig = (typeof lk.signal === 'number' && lk.signal < 0) ? lk.signal : null;
                    var _lkRadio = rid ? (data.radios || []).find(function(r) { return r.id === rid; }) : null;
                    var _lkNoise = _lkRadio && _lkRadio.noise != null ? _lkRadio.noise : null;
                    if (lkSig != null) {
                        var sc = lkSig >= -65 ? '#1d9e75' : lkSig >= -75 ? '#f5a623' : '#e24b4a';
                        sigTd.appendChild(sp(lkSig + (_lkNoise != null ? ' / ' + _lkNoise : '') + ' dBm', 'color:' + sc));
                    } else {
                        sigTd.appendChild(sp('—', 'color:#444'));
                    }
                    tr.appendChild(sigTd);
                    // RX (download) then TX (upload) — speed + detail on two lines
                    [lk.rx_bitrate, lk.tx_bitrate].forEach(function(bitrateStr) {
                        var td = node('td', { style: 'padding:4px 6px' });
                        var p = parseBitrate(bitrateStr);
                        if (p && p.speed) {
                            td.appendChild(node('div', {}, p.speed));
                            if (p.detail) td.appendChild(node('div', { style: 'color:#555;font-size:11px;margin-top:1px' }, p.detail));
                        } else {
                            td.appendChild(sp('—', 'color:#444'));
                        }
                        tr.appendChild(td);
                    });
                    tbl.appendChild(tr);
                });
                b.appendChild(tbl);
            }

            b.appendChild(node('div', { style: 'margin-top:10px' },
                btnDanger('Disconnect client', function() {
                    if (!confirm('Disconnect ' + c.mac + '?')) return;
                    layer2.clients_deauth(c.ifname, c.mac).then(function(r) {
                        while (deauthDiv.firstChild) deauthDiv.removeChild(deauthDiv.firstChild);
                        deauthDiv.appendChild(r.ok ? successBadge('Disconnected') : inlineErr('Failed'));
                    });
                }),
                deauthDiv
            ));
            return b;
        };

        // MLO clients open by default — per-link info is the interesting part
        el.appendChild(card(collapsible('cli_' + mac_key, hdrEl, bodyFn, c.is_mld)));
    });

    return el;
}

return baseclass.extend({ render: render });
