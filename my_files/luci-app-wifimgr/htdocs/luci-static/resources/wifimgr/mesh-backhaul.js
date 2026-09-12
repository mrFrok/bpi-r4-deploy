// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/layer1 as layer1';
'require wifimgr/layer2 as layer2';

// Mesh backhaul — backend-neutral interface + Extender (WDS-MLO) backend.
//
// The interface (backhaul_setup / backhaul_status / backhaul_teardown) is STABLE
// across backends. EasyMesh v2 will add an 'easymesh' backend (ieee1905 +
// OneWifi/prplMesh) behind the SAME shape — nothing above this file is rewritten.
// Backend choice = BACKHAUL_BACKEND constant (mirrors ROAM_BACKEND in layer1).

const BACKHAUL_BACKEND = 'extender';   // 'extender' (WDS-MLO) | future: 'easymesh'
const BACKHAUL_RADIO   = 'radio1';     // 5 GHz primary backhaul link (research: 5G > 6G)

// ── EXTENDER BACKEND (WDS-MLO, non-disruptive) ──────────────────────────────
// Unlike the old release_5g model, this does NOT touch MLD composition:
//   controller: add wds='1' to the EXISTING serving MLD AP -> hostapd spawns a
//               4addr AP_VLAN child per agent (ap-mld-1.staN) into br-lan.
//               Serving MLD keeps 2.4+5+6 for clients. HW-verified 2026-07-10.
//   agent:      STA-uplink 4addr on the backhaul radio, bridged into lan.
const extender = {
    // controller: enable WDS on the serving MLD AP (clients keep 2.4+5+6)
    async setup_controller() {
        const mldRes = await layer2.mld_get_all();
        const mlds   = mldRes.ok ? mldRes.data : [];
        const mld    = (mlds || []).find(function(m) { return m.mode === 'ap'; });
        if (!mld)
            return { ok: false, sid: null, errors: ['no serving MLO AP found — create an MLO AP first'] };
        const wRes = await layer1.uci_write('wireless', mld.sid, {
            wds: '1', ieee80211w: '2', sae_pwe: '1'
        });
        if (!wRes.ok) return { ok: false, sid: null, errors: ['failed to enable WDS on the MLD AP'] };
        return { ok: true, sid: mld.sid, errors: [] };
    },

    // agent: STA-uplink MLD 4addr to the controller's backhaul (bridged into lan)
    async setup_agent(params) {
        const { ssid, key, bssid } = params || {};
        // idempotence guard: if a backhaul STA already exists, refuse a second
        // one — two 4addr uplinks into br-lan form an L2 loop -> broadcast storm
        // (learned the hard way 2026-07-10). Backs up the wizard's role guard.
        const ifRes = await layer2.iface_get_all();
        const dup = (ifRes.ok ? ifRes.data : []).find(function(i) {
            return i.mode === 'sta' && i.wds && (i.device || []).indexOf(BACKHAUL_RADIO) !== -1;
        });
        if (dup) return { ok: false, sid: dup.sid, errors: ['backhaul already active — disable mesh first'] };
        const write = {
            mlo: '1', wds: '1', network: 'lan',
            ssid: ssid, key: key, encryption: 'sae',
            sae_pwe: '1', ieee80211w: '2', mld_force_single_link: '0'
        };
        if (bssid) write.bssid = bssid;
        return layer2.iface_add(BACKHAUL_RADIO, 'sta', write);
    },

    // teardown: agent -> remove STA iface; controller -> clear wds on the MLD AP
    async teardown(role, sid) {
        if (role === 'agent') return layer2.iface_remove(sid);
        return layer1.uci_write('wireless', sid, { wds: '0' });
    }
};

const BACKENDS = { extender: extender };
function backend() { return BACKENDS[BACKHAUL_BACKEND]; }

// ── BACKEND-NEUTRAL INTERFACE ───────────────────────────────────────────────

// role: 'controller' | 'agent'   ·   opts: { ssid, key, bssid? }
async function backhaul_setup(role, opts) {
    if (role === 'agent') {
        const errors = [];
        if (!opts || !opts.ssid) errors.push('ssid is required');
        if (!opts || !opts.key)  errors.push('key is required (backhaul must be encrypted)');
        if (errors.length) return { ok: false, sid: null, errors };
        return backend().setup_agent(opts);
    }
    return backend().setup_controller();
}

