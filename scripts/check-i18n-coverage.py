"""i18n coverage check: every t("key") the CODE calls must exist in messages.

check-locale-parity.py verifies EN against ID — which passes even when BOTH
files are missing a key the code references. That shipped a broken button
label through all gates (the log-activity button rendered its own key path).

This walks the source instead: for each file, resolve the namespace each
translations hook is bound to, then verify every <hook>("key") call resolves
to a real key in BOTH en.json and id.json.

Known limits (deliberate):
  - useTranslations() with no namespace and dotted keys ("dashboard.welcome")
    are checked as full paths.
  - Dynamic keys (t(`modules.${m}`)) are skipped — template literals can't be
    resolved statically.
"""
import json
import re
import sys
from pathlib import Path

WEB = Path("/home/dev/project/carelog/web/src")
MSGS = {loc: json.loads((WEB / "messages" / f"{loc}.json").read_text()) for loc in ("en", "id")}

# const t = useTranslations("ns")   |  const x = useTranslations("ns")
HOOK = re.compile(
    r'const\s+(\w+)\s*=\s*useTranslations\(\s*["\']([^"\']*)["\']\s*\)'
)
# Server form: const t = await getTranslations({ locale, namespace: "ns" })
SRV = re.compile(
    r'const\s+(\w+)\s*=\s*await\s+getTranslations\(\s*\{[^}]*namespace:\s*["\']([^"\']*)["\']'
)
# A call: t("key") or t('key') — not template literals, not t(var)
CALL = re.compile(r'\b(\w+)\(\s*["\']([A-Za-z0-9_.]+)["\']\s*\)')

# also <var>("a.b.c") for namespace-less hooks resolves as a full path
missing = []
unmounted = []
files = sorted(p for p in WEB.rglob("*.tsx") if "messages" not in p.parts)

def lookup(d, path):
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return True

# A component file is "mounted" if any other file imports it. Unmounted
# components can't render, so their key references can't break the UI — they
# are reported separately instead of failing the check. Pages/layouts are
# mounted by definition (the router imports them).
IMPORT = re.compile(r'from\s+["\'][^"\']*/(?P<stem>[\w-]+)["\']')
for f in files:
    if f.name in ("layout.tsx", "page.tsx"):
        continue
    imported_stems = set()
    for p in files:
        if p == f:
            continue
        imported_stems.update(m.group("stem") for m in IMPORT.finditer(p.read_text()))
    if f.stem not in imported_stems:
        unmounted.append(str(f.relative_to(WEB)))

for f in files:
    if str(f.relative_to(WEB)) in unmounted:
        continue
    text = f.read_text()
    # A var may be re-bound to different namespaces in different components
    # within one file (common: `const t = useTranslations(...)` in several
    # components). Collect ALL namespaces per var; a reference is only broken
    # if it resolves under none of them.
    hooks: dict[str, set[str]] = {}
    for m in HOOK.finditer(text):
        hooks.setdefault(m.group(1), set()).add(m.group(2))
    for m in SRV.finditer(text):
        hooks.setdefault(m.group(1), set()).add(m.group(2))
    if not hooks:
        continue
    for m in CALL.finditer(text):
        var, key = m.group(1), m.group(2)
        namespaces = hooks.get(var)
        if not namespaces:
            continue
        for loc, d in MSGS.items():
            if not any(
                lookup(d, f"{ns}.{key}" if ns else key) for ns in namespaces
            ):
                missing.append(
                    (str(f.relative_to(WEB)), var, key, sorted(namespaces), loc)
                )

if missing:
    print(f"MISSING KEY REFERENCES ({len(missing)}):")
    for f, var, key, namespaces, loc in missing:
        print(f"  {f}: {var}(\"{key}\") under any of {namespaces} absent from {loc}.json")
    print("\nRESULT: COVERAGE BROKEN")
    sys.exit(1)

if unmounted:
    print("UNMOUNTED COMPONENTS (not imported anywhere; key refs not checked):")
    for f in unmounted:
        print(f"  {f}")
print("\nRESULT: COVERAGE OK")
