#!/bin/bash
# Build one board and variant:
#
#   ./build.sh <board> <variant>
#     board:   bpi-r4 | bpi-r4-pro-8x     (boards/<board>/board.sh)
#     variant: standard (Wi-Fi) | wired   (boards/<board>/configs/<variant>.config)
#
# Run from the repository root. The OpenWrt tree is created in ./openwrt and
# the MTK feed in ./mtk-openwrt-feeds; both are deleted first. Images end up
# in openwrt/bin/targets/mediatek/filogic.
#
# What is shared by both boards lives in common/, what is not in boards/.
# The upstream revisions are in pins.conf.
set -euo pipefail

usage() { echo "usage: $0 <bpi-r4|bpi-r4-pro-8x> <standard|wired>" >&2; exit 1; }

BOARD=${1:-}
VARIANT=${2:-}
[ -f "boards/$BOARD/board.sh" ] || usage
[ -f "boards/$BOARD/configs/$VARIANT.config" ] || usage

REPO=$(pwd)
. "$REPO/scripts/common.sh"
. "$REPO/boards/$BOARD/board.sh"

load_pins "$REPO/pins.conf"

case $VARIANT in
standard) PROFILE=filogic-mac80211-mt798x_rfb-wifi7_nic ;;
wired)    PROFILE=filogic ;;
esac

fetch_sources
add_kernel_patches

# A persistent OPENWRT_CACHE (self-hosted runners) keeps the downloads and
# the ccache between builds; the tree itself is still rebuilt from scratch.
if [ -n "${OPENWRT_CACHE:-}" ]; then
	mkdir -p "$OPENWRT_CACHE/dl" "$OPENWRT_CACHE/ccache"
	ln -s "$OPENWRT_CACHE/dl" openwrt/dl
fi

cd openwrt
bash ../mtk-openwrt-feeds/autobuild/unified/autobuild.sh "$PROFILE" prepare

[ "$VARIANT" = standard ] && add_wifi_patches
board_tree
add_packages
add_files
board_packages

./scripts/feeds update -a
./scripts/feeds install -a

board_after_feeds
add_after_feeds

\cp "$REPO/boards/$BOARD/configs/$VARIANT.config" .config
make defconfig
add_config
board_config
if [ -n "${OPENWRT_CACHE:-}" ]; then
	# The kernel build is under .NOTPARALLEL, so make hands it -j1 and it
	# compiles on one core; kbuild takes its own -j.
	sed -i 's/^KERNEL_MAKE = \$(MAKE) /&-j$(NPROC) /' include/kernel.mk
	grep -q '^KERNEL_MAKE = \$(MAKE) -j\$(NPROC) ' include/kernel.mk
	echo "CONFIG_CCACHE=y" >> .config
	echo "CONFIG_CCACHE_DIR=\"$OPENWRT_CACHE/ccache\"" >> .config
fi

bash ../mtk-openwrt-feeds/autobuild/unified/autobuild.sh "$PROFILE" build
