#!/bin/bash
set -euo pipefail

# BUMP 2026-08-06 (sync s lab universal-new — 4. router / easymesh package
# vyvoj potrebuje IDENTICKY zaklad jako lab; predchozi base 2026-07-06:
# OpenWrt 6dead286 / MTK 822c2f06):
#   OpenWrt:  4d0fec5a4845ba166203a782d08217b3f1cf2af9  (openwrt-25.12)
#   MTK SDK:  3a4e2a2511af93cea1ca43205a02362423882b7c  (main)
OPENWRT_COMMIT=${OPENWRT_COMMIT:-4a5c6b90d21522d2663ce2718c973f9e845f2119}
# 2026-07-06: migrated git01 -> main (git01 frozen; MTK recommends main). Single source of truth.
# 2026-08-06: bump to the lab universal-new pin (see header).
MTK_COMMIT=${MTK_COMMIT:-4e825214deaafc5cdc5457d66a1a828449f07e69}

########################### persistent build cache ############################
# actions/checkout runs "git clean -ffdx" in the workspace on every run, so the
# build tree cannot live there. Everything worth keeping sits under CACHE_ROOT
# (a fixed absolute path, which is also what makes the toolchain cache valid):
#
#   $CACHE_ROOT/dl                     source tarballs   (CONFIG_DOWNLOAD_FOLDER)
#   $CACHE_ROOT/ccache                 compiler cache    (CONFIG_CCACHE_DIR)
#   $CACHE_ROOT/tree/<variant>/        openwrt + mtk-openwrt-feeds, symlinked in
#   $CACHE_ROOT/toolchain/*.tar.zst    toolchain+host dirs, keyed by the two pins
#
# The tree is reused only when every input that shapes it is byte-identical:
# both pins, this script, and all of my_files/ + configs/. Anything else (or
# FORCE_CLEAN=1) means a full wipe and a fresh clone, like before.
CACHE_ROOT="${CACHE_ROOT:-$HOME/openwrt-cache}"
CACHE_VARIANT=wifimgr-universal
CACHE_TREE="$CACHE_ROOT/tree/$CACHE_VARIANT"
CACHE_DL="$CACHE_ROOT/dl"
CACHE_CCACHE="$CACHE_ROOT/ccache"
CACHE_TOOLCHAIN_DIR="$CACHE_ROOT/toolchain"
CACHE_TOOLCHAIN="$CACHE_TOOLCHAIN_DIR/$CACHE_VARIANT-${OPENWRT_COMMIT:0:12}-${MTK_COMMIT:0:12}.tar.zst"
mkdir -p "$CACHE_DL" "$CACHE_CCACHE" "$CACHE_TOOLCHAIN_DIR" "$CACHE_ROOT/tree"

CACHE_KEY=$( { echo "$OPENWRT_COMMIT"; echo "$MTK_COMMIT"; sha256sum "$0"; \
               find my_files configs -type f -exec sha256sum {} + | sort -k2; \
             } | sha256sum | cut -d' ' -f1 )
CACHE_STAMP="$CACHE_TREE/.cache-key"

REUSE_TREE=0
if [ "${FORCE_CLEAN:-0}" = "1" ]; then
	echo "cache: FORCE_CLEAN=1 -> full rebuild"
elif [ -d "$CACHE_TREE/openwrt" ] && [ -f "$CACHE_STAMP" ] && \
     [ "$(cat "$CACHE_STAMP")" = "$CACHE_KEY" ]; then
	REUSE_TREE=1
	echo "cache: reusing prepared tree $CACHE_TREE (key ${CACHE_KEY:0:12})"
else
	echo "cache: inputs changed or no tree yet -> fresh clone (key ${CACHE_KEY:0:12})"
fi

# workspace entries are just symlinks into the cache; never follow them with -rf
rm -rf openwrt
rm -rf mtk-openwrt-feeds

if [ "$REUSE_TREE" = 0 ]; then
	rm -rf "$CACHE_TREE"
	mkdir -p "$CACHE_TREE"
	git clone --branch openwrt-25.12 https://git.openwrt.org/openwrt/openwrt.git "$CACHE_TREE/openwrt"
	git -C "$CACHE_TREE/openwrt" checkout "$OPENWRT_COMMIT"
	git clone --branch main https://github.com/mediatek/mtk-openwrt-feeds "$CACHE_TREE/mtk-openwrt-feeds"
	git -C "$CACHE_TREE/mtk-openwrt-feeds" checkout "$MTK_COMMIT"
