#!/bin/bash
# Re-merge all craftlog session files into merged.jsonl
# Usage: ./merge.sh
#
# This will:
#   1. Read existing merged.jsonl + all S_*.jsonl session files
#   2. Deduplicate entries
#   3. Recalculate elapsed_ms across sessions
#   4. Write the result back to merged.jsonl

cd "$(dirname "$0")"
node merge-craftlog.js
