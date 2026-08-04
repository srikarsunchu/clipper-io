#!/bin/sh
# This fixture stands in for the python binary itself, so $1 is track_faces.py's
# own script path (not a real argument) -- shift it off before recording, to
# match track_faces.py's own sys.argv[1:] view of its real CLI arguments.
shift
python3 -c "
import json, os, sys
out = os.environ.get('FAKE_ARGV_OUTPUT_PATH')
if out:
    with open(out, 'w') as f:
        json.dump(sys.argv[1:], f)
print(json.dumps({'points': [], 'sourceWidth': 0, 'sourceHeight': 0}))
" "$@"
