#!/bin/bash

set -euo pipefail

# This script is used to minify images in the project.

OUT="./dist/generated/"
rm -rf $OUT
mkdir -p $OUT/data $OUT/fullres $OUT/halfres $OUT/social

pids=()

cleanup() {
    echo "Cleaning up"
    for pid in ${pids[*]}; do
        echo "Killing $pid"
        kill $pid 2> /dev/null
    done
}

trap cleanup TERM INT

convert=convert
if [ -x "$(command -v magick)" ]; then
    convert=magick
fi

##########################
# Copy Overlay SVGs
##########################
for file in $(find ./data -name '*.svg'); do
    cp $file $OUT/fullres/$(basename $file)
done

##########################
# fullres
##########################
for file in $(find ./data -name '*.png'); do
    cp -v "$file" "$OUT/fullres/$(basename $file)"
done

pids=()

##########################
# WebP + OpenGraph halfres
##########################
for file in $(find ./$OUT/fullres -name '*.png'); do
    name=$(basename $file)
    $convert $file -quality 50 -resize 50% "$OUT/halfres/${name%.*}.webp" &
    pids+=($!)
    echo "Converting $name to WebP"
    $convert $file -quality 50 -background "transparent" -resize x630 -gravity center -extent 1200x630 "$OUT/social/${name%.*}.webp" &
    pids+=($!)
    echo "Converting $name to OpenGraph"
done

total_jobs=${#pids[*]}

while [ ${#pids[*]} -gt 0 ]; do
    echo "Waiting for ${#pids[*]} jobs to finish"
    for pid in ${pids[*]}; do
        if ! kill -0 $pid 2> /dev/null; then
            pids=(${pids[@]/$pid})
        fi
    done
    sleep 5
done

##########################
# Combine JSONs
##########################
files=$(find ./$OUT/fullres -name '*.png')
for file in $files; do
    basename=$(basename $file)
    export name=${basename%.*}
    export width=$(identify -format "%[w]" $file)
    export height=$(identify -format "%[h]" $file)
    cp ./data/${name}.json $OUT/data/${name}.json
    yq -i -o json '.src = strenv(name)' $OUT/data/${name}.json
    yq -i -o json '.width = env(width)' $OUT/data/${name}.json
    yq -i -o json '.height = env(height)' $OUT/data/${name}.json
    echo "Creating JSON for $name"
done

yq ea '[.]' -o json $OUT/data/*.json > $OUT/data.json
rm -rf $OUT/data
