#!/bin/bash
# fresh local DB with schema + sample data
D=$(dirname "$0")/..
Q="psql -h /tmp -p 54329 -U postgres"
$Q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='ot' and pid<>pg_backend_pid()" >/dev/null 2>&1
$Q -c "drop database if exists ot" -c "create database ot" >/dev/null 2>&1
P="$Q -d ot -v ON_ERROR_STOP=1 -q"
$P -f $D/test/auth_stub.sql && $P -f $D/supabase/schema.sql 2>&1 | grep -v NOTICE
[ "$1" != "empty" ] && $P -f $D/supabase/seed.sql
$Q -d ot -c "notify pgrst, 'reload schema'" >/dev/null
