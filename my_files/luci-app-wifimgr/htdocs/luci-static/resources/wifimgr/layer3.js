// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2026 Petr Wozniak <petr.wozniak@gmail.com>

'use strict';
'require baseclass';
'require wifimgr/layer2 as layer2';
'require wifimgr/mesh-backhaul as meshbh';

// Layer 3: wizard orchestration. Calls Layer 2 + mesh feature modules.
// Wizards make all UCI changes then fire system_apply.
// The view handles progress UI by polling layer2.system_apply_poll() independently.

// --- DATA LOADERS ---

// Load all tab data in parallel. Returns a flat data object for the view.
async function load_all() {
    const [radiosRes, ifacesRes, mldsRes, clientsRes, uplinksRes, sysinfoRes, relaydRes] =
        await Promise.all([
            layer2.radio_get_all(),
            layer2.iface_get_all(),
            layer2.mld_get_all(),
            layer2.clients_get_all(),
            layer2.uplink_get_all(),
            layer2.system_get_info(),
            layer2.relayd_get()
        ]);
    return {
        radios:  radiosRes.ok  ? radiosRes.data  : [],
        ifaces:  ifacesRes.ok  ? ifacesRes.data  : [],
        mlds:    mldsRes.ok    ? mldsRes.data     : [],
        clients: clientsRes.ok ? clientsRes.data  : [],
        uplinks: uplinksRes.ok ? uplinksRes.data  : [],
        sysinfo: sysinfoRes.ok ? sysinfoRes.data  : null,
        relayd:  relaydRes.ok  ? relaydRes.data   : { active: false, uplink_net: null },
        _errors: [
            !radiosRes.ok  ? 'radio_get_all: '  + radiosRes.error : null,
            !ifacesRes.ok  ? 'iface_get_all: '  + ifacesRes.error : null,
            !mldsRes.ok    ? 'mld_get_all: '    + mldsRes.error   : null,
            !clientsRes.ok ? 'clients_get_all: '+ clientsRes.error: null,
        ].filter(Boolean)
    };
}

// Load diagnostics data (heavier, not polled at main interval).
async function load_diag() {
    const [sysinfoRes, logsRes, tp0, tp1, tp2] = await Promise.all([
        layer2.system_get_info(),
        layer2.system_get_logs(),
        layer2.system_get_txpower_info(0),
        layer2.system_get_txpower_info(1),
        layer2.system_get_txpower_info(2)
    ]);
    return {
        sysinfo: sysinfoRes.ok ? sysinfoRes.data : null,
        logs:    logsRes,
        txpower: [tp0, tp1, tp2]
    };
}

// Load channel list (for Radios tab ACS/channel selector).
async function load_channels() {
    const res = await layer2.radio_get_channels('radio0');
    return res.ok ? res.data : [];
}

// Scan available APs on a radio (for Uplink/STA wizard).
async function scan(radio_id) {
    const res = await layer2.uplink_scan(radio_id);
    return res.ok ? res.data : [];
}

// --- APPLY FLOW ---

// Start wifi restart (fire-and-forget for the view).
// The view polls system_apply_poll() independently for progress.
// Returns immediately so the view can start showing the progress bar.
function start_apply(type) {
    layer2.system_apply(type); // intentionally not awaited
}

// Poll current restart phase (called by view every 3s during progress).
async function poll_apply() {
    return layer2.system_apply_poll();
}

// --- WIZARDS ---

// Wizard: Add single-radio AP.
// Returns { ok, sid, restartRequired, errors, warnings }.
async function wizard_ap(radio_id, params) {
    const enc   = params.encryption || (radio_id === 'radio2' ? 'sae' : 'psk2');
    const write = Object.assign({ encryption: enc }, params);
    delete write.radio_id;

    // If this radio is part of an MLO AP, wifi reload would crash (EDCCA).
    // Write UCI and reboot instead.
    const mldsRes = await layer2.mld_get_all();
    const mlds = (mldsRes && mldsRes.ok !== false) ? (Array.isArray(mldsRes) ? mldsRes : (mldsRes.data || [])) : [];
    const isMloRadio = mlds.some(function(m) {
        return m.mode === 'ap' && Array.isArray(m.radios) && m.radios.indexOf(radio_id) !== -1;
    });

    const res = await layer2.iface_add(radio_id, 'ap', write);
    if (!res.ok) return { ok: false, sid: null, restartRequired: 'none', errors: res.errors || [] };

    return { ok: true, sid: res.sid, restartRequired: 'reboot', errors: [] };
}

