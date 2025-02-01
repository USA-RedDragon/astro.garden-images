#!/bin/bash

set -euo pipefail

pids=()

cleanup() {
    echo "Cleaning up"
    for pid in ${pids[*]}; do
        echo "Killing $pid"
        kill $pid 2> /dev/null
    done
}

trap cleanup TERM INT

FILE=${1:-""}
if [ -z "$FILE" ]; then
    # Minify all PNGs
    for file in $(find ./my-data -name '*.png'); do
        fullname="$(dirname $file)/$(basename $file)"
        optipng -force -clobber -quiet -preserve -o 5 "$file" &
        pids+=($!)
        echo "Minifying $fullname"
    done

    for file in $(find ./other-data -name '*.png'); do
        fullname="$(dirname $file)/$(basename $file)"
        optipng -force -clobber -quiet -preserve -o 5 "$file" &
        pids+=($!)
        echo "Minifying $fullname"
    done
fi

if [ -f "$FILE" ]; then
    # Minify a single PNG
    optipng -force -clobber -quiet -preserve -o 5 "$FILE" &
    pids+=($!)
    echo "Minifying $FILE"
fi


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
