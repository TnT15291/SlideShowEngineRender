import contextlib
import json
import sys


def main():
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from vieneu import Vieneu
            engine = Vieneu()
    except Exception as exc:
        print(f"Cannot initialize VieNeu-TTS: {exc}", file=sys.stderr, flush=True)
        return 2

    for raw in sys.stdin:
        request = None
        try:
            request = json.loads(raw)
            with contextlib.redirect_stdout(sys.stderr):
                audio = engine.infer(
                    request["text"],
                    voice=request.get("voice") or None,
                    style=request.get("style") or "tin_tuc",
                )
                engine.save(audio, request["output"])
            response = {"id": request["id"], "ok": True}
        except Exception as exc:
            response = {"id": request.get("id") if request else None, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)

    with contextlib.redirect_stdout(sys.stderr):
        engine.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
