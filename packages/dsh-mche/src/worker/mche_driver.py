"""32 位 Python 下的 MCHEdll.dll ctypes 驱动。"""

from __future__ import annotations

import argparse
import ctypes as ct
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Generic, TypeVar

PDouble = ct.POINTER(ct.c_double)
PPDouble = ct.POINTER(PDouble)
PInt = ct.POINTER(ct.c_int)
PPInt = ct.POINTER(PInt)
PBool = ct.POINTER(ct.c_bool)

COMMON_ARGUMENTS = [
    ct.c_char_p,
    PDouble,
    PDouble,
    PDouble,
    ct.c_double,
    PInt,
    ct.c_int,
    PPInt,
    PPInt,
    ct.c_int,
    ct.c_int,
    PDouble,
    ct.c_char_p,
    PDouble,
    ct.c_bool,
    PPDouble,
    PPDouble,
    ct.c_int,
    ct.c_int,
    PPDouble,
    PDouble,
    ct.c_int,
    PPDouble,
    ct.c_int,
    PPDouble,
    ct.c_int,
    PPInt,
    ct.c_int,
    ct.c_int,
    PDouble,
    PPDouble,
    PPDouble,
    ct.c_int,
    ct.c_bool,
    PDouble,
    PDouble,
    PBool,
    PDouble,
    ct.c_char_p,
]


T = TypeVar("T", ct.c_double, ct.c_int)


@dataclass
class MatrixBuffer(Generic[T]):
    """保活 ctypes 二维数组及其行指针。"""

    rows: list[ct.Array[T]]
    row_pointers: ct.Array[ct.POINTER(T)]

    @property
    def pointer(self):
        return ct.cast(self.row_pointers, ct.POINTER(ct.POINTER(self.rows[0]._type_)))


def make_double_matrix(values: Sequence[Sequence[float]]) -> MatrixBuffer[ct.c_double]:
    return _make_matrix(values, ct.c_double)


def make_int_matrix(values: Sequence[Sequence[int]]) -> MatrixBuffer[ct.c_int]:
    return _make_matrix(values, ct.c_int)


def _make_matrix(values: Sequence[Sequence], scalar_type):
    if not values or any(not row for row in values):
        raise ValueError("二维数组不得为空")
    rows = [(scalar_type * len(row))(*row) for row in values]
    pointer_type = ct.POINTER(scalar_type)
    row_pointers = (pointer_type * len(rows))(
        *(ct.cast(row, pointer_type) for row in rows)
    )
    return MatrixBuffer(rows=rows, row_pointers=row_pointers)


class MCHELibrary:
    """加载 MCHE DLL，并公开带 ctypes 类型约束的三个计算函数。"""

    def __init__(self, runtime_root: Path) -> None:
        self.runtime_root = runtime_root.resolve()
        self.dll_path = self.runtime_root / "MCHEdll.dll"
        self.shdll_path = self.runtime_root / "SHDLL"
        self._dll_directories: list[object] = []
        self._validate_environment()
        self._prepare_dll_search_path()
        self.library = ct.CDLL(str(self.dll_path))
        self.calc_evaporator = self._bind_standard("CalcEvaporator")
        self.calc_condenser = self._bind_standard("CalcCondenser")
        self.batch_pass_condenser = self._bind_batch()

    def _validate_environment(self) -> None:
        if struct.calcsize("P") != 4:
            raise RuntimeError("MCHEdll.dll 是 32 位 DLL，必须使用 32 位 Python")
        required = [self.dll_path, self.shdll_path / "SHProp.dll"]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            raise FileNotFoundError("缺少运行文件：" + ", ".join(missing))
        (self.runtime_root / "Log").mkdir(exist_ok=True)

    def _prepare_dll_search_path(self) -> None:
        for directory in (self.runtime_root, self.shdll_path):
            self._dll_directories.append(os_add_dll_directory(directory))

    def _bind_standard(self, name: str):
        function = getattr(self.library, name)
        function.restype = ct.c_bool
        function.argtypes = [*COMMON_ARGUMENTS, ct.c_int, PDouble, PDouble]
        return function

    def _bind_batch(self):
        function = self.library.BatchPassConCal
        function.restype = ct.c_bool
        function.argtypes = [*COMMON_ARGUMENTS, ct.c_int, PInt, PInt]
        return function

    @property
    def main_path_bytes(self) -> bytes:
        return str(self.runtime_root).encode("gbk")


def os_add_dll_directory(directory: Path):
    """延长 add_dll_directory 返回对象的生命周期。"""

    return __import__("os").add_dll_directory(str(directory))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证并加载 MCHEdll.dll")
    parser.add_argument(
        "--runtime-root",
        type=Path,
        default=Path(__file__).resolve().parent / "资源包",
        help="包含 MCHEdll.dll 和 SHDLL 的运行根目录",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mche = MCHELibrary(args.runtime_root)
    print(f"Python pointer size: {struct.calcsize('P') * 8}-bit")
    print(f"Loaded: {mche.dll_path}")
    print("Exports: CalcEvaporator, CalcCondenser, BatchPassConCal")
    print(f"mainPath (GBK): {mche.main_path_bytes!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
