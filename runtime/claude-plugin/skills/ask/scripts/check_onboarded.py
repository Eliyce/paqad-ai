#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

STOP_MESSAGE = ("This repository isn't set up for this yet. Ask your engineering team to "
                "onboard it with paqad, then come back.")
PARTLY_MESSAGE = ("This project's list of areas is missing, so I'm working from the area "
                  "summaries it has. Areas without a summary are shown as unknown.")

READY = "ready"
PARTLY_READY = "partly-ready"
NOT_SET_UP = "not-set-up"

REGISTRY_PARTS = ("docs", "instructions", "registries", "modules.md")
MODULES_PARTS = ("docs", "modules")
SUMMARY_PARTS = ("index", "summary.md")
HIDDEN_PREFIX = "."


def read_stripped(path):
    try:
        if not path.is_file():
            return ""
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return ""


def area_names(modules_dir):
    try:
        return sorted(
            child.name
            for child in modules_dir.iterdir()
            if child.is_dir() and not child.name.startswith(HIDDEN_PREFIX)
        )
    except OSError:
        return []


def area_summaries(modules_dir):
    modules_dir = Path(modules_dir)
    return [
        (area, read_stripped(modules_dir.joinpath(area, *SUMMARY_PARTS)))
        for area in area_names(modules_dir)
    ]


def onboarded_state(root):
    root = Path(root)
    summaries = area_summaries(root.joinpath(*MODULES_PARTS))
    summarised = [area for area, text in summaries if text]
    unknown = [area for area, text in summaries if not text]
    if not summarised:
        state = NOT_SET_UP
    elif read_stripped(root.joinpath(*REGISTRY_PARTS)):
        state = READY
    else:
        state = PARTLY_READY
    return {"state": state, "summarised_areas": summarised, "unknown_areas": unknown}


def is_onboarded(root):
    return onboarded_state(root)["state"] == READY


def result_payload(result):
    state = result["state"]
    if state == NOT_SET_UP:
        return {"ok": False, "state": state, "message": STOP_MESSAGE}
    payload = {"ok": True, "state": state}
    if state == PARTLY_READY:
        payload["message"] = PARTLY_MESSAGE
    payload["unknown_areas"] = result["unknown_areas"]
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description="The GRD-1 onboarded check.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    payload = result_payload(onboarded_state(args.root))
    print(json.dumps(payload))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
