# Build steps shared by both boards, sourced by build.sh.
# $REPO is the repository root; the steps after fetch_sources and
# add_kernel_patches run inside $REPO/openwrt.

# Read pins.conf; a value already in the environment wins.
load_pins() {
	local key value
	while IFS='=' read -r key value; do
		case $key in ''|\#*) continue ;; esac
		[ -n "${!key:-}" ] || export "$key=$value"
	done < "$1"
}

fetch_source() {
	local dir=$1 url=$2 branch=$3 commit=$4 clean_exclude=${5:-}
	local -a clean_args=(-dffx)
	local p
	# clean_exclude is a space-separated list of paths relative to $dir.
	for p in $clean_exclude; do
		clean_args+=(-e "$p")
	done

	if [ ! -d "$dir/.git" ]; then
		rm -rf "$dir"
		git clone --single-branch --branch "$branch" "$url" "$dir"
	else
		git -C "$dir" reset --hard HEAD
		git -C "$dir" clean "${clean_args[@]}"
		# Fetch if the pinned commit is missing locally.
		git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$dir" fetch origin "$branch"
	fi
	git -C "$dir" checkout "$commit"
}

# Sources are always reset, but with KEEP_BUILD their build products survive.
# Those objects belong to the tree they were built from, and pins.conf insists
# that OpenWrt and the MTK feed move together: if the pins changed since the
# last run, drop them instead of mixing two builds.
check_keep_build() {
	[ -n "${KEEP_BUILD:-}" ] || return 0
	[ -d openwrt ] || return 0

	local stamp=openwrt/build_dir/.pins pins="$OPENWRT_COMMIT $MTK_COMMIT"
	if [ -f "$stamp" ] && ! cmp -s "$stamp" <(printf '%s\n' "$pins"); then
		echo "pins.conf changed since the last build: dropping build_dir and staging_dir"
		rm -rf openwrt/build_dir openwrt/staging_dir
	fi
	mkdir -p openwrt/build_dir
	printf '%s\n' "$pins" > "$stamp"
}