fi

ln -sfn "$CACHE_TREE/openwrt" openwrt
ln -sfn "$CACHE_TREE/mtk-openwrt-feeds" mtk-openwrt-feeds

CCACHE_DIR="$CACHE_CCACHE" ccache -M "${CCACHE_MAXSIZE:-40G}" >/dev/null 2>&1 || true
###############################################################################


\cp -r my_files/999-sfp-10-additional-quirks.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/999-sfp-11-rtl8261be-mdio-none.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/999-sfp-22-rtl8261be-boot-1g-reprobe.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/999-eth-21-mtk-gdm-rx-fsm-reset.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/999-pcs-10-lynxi-hold-link-down-on-invalid-speed.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/999-fix-01-mac80211-btwt-ap-mode.patch mtk-openwrt-feeds/autobuild/unified/filogic/mac80211/25.12/files/package/kernel/mac80211/patches/subsys/0139-fix-mac80211-btwt-ap-mode-he-btwt-supported.patch
\cp -r my_files/999-fix-00-xfrm-propagate-einprogress.patch mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12
\cp -r my_files/0264-wpa_s-add-btwt-join-command.patch mtk-openwrt-feeds/autobuild/unified/filogic/mac80211/25.12/files/package/network/services/hostapd/patches/0264-wpa_s-add-btwt-join-command.patch

### tx_power check Ivan Mironov's patch - for defective BE14 boards with defective eeprom flash
\cp -r my_files/100-wifi-mt76-mt7996-Use-tx_power-from-default-fw-if-EEP.patch mtk-openwrt-feeds/autobuild/unified/filogic/mac80211/25.12/files/package/kernel/mt76/patches

### per-band WiFi LED (MT7996, single-wiphy MLO) + shared tpt trigger - HW verified 2026-06-28
\cp -r my_files/999-wifi-01-mt7996-per-band-leds.patch mtk-openwrt-feeds/autobuild/unified/filogic/mac80211/25.12/files/package/kernel/mt76/patches/9999-w-mt7996-per-band-leds.patch
\cp -r my_files/999-wifi-02-mt76-share-tpt-led-trigger.patch mtk-openwrt-feeds/autobuild/unified/filogic/mac80211/25.12/files/package/kernel/mt76/patches/9999-w-mt76-share-tpt-led-trigger.patch

cd openwrt
# prepare patches the tree in place and is not idempotent - a reused tree is
# already through it (the stamp is only written once preparation succeeded).
if [ "$REUSE_TREE" = 0 ]; then
	bash ../mtk-openwrt-feeds/autobuild/unified/autobuild.sh filogic-mac80211-mt798x_rfb-wifi7_nic prepare
fi


\cp -r ../my_files/453-w-add-bpi-r4-nvme-dtso.patch target/linux/mediatek/patches-6.12/
\cp -r ../my_files/450-w-nand-mmc-add-bpi-r4.patch package/boot/uboot-mediatek/patches/450-add-bpi-r4.patch
\cp -r ../my_files/451-w-add-bpi-r4-nvme.patch package/boot/uboot-mediatek/patches/451-add-bpi-r4-nvme.patch
\cp ../my_files/452-w-add-bpi-r4-nvme-rfb.patch package/boot/uboot-mediatek/patches/452-add-bpi-r4-nvme-rfb.patch
\cp ../my_files/454-w-add-bpi-r4-nvme-env.patch package/boot/uboot-mediatek/patches/454-add-bpi-r4-nvme-env.patch
\cp -r ../my_files/w-filogic-bpi-r4-universal.mk target/linux/mediatek/image/filogic.mk

### ethernet/board LED (BPI-R4 standard) - leds overlay + uboot LED + filogic device + PHY trigger
\cp -r ../my_files/470-w-add-bpi-r4-leds-overlay.patch target/linux/mediatek/patches-6.12/
\cp ../my_files/471-w-bpi-r4-led-uboot.patch package/boot/uboot-mediatek/patches/471-bpi-r4-led-uboot.patch
sed -i 's/mt7988a-bananapi-bpi-r4-nvme$/mt7988a-bananapi-bpi-r4-nvme mt7988a-bananapi-bpi-r4-leds/' target/linux/mediatek/image/filogic.mk
echo "CONFIG_LED_TRIGGER_PHY=y" >> target/linux/mediatek/filogic/config-6.12