// abstract peer model {role, backend, peer_up, peers:[{mac,signal,tx,rx}]}
// (extender-specific peer read comes in the next step; passthrough for now)
async function backhaul_status() {
    const s = await layer2.backhaul_status();
    if (s && s.ok && s.data) s.data.backend = BACKHAUL_BACKEND;
    return s;
}

async function backhaul_teardown(role, sid) { return backend().teardown(role, sid); }

// ── MESH CLIENT APs (tri-band serving) ──────────────────────────────────────
// One roaming network for clients on 2.4 + 6 GHz (5 GHz stays backhaul). Same
// SSID on every node = one network they roam across. 11k/v (bss_transition +
// neighbor reports) is set so usteer can steer "sticky" clients gracefully.
const CLIENT_RADIOS = ['radio0', 'radio2'];   // 2.4G + 6G ; radio1 = backhaul

async function client_ap_setup(ssid, key) {
    const errors = [];
    if (!ssid) errors.push('mesh network name is required');
    if (!key)  errors.push('mesh password is required');
    if (errors.length) return { ok: false, errors: errors };

    // idempotence: skip a radio that already serves this SSID (avoid duplicates)
    const ifRes    = await layer2.iface_get_all();
    const existing = ifRes.ok ? ifRes.data : [];

    for (const radio of CLIENT_RADIOS) {
        const dup = existing.find(function(i) {
            return i.mode === 'ap' && i.ssid === ssid && (i.device || []).indexOf(radio) !== -1;
        });
        if (dup) continue;
        const is6G = radio === 'radio2';
        const res = await layer2.iface_add(radio, 'ap', {
            ssid: ssid, key: key,
            encryption: is6G ? 'sae' : 'sae-mixed',
            network: 'lan', allowDupSsid: true,   // mesh: same SSID on 2.4+6 GHz is intentional
            bss_transition: '1', ieee80211k: '1', rrm_neighbor_report: '1'   // roaming (11k/v)
        });
        if (!res.ok) errors.push('client AP on ' + radio + ': ' + ((res.errors || []).join('; ')));
    }
    return { ok: errors.length === 0, errors: errors };
}

// remove all client APs matching this mesh SSID (on the client radios)
async function client_ap_teardown(ssid) {
    const ifRes = await layer2.iface_get_all();
    const ifaces = ifRes.ok ? ifRes.data : [];
    for (const i of ifaces) {
        if (i.mode === 'ap' && i.ssid === ssid &&
            (i.device || []).some(function(d) { return CLIENT_RADIOS.indexOf(d) !== -1; }))
            await layer2.iface_remove(i.sid);
    }
    return { ok: true, errors: [] };
}

// remember the mesh client SSID (in mesh.global) so disable can find & remove
// exactly the mesh client APs later, without touching other APs.
async function save_client_ssid(ssid) {
    return layer1.uci_write('mesh', 'global', { client_ssid: ssid || '' });
}
async function client_ap_teardown_saved() {
    const r = await layer1.uci_read('mesh');
    const g = (r.ok && r.data && r.data.mesh) ? r.data.mesh.global : null;
    const ssid = (g && g.client_ssid) ? g.client_ssid : '';
    if (!ssid) return { ok: true, errors: [] };
    return client_ap_teardown(ssid);
}

// Agent = pure L2 extender: don't run a DHCP server on lan (the controller does).
// Without this a bridged br-lan would have two DHCP servers = chaos.
async function agent_l2_setup()    { return layer1.uci_write('dhcp', 'lan', { ignore: '1' }); }
async function agent_l2_teardown() { return layer1.uci_write('dhcp', 'lan', { ignore: '0' }); }

return baseclass.extend({
    BACKHAUL_BACKEND: BACKHAUL_BACKEND,
    BACKHAUL_RADIO:   BACKHAUL_RADIO,
    backhaul_setup:   backhaul_setup,
    backhaul_status:  backhaul_status,
    backhaul_teardown: backhaul_teardown,
    client_ap_setup:  client_ap_setup,
    client_ap_teardown: client_ap_teardown,
    save_client_ssid: save_client_ssid,
    client_ap_teardown_saved: client_ap_teardown_saved,
    agent_l2_setup:   agent_l2_setup,
    agent_l2_teardown: agent_l2_teardown
});
