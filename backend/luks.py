import re
import shutil

from . import udisks_view

WRONG_PASSPHRASE_HINTS = ("operation not permitted", "failed to activate", "no key available", "incorrect passphrase", "bad passphrase")
UNLOCKED_AS = re.compile(r"\bas (/dev/\S+?)\.?\s*$")
LUKS_FSTYPE = "crypto_LUKS"


def _result(ok: bool, **extra) -> dict:
    return {"ok": ok, **extra}


class LuksSupport:

    def _is_luks(self, device: str) -> bool:
        return self._fs_info(device)[0] == LUKS_FSTYPE

    def _unlock(self, device: str, passphrase: str) -> tuple[str | None, dict | None]:
        process = self._run(["udisksctl", "unlock", "-b", device, "--key-file", "/dev/stdin", "--no-user-interaction"], input_text=passphrase)
        output = (process.stderr or process.stdout).strip()
        if process.returncode == 0:
            match = UNLOCKED_AS.search(output)
            return (match.group(1) if match else None, None)

        lowered = output.lower()
        if "alreadyunlocked" in lowered or "already unlocked" in lowered:
            return (None, None)
        if any(hint in lowered for hint in WRONG_PASSPHRASE_HINTS):
            return (None, _result(False, needs_passphrase=True, wrong_passphrase=True))
        return (None, _result(False, error=output or "Não foi possível desbloquear o dispositivo"))

    def _mount_encrypted(self, device: str, password: str | None, passphrase: str | None) -> dict:
        state = udisks_view.container_state(device)
        cleartext = state["cleartext"] if state else None

        if cleartext is None:
            if passphrase is None:
                return _result(False, needs_passphrase=True)
            if not shutil.which("udisksctl"):
                return _result(False, error="O udisks (udisksctl) é necessário para desbloquear dispositivos criptografados")
            cleartext, failure = self._unlock(device, passphrase)
            if failure:
                return failure
            if cleartext is None:
                state = udisks_view.container_state(device)
                cleartext = state["cleartext"] if state else None

        if not cleartext:
            return _result(False, error="Não foi possível desbloquear o dispositivo")
        return self._mount_blocking(cleartext, password)

    def _lock(self, backing: str) -> None:
        if shutil.which("udisksctl"):
            self._run(["udisksctl", "lock", "-b", backing, "--no-user-interaction"])