// Wizard: MLO setup (multi-radio AP).
// radio_ids: array of radio IDs (min 2).
// Returns { ok, sid, restartRequired, errors }.
async function wizard_mlo(radio_ids, params) {
    const enc   = params.encryption || 'sae-mixed';
    const write = Object.assign({ encryption: enc }, params);

    const res = await layer2.mld_add(radio_ids, write);
    if (!res.ok) return { ok: false, sid: null, restartRequired: 'none', errors: res.errors || [] };

    return { ok: true, sid: res.sid, restartRequired: 'reboot', errors: [] };
}

// Wizard: Connect as STA (uplink) on a single radio or MLO.
// params: { ssid, key, encryption, network?, mlo?, mld_assoc_phy?, mld_allowed_phy_bitmap? }.
// For MLO STA: mlo='1' + mld_assoc_phy required (0=2G, 1=5G, 2=6G). mld_allowed_phy_bitmap defaults to 7.
// Returns { ok, sid, restartRequired, errors }.
async function wizard_sta(radio_id, params) {
    const isMlo = params.mlo === '1' || params.mlo === true;
    const enc  = params.encryption || (isMlo ? 'sae' : 'psk2');

    if (isMlo) {
        // MLO STA: multi-radio, mld_assoc_band mandatory
        const mloParams = Object.assign({}, params, { encryption: enc, mlo: true });
        const res = await layer2.uplink_connect(radio_id, mloParams);
        if (!res.ok) return { ok: false, sid: null, restartRequired: 'none', errors: res.errors || [] };
        return { ok: true, sid: res.sid, restartRequired: 'reboot', errors: [] };
    }

    // Legacy STA: single-radio
    const write = Object.assign({ encryption: enc, network: params.network || 'wwan' }, params);
    const res = await layer2.iface_add(radio_id, 'sta', write);
    if (!res.ok) return { ok: false, sid: null, restartRequired: 'none', errors: res.errors || [] };
    return { ok: true, sid: res.sid, restartRequired: 'reboot', errors: [] };
}

// Wizard: relayd bridge (STA uplink on wwan, relay_bridge bridges wwan↔lan).
async function wizard_relayd(radio_id, params) {
    const enc   = params.encryption || 'none';
    const write = Object.assign({}, params, { encryption: enc, network: 'relayd_up' });
    delete write.wds;

    const staRes = await layer2.iface_add(radio_id, 'sta', write);
    if (!staRes.ok) return { ok: false, sid: null, restartRequired: 'none', errors: staRes.errors || [] };

    const relRes = await layer2.relayd_setup('relayd_up', 'lan');
    if (!relRes.ok) {
        await layer2.iface_remove(staRes.sid);
        return { ok: false, sid: null, restartRequired: 'none', errors: ['relayd_setup failed'] };
    }

    return { ok: true, sid: staRes.sid, restartRequired: 'reboot', errors: [] };
}

// Wizard: Repeater (STA uplink + local AP on separate radio).
// Returns { ok, sta_sid, ap_sid, restartRequired, errors }.
async function wizard_repeater(uplink_radio_id, ap_radio_id, uplink_params, ap_params) {
    // STA on uplink radio
    const staEnc   = uplink_params.encryption || 'psk2';
    const staWrite = Object.assign({ encryption: staEnc, network: 'wwan', repeater: '1' }, uplink_params);

    const staRes = await layer2.iface_add(uplink_radio_id, 'sta', staWrite);
    if (!staRes.ok) return { ok: false, sta_sid: null, ap_sid: null,
        restartRequired: 'none', errors: staRes.errors || [] };

    // AP on local radio
    const apEnc   = ap_params.encryption || (ap_radio_id === 'radio2' ? 'sae' : 'psk2');
    const apWrite = Object.assign({ encryption: apEnc, network: 'lan', repeater: '1' }, ap_params);

    const apRes = await layer2.iface_add(ap_radio_id, 'ap', apWrite);
    if (!apRes.ok) return { ok: false, sta_sid: staRes.sid, ap_sid: null,
        restartRequired: 'none', errors: apRes.errors || [] };

    // Add wwan to firewall wan zone so masquerade applies (L3 NAT for repeater clients)
    await layer2.fw_wan_add_network('wwan');

    return { ok: true, sta_sid: staRes.sid, ap_sid: apRes.sid,
        restartRequired: 'reboot', errors: [] };
}

