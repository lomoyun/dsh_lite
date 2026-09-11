"""One request per x86 process. Pinned PTM profiles; strict finite-output validation."""
from __future__ import annotations
import ctypes as ct
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys
import threading
import time
import mche_driver as mche
import native_binding
from topology_validation import validate_topology

CONTRACT = json.loads(Path(__file__).with_name('contract.json').read_text(encoding='utf8'))
PROFILE_DIGEST = hashlib.sha256(json.dumps(CONTRACT, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8')).hexdigest()
TOPOLOGY_CONTRACT = json.loads(Path(__file__).with_name('topology-contract.json').read_text(encoding='utf8'))
TOPOLOGY_DIGEST = hashlib.sha256(json.dumps(dict(base=CONTRACT, topology=TOPOLOGY_CONTRACT), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8')).hexdigest()
RESULT_NAMES = {0: 'heatLoadW', 11: 'refrigerantMassFlowKgS', 16: 'airPressureDropPa', 17: 'refrigerantPressureDropPa',
                21: 'airOutletTemperatureK', 23: 'airOutletHumidityPercent', 24: 'refrigerantOutletPressurePa',
                25: 'refrigerantOutletTemperatureK', 26: 'refrigerantOutletQuality'}

def emit(run_id, kind, **kwargs):
    print(json.dumps(dict(protocolVersion=1, runId=run_id, type=kind, **kwargs), ensure_ascii=True, allow_nan=False), flush=True)

def number(value):
    return type(value) in (int, float) and math.isfinite(value)

def validate(request):
    arrays = {'general':16,'tube':70,'fin':50,'refrigerant':15,'air':8,'correlation':12,'dehumidification':3,
              'residual':12,'interlaced':3,'resistance':6,'fan_coefficients':10,'result_slots':64}
    scalar_keys = {'profileId','profileDigest','mapperVersion','fin_conductivity','non_uniform_type','connection','header',
                   'refrigerant_flow_type','refrigerant_name','uniform_refrigerant_distribution','air_flow_direction',
                   'automatic_correlation','resistance_model'}
    if type(request) is not dict or set(request) != set(arrays) | scalar_keys:
        raise ValueError('Unexpected native request fields')
    for key, length in arrays.items():
        value = request[key]
        if type(value) is not list or len(value) != length or not all(number(v) for v in value):
            raise ValueError(f'{key}: expected {length} finite numbers')
    multi = request['profileId'] == TOPOLOGY_CONTRACT['id']
    profile, profile_digest = (TOPOLOGY_CONTRACT, TOPOLOGY_DIGEST) if multi else (CONTRACT, PROFILE_DIGEST)
    if request['profileId'] != profile['id'] or request['profileDigest'] != profile_digest or type(request['mapperVersion']) is not int or request['mapperVersion'] != profile['mapperVersion']:
        raise ValueError('Profile / mapper version mismatch')
    for key in ['general','correlation','dehumidification','residual','interlaced']:
        expected = list(CONTRACT['settings'][key])
        if multi and key == 'general': expected[1], expected[9] = request[key][1], request[key][9]
        if request[key] != expected: raise ValueError(f'Unsupported {key} model settings')
    for key in ['non_uniform_type','refrigerant_flow_type','resistance_model']:
        if type(request[key]) is not int or request[key] != 0: raise ValueError(f'Unsupported {key}')
    if request['uniform_refrigerant_distribution'] is not True or request['automatic_correlation'] is not False:
        raise ValueError('Only uniform distribution and pinned correlations supported')
    if type(request['air_flow_direction']) is not int or request['air_flow_direction'] not in [-1, 1]: raise ValueError('Air direction required')
    binding = CONTRACT['fluidBindings'].get(request['refrigerant_name'])
    if binding is None: raise ValueError('Unverified fluid binding')
    t, f, r, a = [request[k] for k in ['tube','fin','refrigerant','air']]
    for label, value, upper in [('tube count',t[1],500),('port count',t[6],500),('louver count',f[6],1000)]:
        if not float(value).is_integer() or value < (0 if label == 'louver count' else 1) or value > upper: raise ValueError(label)
    for value in [t[2],t[3],t[4],t[7],t[8],f[2],f[3],f[4],f[5],f[7],f[9],r[3],r[4],r[6],a[1],a[2],a[6]]:
        if value <= 0: raise ValueError('Positive physical input required')
    if t[9] < 0 or not 0 <= f[8] <= 90 or not 0 <= a[3] <= 100 or t[7] >= t[3] or t[8]*t[6] >= t[4] or f[5] >= f[3]:
        raise ValueError('Physical geometry or boundary range invalid')
    if not number(request['fin_conductivity']) or request['fin_conductivity'] <= 0: raise ValueError('Fin conductivity required')
    if multi: validate_topology(request, TOPOLOGY_CONTRACT)
    elif t[0] != 0 or t[5] != 0 or any(t[10:]): raise ValueError('Only rectangular uniform tube geometry supported')
    if f[0:2] != [0,1] or f[10:] != [1 if i % 10 == 1 else 0 for i in range(40)]: raise ValueError('Only uniform louver fin geometry supported')
    if r[0:3] != [binding['numericSlot'],0,0] or any(r[i] for i in [5,7,8,9,10,11,12,13,14]): raise ValueError('Only PTM boundary supported')
    if [a[i] for i in [0,4,5,7]] != [0,0,1,0]: raise ValueError('Only PTRH volume boundary supported')
    if not multi and request['connection'] != [[0,1,0],[-1,0,1],[0,-1,0]]: raise ValueError('Single pass connection required')
    h = request['header']
    if not multi and (type(h) is not list or len(h) != 1 or type(h[0]) is not list or len(h[0]) != 4 or any(type(v) is not int for v in h[0]) or h[0][:2] != [1,t[1]] or h[0][2] not in [-1,1] or h[0][3] != 0):
        raise ValueError('Single row header matrix invalid')
    if any(type(row) is not list or any(type(v) is not int for v in row) for row in request['connection']): raise ValueError('Integer connection matrix required')
    if any(request[k][i] != 0 for k in ['resistance','fan_coefficients','result_slots'] for i in range(len(request[k]))):
        raise ValueError('Inactive fan/resistance and output buffers must be initialized')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def environment(runtime_root):
    if os.name != 'nt' or struct.calcsize('P') != 4: raise RuntimeError('Windows x86 Python required')
    runtime_root = runtime_root.resolve(strict=True)
    host_shdll = Path(sys.executable).resolve().parent / 'SHDLL'
    if not host_shdll.is_dir() or not os.path.samefile(host_shdll, runtime_root / 'SHDLL'):
        raise RuntimeError('Python SHDLL must resolve to this project runtime/SHDLL')
    manifest = {}
    for relative, expected in CONTRACT['runtimeFiles'].items():
        actual = sha(runtime_root / relative)
        if actual != expected: raise RuntimeError(f'Runtime hash mismatch: {relative}')
        manifest[relative] = actual
    handles = [os.add_dll_directory(str(runtime_root)), os.add_dll_directory(str(host_shdll))]
    # Preload exactly the verified file. Keep module/search handles alive through the call.
    shprop = ct.CDLL(str(host_shdll / 'SHProp.dll'))
    get_path = ct.windll.kernel32.GetModuleFileNameW
    get_path.argtypes = [ct.c_void_p, ct.c_wchar_p, ct.c_uint]; get_path.restype = ct.c_uint
    buffer = ct.create_unicode_buffer(32768)
    if not get_path(shprop._handle, buffer, len(buffer)) or not os.path.samefile(buffer.value, runtime_root / 'SHDLL' / 'SHProp.dll'):
        raise RuntimeError('Unexpected SHProp load location')
    library = mche.MCHELibrary(runtime_root)
    return dict(ready=True, bits=32, python=sys.executable, runtimeRoot=str(runtime_root), loadedSHProp=buffer.value,
                profileDigest=PROFILE_DIGEST, topologyProfileDigest=TOPOLOGY_DIGEST, files=manifest), (handles, shprop, library)

def run():
    run_id = 'unknown'
    try:
        line = sys.stdin.readline(1024*1024+1)
        if len(line) > 1024*1024: raise ValueError('Command exceeds limit')
        command = json.loads(line)
        if command.get('protocolVersion') != 1 or command.get('type') not in ['probe','run']: raise ValueError('Invalid protocol')
        run_id = command['runId']; runtime_root = Path(command['runtimeRoot'])
        if command['type'] == 'run': validate(command['request'])
        info, keepalive = environment(runtime_root)
        emit(run_id, 'environment', environment=info)
        if command['type'] == 'probe': return 0
        stop = ct.c_bool(False)
        def cancel():
            for line in sys.stdin:
                try:
                    msg = json.loads(line)
                    if msg.get('type') == 'cancel' and msg.get('runId') == run_id: stop.value = True; return
                except ValueError: pass
        threading.Thread(target=cancel, daemon=True).start()
        request = {**command['request'], 'refrigerant_liquid_distribution': [], 'refrigerant_vapor_distribution': []}
        emit(run_id, 'stage', stage='solving')
        start = time.monotonic()
        success, error, raw = native_binding.execute(request, runtime_root, stop)
        finite = all(math.isfinite(v) for v in raw)
        serialized = [v if math.isfinite(v) else {'nonFinite':str(v)} for v in raw]
        if not finite: success = False; error = (error + '; non-finite native output').strip('; ')
        if error: success = False
        emit(run_id, 'result', success=bool(success and not stop.value), error=error, rawResult=serialized,
             actual={name:serialized[index] for index,name in RESULT_NAMES.items()}, cancelRequested=stop.value,
             elapsedMs=round((time.monotonic()-start)*1000))
        return 0 if success else 2
    except Exception as error:
        emit(run_id, 'error', error=f'{type(error).__name__}: {error}')
        return 1

if __name__ == '__main__': raise SystemExit(run())
