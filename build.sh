#!/bin/bash
# Build one board and variant:
#
#   ./build.sh <board> <variant>
#     board:   bpi-r4 | bpi-r4-pro-8x     (boards/<board>/board.sh)
#     variant: standard (Wi-Fi) | wired   (boards/<board>/configs/<variant>.config)
#
# Run from the repository root. Source checkouts in ./openwrt and
# ./mtk-openwrt-feeds are reset and cleaned first, keeping only ./openwrt/dl
# for downloaded sources. Images end up in openwrt/bin/targets/mediatek/filogic.
# KEEP_BUILD=1 also keeps openwrt/{build_dir,staging_dir,tmp}, so a rerun
# rebuilds only what changed instead of everything (see fetch_sources).
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
check_keep_build

case $VARIANT in
standard) PROFILE=filogic-mac80211-mt798x_rfb-wifi7_nic ;;
wired)    PROFILE=filogic ;;
esac

# The standard variant is installed and updated with sysupgrade only, so its
# boot/disk images are not needed. Skipping them also keeps U-Boot and TF-A out
# of the build, which is a good part of the build time.
if [ "$VARIANT" = standard ]; then
	export ITB_ONLY=1
fi

fetch_sources
add_kernel_patches

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
host_toolchain_fixes

\cp "$REPO/boards/$BOARD/configs/$VARIANT.config" .config
make defconfig
add_config
board_config

bash ../mtk-openwrt-feeds/autobuild/unified/autobuild.sh "$PROFILE" build
