#!/usr/bin/env bash
# Make the README's art from the frames a tape in demo/ recorded: for a clip,
# an animated WebP, which GitHub shows inline, and an MP4; for a still, a WebP
# of its last frame.
#
# vhs writes each frame it shows, a layer of text and one of the cursor,
# exactly as the terminal drew them. The art is made from those, not from a
# video vhs encodes: a video's compression shifts every pixel a little from
# frame to frame, which an animated WebP then has to store whole, where from
# the frames themselves it stores only what changed, losslessly.
#
# Usage:  demo/finalize.sh <name>...           a clip each, such as tour
#         demo/finalize.sh --still <name>...   a still each, such as update
# Input:  demo/out/<name>/   the frames vhs demo/<name>.tape wrote
# Output: art/<name>.webp, and for a clip, art/<name>.mp4
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
art="$(cd "$here/.." && pwd)/art"
fps=30 # the tapes' Framerate
pad=40 # the margin round the screen, in px

still=false
if [ "${1:-}" = "--still" ]; then
	still=true
	shift
fi
[ $# -gt 0 ] || {
	echo "usage: demo/finalize.sh [--still] <name>..." >&2
	exit 2
}

frames="$(mktemp -d)"
trap 'rm -rf "$frames"' EXIT
mkdir -p "$art"

for name in "$@"; do
	src="$here/out/$name"
	[ -f "$src/frame-text-00001.png" ] || {
		echo "no frames in demo/out/$name: run 'demo/record.sh $name' first" >&2
		exit 1
	}
	rm -f "$frames"/*.png
	size="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$src/frame-text-00001.png")"
	w="${size%,*}" h="${size#*,}"

	# The cursor's layer over the text's, on a margin of the theme's
	# background, read from the screen's top-right pixel.
	ffmpeg -v error -y -framerate "$fps" -i "$src/frame-text-%05d.png" -framerate "$fps" -i "$src/frame-cursor-%05d.png" \
		-filter_complex "[0][1]overlay=format=rgb,split[screen][corner];[corner]crop=1:1:$((w - 1)):0,scale=$((w + 2 * pad)):$((h + 2 * pad)):flags=neighbor[margin];[margin][screen]overlay=$pad:$pad:format=rgb" \
		-pix_fmt rgb24 "$frames/f%05d.png"

	echo "==> $name"
	if $still; then
		shot=("$frames"/f*.png)
		cwebp -quiet -lossless -m 6 "${shot[${#shot[@]} - 1]}" -o "$art/$name.webp"
		printf "   %-24s %s\n" "art/$name.webp" "$(du -h "$art/$name.webp" | cut -f1)"
		continue
	fi
	img2webp -loop 0 -lossless -q 80 -m 6 -d $((1000 / fps)) "$frames"/f*.png -o "$art/$name.webp" >/dev/null
	ffmpeg -v error -y -framerate "$fps" -i "$frames/f%05d.png" \
		-c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$art/$name.mp4"
	for f in "$name.webp" "$name.mp4"; do
		printf "   %-24s %s\n" "art/$f" "$(du -h "$art/$f" | cut -f1)"
	done
done
