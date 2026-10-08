#!/bin/bash
Q="psql -h /tmp -p 54329 -U postgres -d ot -q -t -A"
setup="set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';"
# same sale id sent from 2 devices at once
for i in 1 2 3 4; do
 $Q -c "$setup select checkout('{\"id\":\"e0000000-0000-0000-0000-000000000001\",\"no\":\"R-C\",\"channel\":\"takeaway\",\"method\":\"qris\",\"items\":[{\"product_id\":\"22222222-2222-2222-2222-222222222222\",\"qty\":1}]}'::jsonb)->>'already'" > /tmp/conc_same_$i 2>&1 &
done; wait
cat /tmp/conc_same_* | sort | uniq -c
# 20 different sales, same receipt number, in parallel
for i in $(seq 1 20); do
 id=$(printf 'f0000000-0000-0000-0000-%012d' $i)
 $Q -c "$setup select checkout('{\"id\":\"$id\",\"no\":\"R-DUP\",\"channel\":\"takeaway\",\"method\":\"qris\",\"items\":[{\"product_id\":\"22222222-2222-2222-2222-222222222222\",\"qty\":2}]}'::jsonb)->>'no'" > /tmp/conc_n_$i 2>&1 &
done; wait
cat /tmp/conc_n_* | grep -c ERROR
$Q -c "select count(*) filter (where no='R-DUP') as keep_orig, count(distinct no) as distinct_no, count(*) as n from sales where id::text like 'f0000000%'"
