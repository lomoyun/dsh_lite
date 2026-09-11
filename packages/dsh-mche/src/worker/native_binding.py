from __future__ import annotations

import ctypes as ct
import hashlib
import json
import math
import sys
import threading
from pathlib import Path
from typing import Any

import mche_driver as mche

PROTOCOL_VERSION = 1
RESULT_NAMES = {
    0: "total_heat_load_w",
    11: "refrigerant_mass_flow_kg_s",
    16: "air_pressure_drop_pa",
    17: "refrigerant_pressure_drop_pa",
    21: "air_outlet_temperature_k",
    23: "air_outlet_rh_percent",
    24: "refrigerant_outlet_pressure_pa",
    25: "refrigerant_outlet_temperature_k",
    35: "fin_effectiveness",
    36: "air_htc_w_m2k",
    37: "refrigerant_htc_w_m2k",
}


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=True, allow_nan=False), flush=True)


def event(run_id: str, event_type: str, **payload: Any) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "type": event_type,
        "run_id": run_id,
        **payload,
    }


def read_run_command() -> tuple[str, Path, dict[str, Any]]:
    line = sys.stdin.readline()
    if not line:
        raise ValueError("Missing run command")
    command = json.loads(line)
    if command.get("protocol_version") != PROTOCOL_VERSION:
        raise ValueError("Unsupported protocol version")
    if command.get("type") != "run":
        raise ValueError("First command must be run")
    run_id = str(command["run_id"])
    runtime_root = Path(str(command["runtime_root"]))
    request = command["request"]
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    return run_id, runtime_root, request


def listen_for_cancel(run_id: str, stop: ct.c_bool) -> None:
    for line in sys.stdin:
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            continue
        if command.get("type") == "cancel" and command.get("run_id") == run_id:
            stop.value = True
            return


def double_array(values: list[float]) -> ct.Array[Any]:
    return (ct.c_double * len(values))(*values)


def int_array(values: list[int]) -> ct.Array[Any]:
    return (ct.c_int * len(values))(*values)


def optional_double_matrix(
    values: list[list[float]],
) -> tuple[mche.MatrixBuffer[ct.c_double] | None, Any]:
    if not values:
        return None, mche.PPDouble()
    buffer = mche.make_double_matrix(values)
    return buffer, buffer.pointer


def execute(
    request: dict[str, Any],
    runtime_root: Path,
    stop: ct.c_bool,
) -> tuple[bool, str, list[float]]:
    library = mche.MCHELibrary(runtime_root)
    connection = mche.make_int_matrix(request["connection"])
    header = mche.make_int_matrix(request["header"])
    liquid_buffer, liquid_pointer = optional_double_matrix(
        request["refrigerant_liquid_distribution"]
    )
    vapor_buffer, vapor_pointer = optional_double_matrix(
        request["refrigerant_vapor_distribution"]
    )
    _keep_alive = (liquid_buffer, vapor_buffer)
    arrays = _build_arrays(request)
    error = ct.create_string_buffer(1024)
    success = _call_condenser(
        library, request, arrays, connection, header,
        liquid_pointer, vapor_pointer, stop, error,
    )
    result = [float(item) for item in arrays["result"]]
    return success, error.value.decode("gbk", errors="replace"), result


def _call_condenser(
    library: Any,
    request: dict[str, Any],
    arrays: dict[str, ct.Array[Any]],
    connection: Any,
    header: Any,
    liquid_pointer: Any,
    vapor_pointer: Any,
    stop: ct.c_bool,
    error: Any,
) -> bool:
    arguments = _condenser_arguments(
        library, request, arrays, connection, header,
        liquid_pointer, vapor_pointer, stop, error,
    )
    return bool(library.calc_condenser(*arguments))


def _condenser_arguments(
    library: Any, request: dict[str, Any], arrays: dict[str, ct.Array[Any]],
    connection: Any, header: Any, liquid_pointer: Any, vapor_pointer: Any,
    stop: ct.c_bool, error: Any,
) -> tuple[Any, ...]:
    geometry = (
        library.main_path_bytes, arrays["general"], arrays["tube"], arrays["fin"],
        float(request["fin_conductivity"]), arrays["interlaced"],
        int(request["non_uniform_type"]), connection.pointer, header.pointer,
        len(request["header"]), int(request["refrigerant_flow_type"]),
        arrays["residual"],
    )
    refrigerant = (
        str(request["refrigerant_name"]).encode("gbk"), arrays["refrigerant"],
        bool(request["uniform_refrigerant_distribution"]), liquid_pointer, vapor_pointer,
        0, 0, mche.PPDouble(), mche.PDouble(), 0, mche.PPDouble(), 0,
        mche.PPDouble(), 0, mche.PPInt(), 0,
    )
    air_and_control = (
        int(request["air_flow_direction"]), arrays["air"], mche.PPDouble(),
        mche.PPDouble(), 0, bool(request["automatic_correlation"]),
        arrays["correlation"], arrays["dehumidification"], ct.byref(stop),
    )
    outputs = (
        arrays["result"], error, int(request["resistance_model"]),
        arrays["resistance"], arrays["fan"],
    )
    return geometry + refrigerant + air_and_control + outputs

def _build_arrays(request: dict[str, Any]) -> dict[str, ct.Array[Any]]:
    return {
        "general": double_array(request["general"]),
        "tube": double_array(request["tube"]),
        "fin": double_array(request["fin"]),
        "interlaced": int_array(request["interlaced"]),
        "residual": double_array(request["residual"]),
        "refrigerant": double_array(request["refrigerant"]),
        "air": double_array(request["air"]),
        "correlation": double_array(request["correlation"]),
        "dehumidification": double_array(request["dehumidification"]),
        "result": double_array(request["result_slots"]),
        "resistance": double_array(request["resistance"]),
        "fan": double_array(request["fan_coefficients"]),
    }