fetch_sources() {
	# Keep downloaded sources; remove nested feed repositories and all build state.
	# KEEP_BUILD=1 keeps the compiled objects as well (build_dir, staging_dir,
	# tmp, and feeds/ instead of cloning the feed repositories again), so a
	# rerun only rebuilds what changed instead of everything. It is meant for a
	# persistent workspace such as a self-hosted runner; release images are
	# built from a clean tree. The sources themselves are always reset, and
	# openwrt/.ab is always removed, so the MTK autobuild prepare step
	# re-applies the patches to the reset tree.
	local keep=
	[ -n "${KEEP_BUILD:-}" ] && keep="/build_dir /staging_dir /tmp /feeds"

	fetch_source openwrt https://github.com/openwrt/openwrt.git openwrt-25.12 "$OPENWRT_COMMIT" "/dl $keep"
	fetch_source mtk-openwrt-feeds https://github.com/mediatek/mtk-openwrt-feeds main "$MTK_COMMIT"

	# With KEEP_BUILD the feed repositories are kept too: re-cloning them gives
	# every file a fresh mtime, and make then rebuilds all feed packages. Reset
	# and clean them in place instead. The clean also drops the copies
	# add_packages() made into them on the previous run, so a package that was
	# renamed or deleted cannot linger.
	if [ -n "${KEEP_BUILD:-}" ]; then
		local feed
		for feed in openwrt/feeds/*/; do
			[ -d "$feed/.git" ] || continue
			git -C "$feed" reset --hard -q
			git -C "$feed" clean -qfdx
		done
	fi
}

# Kernel patches for both boards go into the MTK feed, so the autobuild
# prepare step puts them next to MediaTek's own.
add_kernel_patches() {
	\cp "$REPO"/common/patches/kernel/*.patch \
		mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12/

	# MTK feed 8074fe5b (2026-11-03) replaces the Aeonsemi AS21xxx driver with
	# v2.5.3 (as2xxxx.c). On the BPI-R4 Pro 8X the Combo LAN port (Aeonsemi PHY
	# behind MxL862xx port 5, mxl_lan5) then gets a 1G copper link but passes no
	# frames from the link partner (rx_packets stays 0, in and out of the bridge);
	# the previous driver passes them. Keep the previous driver: drop the update
	# patch. The firmware (as21x1x_fw.bin, now in package as2xxxx-firmware) and
	# CONFIG_AS21XXX_PHY are unchanged, so nothing else has to follow.
	rm -f mtk-openwrt-feeds/25.12/files/target/linux/mediatek/patches-6.12/999-ephy-as21xxx-02-update-driver-to-v2.5.3.patch
}

# Since MTK feed c21f3b36 mt76/mac80211/hostapd come from
# github.com/mediatek/softmac_* and the feed has no patch directories for
# them any more. Pin the sources, then add our patches straight into the
# packages. Each board lists the patches it takes in WIFI_PATCHES.
add_wifi_patches() {
	local p dir

	sh "$REPO/common/softmac-pin.sh"
	mkdir -p package/kernel/mt76/patches package/kernel/mac80211/patches/subsys \
		package/network/services/hostapd/patches
	for p in $WIFI_PATCHES; do
		case $p in
		mt76/*)     dir=package/kernel/mt76/patches ;;
		mac80211/*) dir=package/kernel/mac80211/patches/subsys ;;
		hostapd/*)  dir=package/network/services/hostapd/patches ;;
		esac
		\cp "$REPO/common/patches/wifi/$p" "$dir/"
	done
}

# Patches both boards take from common/patches: the U-Boot NVMe/NAND/MMC
# support and the NVMe DT overlay and fitblk boot.
add_common_tree_patches() {
	\cp "$REPO"/common/patches/uboot/*.patch package/boot/uboot-mediatek/patches/
	\cp "$REPO"/common/patches/target/*.patch target/linux/mediatek/patches-6.12/
}

add_packages() {
	\cp -r "$REPO/common/packages/sms-tool/" feeds/packages/utils/sms-tool
	\cp -r "$REPO/common/packages/modemdata-main/" feeds/packages/utils/modemdata
	\cp -r "$REPO/common/packages/luci-app-modemdata-main/luci-app-modemdata/" feeds/luci/applications
	\cp -r "$REPO/common/packages/luci-app-lite-watchdog/" feeds/luci/applications
	\cp -r "$REPO/common/packages/luci-app-sms-tool-js-main/luci-app-sms-tool-js/" feeds/luci/applications
	# Third-party packages, imported instead of adding a feed: fastfetch and
	# the proton2025 LuCI theme.
	\cp -r "$REPO/common/packages/fastfetch/" feeds/packages/utils/fastfetch
	\cp -r "$REPO/common/packages/luci-theme-proton2025/" feeds/luci/themes/luci-theme-proton2025
}

# Files baked into the image: common/files, then the board's files on top.
add_files() {
	mkdir -p files
	\cp -R "$REPO/common/files/." files/
	\cp -R "$REPO/boards/$BOARD/files/." files/
}

# The tree is only tested on Ubuntu 22.04 (gcc 11). Newer host compilers
# (gcc >= 14, where the C23 declaration of memchr() returns const void * for
# a const argument) turn some host packages' -Werror into a hard error and
# stop the build. Fix the known ones here, right after the feeds are in place.
host_toolchain_fixes() {
	local mk=package/utils/dtc/Makefile

	# dtc 1.7.2: meson.build sets werror=true, and fdt_overlay.c assigns
	# memchr()'s const void * to a char *. -Dwerror=false has to land before
	# $(eval $(call HostBuild)), which freezes MESON_HOST_ARGS.
	sed -i 's|^MESON_HOST_ARGS += \$(MESON_ARGS)$|&\n\n# Relax -Werror for newer host compilers (fdt_overlay.c memchr constness).\nMESON_HOST_ARGS += -Dwerror=false|' "$mk"
	grep -q '^MESON_HOST_ARGS += -Dwerror=false$' "$mk" || {
		echo "host_toolchain_fixes: $mk no longer has MESON_HOST_ARGS to extend" >&2
		exit 1
	}
}

add_after_feeds() {
	\cp "$REPO/boards/$BOARD/fit.sh" package/utils/fitblk/files/fit.sh

	\cp -r "$REPO/common/qmi.sh" package/network/utils/uqmi/files/lib/netifd/proto/
	chmod -R 755 package/network/utils/uqmi/files/lib/netifd/proto
	chmod -R 755 feeds/luci/applications/luci-app-modemdata/root
	chmod -R 755 feeds/luci/applications/luci-app-sms-tool-js/root
	chmod -R 755 feeds/packages/utils/modemdata/files/usr/share
}

add_config() {
	echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-emmc-comb-4bg=y" >> .config
	echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-sdmmc-comb-4bg=y" >> .config
	echo "CONFIG_PACKAGE_trusted-firmware-a-mt7988-spim-nand-ubi-comb-4bg=y" >> .config
}
