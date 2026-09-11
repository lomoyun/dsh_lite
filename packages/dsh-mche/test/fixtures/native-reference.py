"""Verification-only adapter to the separately maintained vendor example caller.

Arguments: reference directory, normalized request JSON, runtime root.
This is never loaded by the plugin or exposed to model tools.
"""
import importlib.util
import json
import math
from pathlib import Path
import sys

reference = Path(sys.argv[1])
sys.path.insert(0, str(reference))
spec = importlib.util.spec_from_file_location('independent_ltr', reference / 'run_ltr_case.py')
example = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = example
spec.loader.exec_module(example)
request = json.loads(Path(sys.argv[2]).read_text(encoding='utf8'))
buffers = example.CaseBuffers(
    general=example.double_array(request['general']),
    tube=example.double_array(request['tube']),
    fin=example.double_array(request['fin']),
    air=example.double_array(request['air']),
    refrigerant=example.double_array(request['refrigerant']),
    correlation=example.double_array(request['correlation']),
    dehumidification=example.double_array(request['dehumidification']),
    fin_conductivity=request['fin_conductivity'],
    connection=example.mche.make_int_matrix(request['connection']),
    header=example.mche.make_int_matrix(request['header']),
    refrigerant_name=request['refrigerant_name'].encode('gbk'),
)
case = {'InputData': {'NonUniform Type': request['non_uniform_type'],
                     'Ref. Flow Type': request['refrigerant_flow_type'],
                     'bUniformDis': request['uniform_refrigerant_distribution'],
                     'bAutoCor': request['automatic_correlation']},
        'Pass': {'HeadInf': request['header'], 'AirFlowInf': request['air_flow_direction']}}
success, error, raw = example.invoke(case, buffers, Path(sys.argv[3]))
print(json.dumps({'nativeReturn': success, 'error': error,
                  'rawResult': [v if math.isfinite(v) else {'nonFinite': str(v)} for v in raw]}, allow_nan=False))