// Wizard: Country / Regulatory change.
// Sets country on all 3 radios then restarts wifi. Does NOT touch sku_idx —
// that is managed exclusively by system_set_txpower_mode.
// Returns { ok, restartRequired, errors }.
async function wizard_country(country) {
    const errors = [];

    for (const rid of ['radio0', 'radio1', 'radio2']) {
        const res = await layer2.radio_set(rid, { country });
        if (!res.ok) { errors.push(...(res.errors || ['radio_set failed: ' + rid])); break; }
    }
    if (errors.length) return { ok: false, restartRequired: 'none', errors };

    return { ok: true, restartRequired: 'reboot', errors: [] };
}

// --- MESH wizards ---
// Compose role + backhaul + roaming into one "turn on mesh" action.
// All wifi config changes require a full reboot (MLO stack).

// Controller: set role, bring up the WDS backhaul AP on 5G, enable roaming.
async function wizard_mesh_controller(radio_id, params) {
    const { clientSsid, clientKey } = params || {};

    // validate BEFORE any change — empty inputs must fail clean, never half-configure
    if (!clientSsid || !clientKey)
        return { ok: false, sid: null, restartRequired: 'none',
                 errors: ['Mesh network name and password are required.'] };

    // idempotence: refuse if mesh is already active. A second enable would add a
    // duplicate backhaul -> L2 loop -> broadcast storm (2026-07-10 incident).
    const cur = await layer2.mesh_role_get();
    if (cur.ok && cur.data)
        return { ok: false, sid: null, restartRequired: 'none',
                 errors: ['Mesh is already active as ' + cur.data + '. Disable it first.'] };

    // safeguard: snapshot wireless config so a failed setup can be rolled back
    const bak = await layer2.wireless_backup();
    const backup = bak && bak.ok ? bak.data : null;

    const roleRes = await layer2.mesh_role_set('controller');
    if (!roleRes.ok) return { ok: false, sid: null, restartRequired: 'none', errors: ['mesh_role_set failed'] };

    // extender backend: controller enables WDS on the existing serving MLD
    // (SSID/key come from that MLD; agents join it). Non-disruptive.
    const apRes = await meshbh.backhaul_setup('controller');
    if (!apRes.ok) {
        await layer2.mesh_role_set('');                 // rollback role
        if (backup) await layer2.wireless_restore(backup);   // rollback wireless config
        return { ok: false, sid: null, restartRequired: 'none', errors: apRes.errors || [] };
    }

    // mesh client APs (tri-band 2.4+6 GHz, one roaming SSID; 11k/v for usteer)
    const capRes = await meshbh.client_ap_setup(clientSsid, clientKey);
    if (!capRes.ok) {
        await layer2.mesh_role_set('');
        if (backup) await layer2.wireless_restore(backup);
        return { ok: false, sid: null, restartRequired: 'none', errors: capRes.errors || [] };
    }

    await meshbh.save_client_ssid(clientSsid);           // remember for disable teardown
    await layer2.roam_start();                           // client steering (non-fatal)

    return { ok: true, sid: apRes.sid, restartRequired: 'reboot', errors: [] };
}

