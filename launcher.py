# -*- coding: utf-8 -*-
"""小红书工作台 —— 启动入口（开源部分）

职责只有三件：
  1. 找到闭源内核（releases/app-*.zip）
  2. 校验它的 sha256（如果仓库里有 SHA256SUMS.txt）
  3. 把它挂到 sys.path 并启动

业务逻辑全部在内核里，本文件不含任何业务代码。
"""
import hashlib
import os
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
os.environ.setdefault("XHS_HOME", str(BASE))


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _expected_sums():
    p = BASE / "SHA256SUMS.txt"
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            out[parts[-1].lstrip("*")] = parts[0].lower()
    return out


def find_core():
    """按优先级找内核：app.zip → releases 下最新的 app-*.zip → 环境变量。"""
    env = os.environ.get("XHS_APP", "").strip()
    if env and Path(env).exists():
        return Path(env)

    direct = BASE / "app.zip"
    if direct.exists():
        return direct

    rel = BASE / "releases"
    if rel.is_dir():
        cands = sorted(rel.glob("app-*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
        if cands:
            return cands[0]
    return None


def verify(core):
    sums = _expected_sums()
    if not sums:
        print("[warn] 没有 SHA256SUMS.txt，跳过完整性校验")
        return True
    want = sums.get(core.name)
    if not want:
        print(f"[warn] SHA256SUMS.txt 里没有 {core.name} 的记录，跳过校验")
        return True
    got = _sha256(core)
    if got != want:
        print(f"[err ] 内核校验失败，文件可能损坏或被篡改\n  期望 {want}\n  实际 {got}")
        return False
    print(f"[ ok ] 内核校验通过 {core.name}")
    return True


def _pause():
    try:
        _pause()
    except Exception:
        pass


def main():
    core = find_core()
    if core is None:
        print("=" * 56)
        print("  找不到内核文件")
        print("=" * 56)
        print()
        print("这个仓库只开源了前端和启动器，内核是编译好的独立发布物。")
        print("请按下面两步操作：")
        print()
        print("  1. 打开右侧 Releases 页面")
        print("  2. 下载 app-x.y.z.zip，放到本目录的 releases/ 文件夹里")
        print()
        print(f"目标路径示例：{BASE / 'releases' / 'app-1.0.0.zip'}")
        print()
        _pause()
        return 1

    if not verify(core):
        _pause()
        return 1

    sys.path.insert(0, str(core))
    try:
        import server
    except ModuleNotFoundError as e:
        print(f"[err ] 内核加载失败：{e}")
        print()
        print("常见原因：")
        print("  · Python 版本不符（内核需要 Python 3.11，.pyc 与次版本绑定）")
        print(f"  · 当前版本：{sys.version.split()[0]}")
        _pause()
        return 1

    server.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
