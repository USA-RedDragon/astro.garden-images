#!/bin/bash

set -euo pipefail

# This script is used to minify images in the project.

OUT="./dist/generated/"
rm -rf $OUT
mkdir -p $OUT/my-data $OUT/other-data $OUT/fullres/my-data $OUT/fullres/other-data $OUT/halfres/my-data $OUT/halfres/other-data $OUT/social/my-data $OUT/social/other-data

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
for file in $(find ./my-data -name '*.svg'); do
    cp $file $OUT/fullres/my-data/$(basename $file)
done

for file in $(find ./other-data -name '*.svg'); do
    cp $file $OUT/fullres/other-data/$(basename $file)
done

##########################
# Optipng fullres
##########################
for file in $(find ./my-data -name '*.png'); do
    name=$(basename $file)
    fullname="$(dirname $file)/$(basename $file)"
    optipng -force -clobber -quiet -preserve -o 5 -out "$OUT/fullres/${fullname}" "$file" &
    pids+=($!)
    echo "Minifying $fullname"
done

for file in $(find ./other-data -name '*.png'); do
    name=$(basename $file)
    fullname="$(dirname $file)/$(basename $file)"
    optipng -force -clobber -quiet -preserve -o 5 -out "$OUT/fullres/${fullname}" "$file" &
    pids+=($!)
    echo "Minifying $fullname"
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

pids=()

##########################
# WebP + OpenGraph halfres
##########################
for file in $(find ./$OUT/fullres/my-data -name '*.png'); do
    name=$(basename $file)
    $convert $file -quality 50 -resize 50% "$OUT/halfres/my-data/${name%.*}.webp" &
    pids+=($!)
    echo "Converting $name to WebP"
    $convert $file -background "transparent" -resize x630 -gravity center -extent 1200x630 "$OUT/social/my-data/${name%.*}.png" &
    pids+=($!)
    echo "Converting $name to OpenGraph"
done

for file in $(find ./$OUT/fullres/other-data -name '*.png'); do
    name=$(basename $file)
    $convert $file -quality 50 -resize 50% "$OUT/halfres/other-data/${name%.*}.webp" &
    pids+=($!)
    echo "Converting $name to WebP"
    $convert $file -background "transparent" -resize x630 -gravity center -extent 1200x630 "$OUT/social/other-data/${name%.*}.png" &
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
files=$(find ./$OUT/fullres/my-data -name '*.png')
for file in $files; do
    basename=$(basename $file)
    export name=${basename%.*}
    export width=$(identify -format "%[w]" $file)
    export height=$(identify -format "%[h]" $file)
    cp ./my-data/${name}.json $OUT/my-data/${name}.json
    yq -i -o json '.src = "my-data/" + strenv(name)' $OUT/my-data/${name}.json
    yq -i -o json '.width = env(width)' $OUT/my-data/${name}.json
    yq -i -o json '.height = env(height)' $OUT/my-data/${name}.json
    echo "Creating JSON for $name"
done

files=$(find ./$OUT/fullres/other-data -name '*.png')
for file in $files; do
    basename=$(basename $file)
    export name=${basename%.*}
    export width="$(identify -format "%[w]" $file)"
    export height="$(identify -format "%[h]" $file)"
    cp ./other-data/${name}.json $OUT/other-data/${name}.json
    yq -i -o json '.src = "other-data/" + strenv(name)' $OUT/other-data/${name}.json
    yq -i -o json '.width = env(width)' $OUT/other-data/${name}.json
    yq -i -o json '.height = env(height)' $OUT/other-data/${name}.json
    echo "Creating JSON for $name"
done
yq ea '[.]' -o json $OUT/my-data/*.json > $OUT/my-data.json
yq ea '[.]' -o json $OUT/other-data/*.json > $OUT/other-data.json
rm -rf $OUT/my-data $OUT/other-data