\cp ../my_files/arm-trusted-firmware-mediatek-Makefile package/boot/arm-trusted-firmware-mediatek/Makefile

echo "CONFIG_BLK_DEV_NVME=y" >> target/linux/mediatek/filogic/config-6.12
#echo "CONFIG_DYNAMIC_DEBUG=y" >> target/linux/mediatek/filogic/config-6.12
#echo "CONFIG_DYNAMIC_DEBUG_CORE=y" >> target/linux/mediatek/filogic/config-6.12

\cp -r ../my_files/999-fitblk-02-w-add-bpi-r4-nvme-fitblk.patch target/linux/mediatek/patches-6.12

\cp -r ../my_files/sms-tool/ feeds/packages/utils/sms-tool
\cp -r ../my_files/modemdata-main/ feeds/packages/utils/modemdata 
\cp -r ../my_files/luci-app-modemdata-main/luci-app-modemdata/ feeds/luci/applications
\cp -r ../my_files/luci-app-lite-watchdog/ feeds/luci/applications
\cp -r ../my_files/luci-app-sms-tool-js-main/luci-app-sms-tool-js/ feeds/luci/applications

\cp -r ../my_files/luci-app-wifimgr feeds/luci/applications/luci-app-wifimgr

mkdir -p files/etc/uci-defaults
\cp -r ../my_files/99-set-hostname files/etc/uci-defaults/
chmod +x files/etc/uci-defaults/99-set-hostname

# LAN LED: mtk-led-fix programs mt7530 gphy port-LED registers at boot (link + tx/rx activity)
mkdir -p files/etc/init.d
\cp ../my_files/etc-files/init.d/mtk-led-fix files/etc/init.d/
chmod +x files/etc/init.d/mtk-led-fix
\cp ../my_files/etc-files/uci-defaults/95-mtk-led-fix-enable files/etc/uci-defaults/
chmod +x files/etc/uci-defaults/95-mtk-led-fix-enable

# SD auto-expand: grow production + fitrw f2fs to fill the SD card on first boot (SD-only, guarded)
mkdir -p files/lib/preinit
\cp ../my_files/etc-files/lib/preinit/19-expand-fit-rootfs files/lib/preinit/
chmod +x files/lib/preinit/19-expand-fit-rootfs

# NVMe /data: mount the LABEL=data partition (NVMe installs only) at /data on first boot
\cp ../my_files/etc-files/uci-defaults/96-data-mount files/etc/uci-defaults/
chmod +x files/etc/uci-defaults/96-data-mount

mkdir -p files/root/install-dir
\cp ../my_files/bpi-r4-install/install-nand.sh files/root/install-dir/install-nand.sh
chmod +x files/root/install-dir/install-nand.sh
\cp ../my_files/bpi-r4-install/install-nvme.sh files/root/install-dir/install-nvme.sh
chmod +x files/root/install-dir/install-nvme.sh
\cp ../my_files/bpi-r4-install/install-emmc.sh files/root/install-dir/install-emmc.sh
chmod +x files/root/install-dir/install-emmc.sh
\cp ../my_files/bpi-r4-install/install-nvme-unifi.sh files/root/install-dir/install-nvme-unifi.sh
chmod +x files/root/install-dir/install-nvme-unifi.sh
#mkdir -p files/usr/sbin
#\cp ../my_files/bpi-r4-install/boot-nvme files/usr/sbin/boot-nvme
#chmod +x files/usr/sbin/boot-nvme
#\cp ../my_files/bpi-r4-pro/files/usr/sbin/boot-nand files/usr/sbin/boot-nand
#chmod +x files/usr/sbin/boot-nand


./scripts/feeds update -a
./scripts/feeds install -a

\cp ../my_files/fit.sh package/utils/fitblk/files/fit.sh

\cp -r ../my_files/qmi.sh package/network/utils/uqmi/files/lib/netifd/proto/
chmod -R 755 package/network/utils/uqmi/files/lib/netifd/proto
chmod -R 755 feeds/luci/applications/luci-app-modemdata/root
chmod -R 755 feeds/luci/applications/luci-app-sms-tool-js/root
chmod -R 755 feeds/packages/utils/modemdata/files/usr/share

\cp -r ../configs/my_defconfig-wifimgr-universal .config

