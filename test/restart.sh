#!/bin/bash
# Fresh local database + fresh Supabase stand-in on :54330. Needs Postgres on :54329 and PostgREST on :54331 (see README).
HERE="$(cd "$(dirname "$0")" && pwd)"
pkill -f "node $HERE/mock-supabase.js" 2>/dev/null
bash "$HERE/reset.sh" "$1"
(NODE_PATH="$HERE/node_modules:$NODE_PATH" setsid nohup node "$HERE/mock-supabase.js" > /tmp/omnitill-mock.log 2>&1 < /dev/null &)
sleep 1.5
