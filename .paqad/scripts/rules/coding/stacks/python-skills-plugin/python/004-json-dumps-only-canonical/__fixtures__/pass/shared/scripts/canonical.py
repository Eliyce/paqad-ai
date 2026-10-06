import json


def dump(obj):
    return json.dumps(obj, sort_keys=True)
