"""Linux 预览入口：只读原件、隔离文件系统和网络，限制整个进程组。"""
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time

TIMEOUT_SECONDS = 55
MEMORY_BYTES = 1536 * 1024 * 1024
OUTPUT_BYTES = 20 * 1024 * 1024


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_BYTES, OUTPUT_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def command(job):
    runner = Path(__file__).resolve().parent / "uno_export.py"
    args = ["bwrap", "--die-with-parent", "--unshare-all", "--new-session",
            "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib"]
    for path in ["/lib64", "/etc/fonts", "/etc/ld.so.cache", "/etc/libreoffice"]:
        if Path(path).exists():
            args += ["--ro-bind", path, path]
    args += ["--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin",
             "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
             "--dir", "/run", "--dir", "/etc", "--dir", "/input",
             "--ro-bind", str(job / "input"), "/input",
             "--ro-bind", str(runner), "/runner.py",
             "--bind", str(job / "output"), "/output",
             "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
             "--setenv", "HOME", "/tmp", "--setenv", "LANG", "C.UTF-8",
             "--setenv", "SAL_USE_VCLPLUGIN", "svp",
             "/usr/bin/python3", "/runner.py"]
    return args


def main():
    job = Path(sys.argv[1]).resolve(strict=True)
    process = subprocess.Popen(command(job), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True, preexec_fn=limits)
    try:
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while True:
            total = sum(path.stat().st_size for path in (job / "output").iterdir())
            if total > OUTPUT_BYTES or time.monotonic() >= deadline:
                raise RuntimeError("预览超过输出大小或时间限制")
            try:
                stdout, stderr = process.communicate(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            raise RuntimeError("隔离渲染失败：" + stderr.decode(errors="replace")[-1200:])
        total = sum(path.stat().st_size for path in (job / "output").iterdir())
        if total > OUTPUT_BYTES:
            raise RuntimeError("预览输出超过 20 MB 限制")
        print(stdout.decode(errors="replace"))
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
