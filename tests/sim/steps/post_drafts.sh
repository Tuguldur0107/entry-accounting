#!/bin/bash
# post_drafts.sh ORG YYYY-MM : журналын бүх ноорог (post_jv) + AR/AP ноорог
ORG=$1; YM=$2; cd "$(dirname "$0")/.."
for no in $(python3 - <<PY
import sys; sys.path.insert(0,'common')
from mcp import Client
ok,t=Client('$ORG').call('list_journal_vouchers',{'status':'draft','limit':100},'post')
import re; print(' '.join(sorted(set(re.findall(r'((?:GL|CM|PAY|FX|COST|CL|YE)-\d\d-\d{6})',t)))))
PY
); do SIM_ORG=$ORG node web/post_jv.mjs $YM $no $no 2>&1 | grep -E "toast|NOT FOUND|dlg" | sed "s/^/$no: /"; done
SIM_ORG=$ORG node web/post_arap_all.mjs receivables $YM ar-$YM 2>&1 | tail -1
SIM_ORG=$ORG node web/post_arap_all.mjs payables $YM ap-$YM 2>&1 | tail -1
