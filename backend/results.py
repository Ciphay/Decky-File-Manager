import functools

from .operations_progress import OperationCancelled


def as_result(func):

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except OperationCancelled as e:
            return {"success": False, "ok": False, "cancelled": True, "error": str(e)}
        except Exception as e:
            return {"success": False, "ok": False, "error": str(e) or e.__class__.__name__}

    return wrapper