# keep downloads and objects outside the tree (rules.mk defaults CCACHE_DIR to
# $(TOPDIR)/.ccache, which would die with every fresh clone)
echo "CONFIG_DEVEL=y" >> .config
echo "CONFIG_DOWNLOAD_FOLDER=\"$CACHE_DL\"" >> .config
echo "CONFIG_CCACHE=y" >> .config
echo "CONFIG_CCACHE_DIR=\"$CACHE_CCACHE\"" >> .config

if [ ! -d package/fastfetch ]; then
	git clone --depth 1 --branch master --single-branch --no-checkout https://github.com/muink/openwrt-fastfetch.git package/fastfetch
	pushd package/fastfetch
	umask 022
	git checkout
	popd
fi

if [ ! -d package/luci-theme-proton2025 ]; then
	git clone https://github.com/ChesterGoodiny/luci-theme-proton2025 package/luci-theme-proton2025
fi
./scripts/feeds update -a && ./scripts/feeds install -a

# the tree is fully prepared from here on: record the key so that a run which
# fails later (image assembly, a single package) can resume instead of redoing
# the whole toolchain. A failure before this point leaves no stamp -> full wipe.
echo "$CACHE_KEY" > "$CACHE_STAMP"

make defconfig

echo "CONFIG_PACKAGE_fastfetch=y" >> .config
echo "CONFIG_PACKAGE_fish=y" >> .config
echo "CONFIG_PACKAGE_luci-theme-proton2025=y" >> .config
echo "CONFIG_LUCI_THEME_DEFAULT=\"proton2025\"" >> .config
echo "CONFIG_PACKAGE_adguardhome=y" >> .config
echo "CONFIG_PACKAGE_xray-core=y" >> .config
echo "CONFIG_PACKAGE_sing-box=y" >> .config
echo "CONFIG_PACKAGE_kmod-nft-tproxy=y" >> .config
echo "CONFIG_PACKAGE_kmod-nft-socket=y" >> .config
echo "CONFIG_PACKAGE_kmod-nft-conntrack=y" >> .config
echo "CONFIG_PACKAGE_kmod-nf-conntrack-netlink=y" >> .config

### OpenWrt SDK (per-target = covers all variants incl. Pro 8X) - published as release-sdk
echo "CONFIG_SDK=y" >> .config

make defconfig

# The mt7988 *-comb-4bg ATF variants are HIDDEN packages (no kconfig prompt) and
# nothing selects them, so any defconfig run drops a manually set =y. They must be
# appended AFTER the last defconfig, or the 8GB BL2 images are never built and the
# 8gb image recipes die with "mt7988-emmc-comb-4bg-bl2.img: No such file or directory".
echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-emmc-comb-4bg=y" >> .config
echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-sdmmc-comb-4bg=y" >> .config
echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-spim-nand-ubi-comb-4bg=y" >> .config

# A fresh tree still gets the cross toolchain and host tools for free as long as
# the pins match: both carry absolute paths, and CACHE_TREE is a fixed location.
if [ "$REUSE_TREE" = 0 ] && [ -f "$CACHE_TOOLCHAIN" ]; then
	echo "cache: restoring toolchain from $CACHE_TOOLCHAIN"
	tar -I zstd -xf "$CACHE_TOOLCHAIN" -C . || {
		echo "cache: restore failed, falling back to a full toolchain build"
		rm -f "$CACHE_TOOLCHAIN"
	}
fi

bash ../mtk-openwrt-feeds/autobuild/unified/autobuild.sh filogic-mac80211-mt798x_rfb-wifi7_nic build

# never fail the run over the cache: the images are already built at this point
if [ ! -f "$CACHE_TOOLCHAIN" ]; then
	TC_DIRS=$(ls -d staging_dir/toolchain-* build_dir/toolchain-* staging_dir/host build_dir/host 2>/dev/null || true)
	if [ -n "$TC_DIRS" ]; then
		echo "cache: saving toolchain to $CACHE_TOOLCHAIN"
		if tar -I "zstd -3 -T0" -cf "$CACHE_TOOLCHAIN.tmp" $TC_DIRS; then
			mv "$CACHE_TOOLCHAIN.tmp" "$CACHE_TOOLCHAIN"
		else
			echo "cache: toolchain save failed, continuing"
			rm -f "$CACHE_TOOLCHAIN.tmp"
		fi
	fi
fi


cp openwrt/bin/targets/mediatek/filogic/openwrt-mediatek-filogic-bananapi_bpi-r4-squashfs-sysupgrade.itb /home/ipsec/latest-sysupgrade.itb 2>/dev/null || true
