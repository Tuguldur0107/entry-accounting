#!/bin/bash
# Бүтэн гүйлт: setup → master → нээлт → сарууд. Хэрэглээ: ./run_org.sh B 2025-07 2025-08 2025-09
set -euo pipefail
cd "$(dirname "$0")"
ORG=$1; shift
export SIM_ORG=$ORG PYTHONUNBUFFERED=1
./setup_org.sh
python3 steps/master.py "$ORG"
python3 "steps/opening_$ORG.py"
[ -f "steps/setup_pos_$ORG.py" ] && python3 "steps/setup_pos_$ORG.py"
for m in "$@"; do python3 "steps/run_month_$ORG.py" "$m"; done
echo ALL_DONE
