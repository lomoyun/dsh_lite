"""Fault injection only: never emits a simulated successful numerical result."""
import json
import os
import sys
import time
command = json.loads(sys.stdin.readline())
mode = command['request']['mode']
if mode == 'crash': os._exit(7)
if mode == 'invalid': print('invalid json', flush=True)
if mode == 'nonfinite':
    print(json.dumps(dict(protocolVersion=1,runId=command['runId'],type='result',success=True,rawResult=[None]*64)),flush=True)
    sys.exit(0)
# Intentionally ignores cancellation so the parent must stop THIS child after two seconds.
time.sleep(60)
