
import os

_TYPE_MAP = 0x00
_TYPE_STRING = 0x01
_TYPE_INT32 = 0x02
_TYPE_FLOAT = 0x03
_TYPE_PTR = 0x04
_TYPE_WSTRING = 0x05
_TYPE_COLOR = 0x06
_TYPE_UINT64 = 0x07
_TYPE_END = 0x08
_TYPE_INT64 = 0x0A


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def cstring(self) -> str:
        end = self.data.index(b"\x00", self.pos)
        value = self.data[self.pos:end].decode("utf-8", errors="replace")
        self.pos = end + 1
        return value

    def number(self, size: int) -> int:
        value = int.from_bytes(self.data[self.pos:self.pos + size], "little")
        self.pos += size
        return value

    def read_map(self, depth: int = 0) -> dict:
        if depth > 8:
            raise ValueError("VDF muito profundo")
        result: dict = {}
        while self.pos < len(self.data):
            kind = self.data[self.pos]
            self.pos += 1
            if kind == _TYPE_END:
                return result
            key = self.cstring().lower()
            if kind == _TYPE_MAP:
                result[key] = self.read_map(depth + 1)
            elif kind == _TYPE_STRING:
                result[key] = self.cstring()
            elif kind in (_TYPE_INT32, _TYPE_FLOAT, _TYPE_PTR, _TYPE_COLOR):
                result[key] = self.number(4)
            elif kind in (_TYPE_UINT64, _TYPE_INT64):
                result[key] = self.number(8)
            elif kind == _TYPE_WSTRING:
                end = self.data.index(b"\x00\x00", self.pos)
                result[key] = self.data[self.pos:end].decode("utf-16-le", errors="replace")
                self.pos = end + 2
            else:
                raise ValueError(f"Tipo VDF desconhecido: {kind}")
        return result


_cache: dict[str, tuple[float, list[dict]]] = {}


def read_shortcuts(path: str) -> list[dict]:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return []
    cached = _cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        with open(path, "rb") as f:
            root = _Reader(f.read()).read_map()
    except (OSError, ValueError):
        return []

    entries = []
    shortcuts = root.get("shortcuts", {})
    for entry in shortcuts.values() if isinstance(shortcuts, dict) else []:
        if not isinstance(entry, dict):
            continue
        appid = entry.get("appid")
        entries.append({
            "appid": appid & 0xFFFFFFFF if isinstance(appid, int) else None,
            "name": str(entry.get("appname") or entry.get("name") or ""),
            "exe": str(entry.get("exe") or ""),
            "start_dir": str(entry.get("startdir") or ""),
        })
    _cache[path] = (mtime, entries)
    return entries