// Agent: set role, join the controller's backhaul as WDS STA, enable roaming.
async function wizard_mesh_agent(radio_id, params) {
    const { ssid, key, bssid, clientSsid, clientKey } = params || {};

    // validate BEFORE any change — empty inputs must fail clean, never half-configure
    if (!ssid || !key || !clientSsid || !clientKey)
        return { ok: false, sid: null, restartRequired: 'none',
                 errors: ['Backhaul SSID/key and mesh network name/password are all required.'] };

    // idempotence: refuse if mesh is already active. A second enable would add a
    // duplicate backhaul -> L2 loop -> broadcast storm (2026-07-10 incident).
    const cur = await layer2.mesh_role_get();
    if (cur.ok && cur.data)
        return { ok: false, sid: null, restartRequired: 'none',
                 errors: ['Mesh is already active as ' + cur.data + '. Disable it first.'] };

    // safeguard: snapshot wireless config so a failed join can be rolled back
    const bak = await layer2.wireless_backup();
    const backup = bak && bak.ok ? bak.data : null;

    const roleRes = await layer2.mesh_role_set('agent');
    if (!roleRes.ok) return { ok: false, sid: null, restartRequired: 'none', errors: ['mesh_role_set failed'] };

    const joinRes = await meshbh.backhaul_setup('agent', { ssid, key, bssid });
    if (!joinRes.ok) {
        await layer2.mesh_role_set('');                 // rollback role
        if (backup) await layer2.wireless_restore(backup);   // rollback wireless config
        return { ok: false, sid: null, restartRequired: 'none', errors: joinRes.errors || [] };
    }

    // mesh client APs (tri-band 2.4+6 GHz, one roaming SSID; 11k/v for usteer)
    const capRes = await meshbh.client_ap_setup(clientSsid, clientKey);
    if (!capRes.ok) {
        await layer2.mesh_role_set('');
        if (backup) await layer2.wireless_restore(backup);
        return { ok: false, sid: null, restartRequired: 'none', errors: capRes.errors || [] };
    }

    await meshbh.agent_l2_setup();                       // pure L2 extender: no DHCP on agent
    await meshbh.save_client_ssid(clientSsid);           // remember for disable teardown
    await layer2.roam_start();                           // client steering (non-fatal)

    return { ok: true, sid: joinRes.sid, restartRequired: 'reboot', errors: [] };
}

// Disable mesh: tear down the backhaul iface and clear the role.
// Roaming daemon is left running (it is useful independent of mesh).
async function wizard_mesh_disable() {
    const ifRes = await layer2.iface_get_all();
    if (ifRes.ok) {
        const bh = (ifRes.data || []).find(function(i) {
            return i.wds && (i.device || []).indexOf('radio1') !== -1;
        });
        if (bh) {
            const role = bh.mode === 'ap' ? 'controller' : 'agent';
            await meshbh.backhaul_teardown(role, bh.sid);
            if (role === 'agent') await meshbh.agent_l2_teardown();   // restore agent DHCP
        }
    }
    await meshbh.client_ap_teardown_saved();             // remove the mesh client APs
    await meshbh.save_client_ssid('');                   // clear remembered SSID
    await layer2.mesh_role_set('');

    return { ok: true, restartRequired: 'reboot', errors: [] };
}

// --- STEERD ---

async function load_steerd(clients) {
    const [statusRes, noiseRes, modeRes] = await Promise.all([
        layer2.steerd_get_status(),
        layer2.iw_survey_noise(),
        layer2.steerd_get_mode()
    ]);
    const sd = statusRes.ok
        ? statusRes.data
        : { running: false, pid: null, log: [], script_present: false };
    const noise = noiseRes.ok ? noiseRes.data : {};
    const mode = modeRes.ok ? modeRes.data : 'auto';

    // Fetch Neg-TTLM for each MLMR client (max_simul_links > 1) in parallel
    const mlmrClients = (clients || []).filter(function(c) { return c.is_mld && c.max_simul_links > 1; });
    const neg_ttlm = {};
    await Promise.all(mlmrClients.map(async function(c) {
        const res = await layer2.hostapd_get_neg_ttlm('ap-mld-1', c.mac);
        neg_ttlm[c.mac] = res.ok ? res.data : { active: false, tids: [] };
    }));

    return Object.assign({}, sd, { noise, neg_ttlm, mode });
}

async function steerd_start() {
    return layer2.steerd_start();
}

async function steerd_stop() {
    return layer2.steerd_stop();
}

async function steerd_set_mode(mode) {
    return layer2.steerd_set_mode(mode);
}

// --- ROAM (usteer daemon) ---

async function load_roam() {
    const res = await layer2.roam_status();
    return res.ok
        ? res.data
        : { running: false, pid: null, enabled: false, log: [] };
}

async function roam_start() {
    return layer2.roam_start();
}

async function roam_stop() {
    return layer2.roam_stop();
}

// backhaul status passthrough (Mesh tab reads it via layer3)
async function backhaul_status() {
    return layer2.backhaul_status();
}

// --- MODULE EXPORT ---

const Layer3 = {
    load_all, load_diag, load_channels, scan,
    start_apply, poll_apply,
    wizard_ap, wizard_mlo, wizard_sta, wizard_relayd, wizard_repeater, wizard_country,
    load_steerd, steerd_start, steerd_stop, steerd_set_mode,
    load_roam, roam_start, roam_stop, backhaul_status,
    wizard_mesh_controller, wizard_mesh_agent, wizard_mesh_disable
};

return baseclass.extend(Layer3);
