import os


def user_home() -> str:
    try:
        import decky
        home = getattr(decky, "DECKY_USER_HOME", None)
        if home and os.path.isdir(home):
            return home
    except ImportError:
        pass

    home = os.environ.get("DECKY_USER_HOME")
    if home and os.path.isdir(home):
        return home

    home = os.path.expanduser("~")
    if os.path.isdir(home):
        return home
    return "/home/deck"


def expand_user_path(path: str | None) -> str:
    value = (path or "").strip()
    if value == "~":
        return user_home()
    if value.startswith("~/"):
        return os.path.join(user_home(), value[2:])
    return os.path.expanduser(value)
