"""EN/ID locale key parity check.

Bilingual parity is a project standard, and a missing key raises at render
time in next-intl — a runtime crash, not a build failure. So `pnpm build`
passing proves nothing here. This walks both trees and diffs the key sets.
"""
import json
import sys

BASE = "/home/dev/project/carelog/web/src/messages"


def flatten(obj, prefix=""):
    keys = set()
    for k, v in obj.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys |= flatten(v, path)
        else:
            keys.add(path)
    return keys


with open(f"{BASE}/en.json") as f:
    en = json.load(f)
with open(f"{BASE}/id.json") as f:
    idn = json.load(f)

en_keys = flatten(en)
id_keys = flatten(idn)

only_en = sorted(en_keys - id_keys)
only_id = sorted(id_keys - en_keys)

print(f"EN keys: {len(en_keys)}   ID keys: {len(id_keys)}")

if only_en:
    print(f"\nMISSING FROM id.json ({len(only_en)}):")
    for k in only_en:
        print(f"  - {k}")
if only_id:
    print(f"\nMISSING FROM en.json ({len(only_id)}):")
    for k in only_id:
        print(f"  - {k}")

# Untranslated: identical string in both files. Real matches (proper nouns,
# "Email") are fine, so this is a report, not a failure.
shared = en_keys & id_keys


def get(obj, path):
    cur = obj
    for part in path.split("."):
        cur = cur[part]
    return cur


identical = [k for k in sorted(shared) if get(en, k) == get(idn, k)]
if identical:
    print(f"\nIdentical in both (check if untranslated) ({len(identical)}):")
    for k in identical:
        print(f"  - {k} = {get(en, k)!r}")

print()
if only_en or only_id:
    print("RESULT: PARITY BROKEN")
    sys.exit(1)
print("RESULT: PARITY OK")
