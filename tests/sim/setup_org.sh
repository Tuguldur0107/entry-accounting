#!/bin/bash
# Шинэ sim байгууллага: бүртгүүлэх → «Шууд бичих» горим → MCP token → стандарт данс.
# Хэрэглээ: SIM_ORG=B SIM_EMAIL=… SIM_NAME=… SIM_PASSWORD=… ./setup_org.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${SIM_ORG:?SIM_ORG}" "${SIM_EMAIL:?SIM_EMAIL}" "${SIM_PASSWORD:?SIM_PASSWORD}"
node web/register.mjs | tail -2
node web/direct_mode.mjs | tail -2
node web/token.mjs | tail -1
python3 -c "
import sys; sys.path.insert(0, 'common')
from mcp import Client
print(Client('$SIM_ORG').call('sync_standard_accounts', {}, tag='setup'))"
