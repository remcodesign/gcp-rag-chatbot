#!/usr/bin/env python3
"""Render a `terraform show -json` plan into a standalone, color-coded HTML page.

No third-party dependencies (stdlib only).

Usage:
    python3 plan_report.py <plan.json> -o <out.html>
"""

import argparse
import json
import sys

# ---------------------------------------------------------------------------
# Action classification -> (label, css class, hex color)
# ---------------------------------------------------------------------------

CATEGORIES = {
    "create": {"label": "NEW", "cls": "create", "color": "#1f9d55"},
    "update": {"label": "CHANGE", "cls": "update", "color": "#d69e2e"},
    "delete": {"label": "DELETE", "cls": "delete", "color": "#e53e3e"},
    "no-op": {"label": "UNCHANGED", "cls": "noop", "color": "#718096"},
    "replace": {"label": "REPLACE", "cls": "replace", "color": "#805ad5"},
    "read": {"label": "READ", "cls": "read", "color": "#3182ce"},
    "other": {"label": "OTHER", "cls": "other", "color": "#4a5568"},
}


def categorize(actions):
    a = list(actions)
    if a == ["no-op"]:
        return "no-op"
    if "create" in a and "delete" in a:
        # A replacement is emitted as create+delete (with <none> diff).
        return "replace"
    if a == ["create"]:
        return "create"
    if a == ["delete"]:
        return "delete"
    if "update" in a:
        return "update"
    if a == ["read"]:
        return "read"
    return "other"


def diff_attributes(before, after):
    """Return (added, removed, changed) top-level attribute names."""
    before = before or {}
    after = after or {}

    def sig(v):
        return json.dumps(v, sort_keys=True, default=str)

    before_keys = set(before.keys())
    after_keys = set(after.keys())

    added = sorted(after_keys - before_keys)
    removed = sorted(before_keys - after_keys)
    changed = sorted(
        k for k in (before_keys & after_keys)
        if sig(before.get(k)) != sig(after.get(k))
    )
    return added, removed, changed


def esc(s):
    if s is None:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# Attribute names that carry no meaningful diff signal.
NOISE_KEYS = {
    "id", "name", "self_link", "create_time", "update_time", "effective_labels",
    "terraform_labels", "labels", "timeouts", "input", "outputs", "description",
    "tags", "annotations", "machine_type", "provisioner", "lifecycle",
}


def _clean(v):
    """Drop noisy keys recursively so the diff shows signal only."""
    if isinstance(v, dict):
        return {
            k: _clean(x) for k, x in v.items()
            if k not in NOISE_KEYS and not (isinstance(x, (list, dict)) and len(x) == 0)
        }
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def render_diff(before, after):
    """Return (before_clean, after_clean, rows) for a side-by-side diff."""
    before = _clean(before or {})
    after = _clean(after or {})
    keys = sorted(set(before.keys()) | set(after.keys()))

    def val(v, k):
        return v.get(k, _MISSING)

    rows = []
    for k in keys:
        b = before.get(k, _MISSING)
        a = after.get(k, _MISSING)
        if b == a:
            continue  # unchanged, skip
        rows.append((k, b, a))
    return before, after, rows


_MISSING = object()


def fmt_val(v):
    """Compact single-line rendering for a diff value."""
    if v is _MISSING:
        return "<i class='d-missing'>—</i>"
    if isinstance(v, dict):
        return esc(json.dumps(v, sort_keys=True, default=str))
    if isinstance(v, list):
        return esc(json.dumps(v, sort_keys=True, default=str))
    s = json.dumps(v, ensure_ascii=False, sort_keys=True, default=str) if not isinstance(v, str) else v
    return esc(s)


def build(plan):
    """Classify every managed resource change and aggregate a summary."""
    summary = {
        "create": 0, "update": 0, "replace": 0, "delete": 0,
        "no-op": 0, "read": 0, "other": 0,
    }
    groups = []  # (category, address, raw_json, added, removed, changed)

    for rc in plan.get("resource_changes", []):
        if rc.get("mode") != "managed":       # skip data sources
            continue
        address = rc.get("address", "?")
        change = rc.get("change", {})
        actions = change.get("actions", [])
        cat = categorize(actions)
        summary[cat] += 1
        # Keep the raw Terraform object so the viewer can show full details.
        raw = {
            "address": address,
            "type": rc.get("type"),
            "actions": actions,
            "before": change.get("before"),
            "after": change.get("after"),
            "after_unknown": change.get("after_unknown"),
        }
        # NOTE: replaces (create+delete) DO carry `before`/`after` in the plan
        # JSON for real attribute changes (e.g. a rotated secret version forces a
        # replacement). We run the same diff as create/update so those changes
        # are surfaced; truly diff-less replaces still fall back to
        # "(no attr diff)" because diff_attributes/render_diff tolerate empty/
        # missing before/after.
        added, removed, changed_ks = diff_attributes(
            change.get("before"), change.get("after")
        )
        # Precompute the side-by-side diff for the card.
        b_clean, a_clean, diff_rows = render_diff(
            change.get("before"), change.get("after"))
        groups.append((cat, address, raw, added, removed, changed_ks,
                       diff_rows))

    return {"summary": summary, "groups": groups}


def render(plan, out_path):
    data = build(plan)
    summary = data["summary"]
    order = ["create", "update", "replace", "delete", "no-op", "read", "other"]
    labels = ["New", "Change", "Replace", "Delete", "Unchanged", "Read", "Other"]
    total = sum(summary.values())

    rows = []   # per-type section + cards, interleaved
    # Group resources by their Terraform provider type.
    by_type = {}
    for cat, address, raw, added, removed, changed_ks, diff_rows in data["groups"]:
        by_type.setdefault(raw.get("type", "misc"), []).append(
            (cat, address, raw, added, removed, changed_ks, diff_rows))

    counter = [0]  # mutable counter so rids stay unique across the whole view
    for gi, (rtype, items) in enumerate(sorted(by_type.items())):
        group_id = f"group{gi}"
        # Collapsible section container (header + cards). The container holds
        # `data-group`; toggling hides the group via a dedicated class list,
        # NOT `display:none` on the header row (that would remove it).
        cards = []
        for (cat, address, raw, added, removed, changed_ks, diff_rows) in items:
            info = CATEGORIES.get(cat, CATEGORIES["other"])
            attrs = []
            for k in added + changed_ks:
                attrs.append(f'<span class="badge added">+ {esc(k)}</span>')
            for k in removed:
                attrs.append(f'<span class="badge removed">- {esc(k)}</span>')
            attr_html = " ".join(attrs) if attrs else '<span class="muted">(no attr diff)</span>'
            rid = f"row{counter[0]}"; counter[0] += 1
            # Side-by-side diff: columns for attribute, before, after.
            diff_html = ""
            if diff_rows:
                trs = []
                for k, b, a in diff_rows:
                    trs.append(
                        f'<tr><td class="d-key"><code>{esc(k)}</code></td>'
                        f'<td class="d-before">{fmt_val(b)}</td>'
                        f'<td class="d-after">{fmt_val(a)}</td></tr>'
                    )
                diff_html = (
                    '<table class="diff"><thead>'
                    '<tr><th>attribute</th><th>before</th><th>after</th></tr>'
                    f'</thead><tbody>{"".join(trs)}</tbody></table>'
                )
            pretty = json.dumps(raw, indent=2, default=str)
            cards.append(
                f'<div class="card {info["cls"]}" data-type="{cat}" onclick="toggleCard(this)" data-id="{rid}">'
                f'<div class="card-head">'
                f'<span class="pill" style="background:{info["color"]}">{info["label"]}</span>'
                f'<span class="card-addr"><code>{esc(address)}</code></span>'
                f'<span class="card-toggle">▾</span>'
                f'</div>'
                f'<div class="card-attrs">{attr_html}</div>'
                f'<div class="card-diff">{diff_html}</div>'
                f'<div class="card-json" id="{rid}-detail"><pre class="json">{esc(pretty)}</pre></div>'
                f'</div>'
            )
        # Whole-group "unchanged": if every card in this type-group is a no-op
        # it is hidden as a unit (show via the toggle); mixed groups stay visible
        # and their no-op cards are hidden individually by the .noop CSS.
        group_is_unchanged = " unchanged" if all(it[0] == "no-op" for it in items) else ""
        rows.append(
            f'<section class="group{group_is_unchanged}" id="{group_id}">'
            f'<div class="group-head" data-group="{group_id}" onclick="toggleGroup(this)">'
            f'<span class="group-toggle">▾</span> '
            f'<span class="group-type">{esc(rtype)}</span> '
            f'<span class="group-count">{len(items)} resource{"s" if len(items) != 1 else ""}</span>'
            f'</div>'
            f'<div class="group-body">' + "\n".join(cards) + '</div>'
            f'</section>'
        )

    content_html = "\n".join(rows) if rows else (
        '<p class="none">No resource changes to show.</p>')

    summary_html = ""
    for name, label in zip(order, labels):
        v = summary.get(name, 0)
        pct = (v / total * 100) if total else 0
        color = CATEGORIES[name]["color"]
        summary_html += (
            f'<div class="stat" data-type="{name}" onclick="filterType(\'{name}\')">'
            f'<span class="num" style="color:{color}">{v}</span>'
            f'<span class="lbl">{label}</span><div class="bar" '
            f'style="width:{pct:.1f}%;background:{color};"></div></div>'
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terraform Plan Viewer</title>
<style>
  :root {{
    --bg:#0f172a; --panel:#1e293b; --text:#e2e8f0; --muted:#94a3b8; --line:#334155;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         background:var(--bg); color:var(--text); }}
  header {{ padding:24px 28px; border-bottom:1px solid var(--line);
            display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }}
  h1 {{ font-size:20px; margin:0; }}
  .meta {{ color:var(--muted); font-size:13px; }}
  .summary {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
             gap:12px; padding:20px 28px; background:var(--panel); border-bottom:1px solid var(--line); }}
  .stat {{ position:relative; padding:4px 0 22px; cursor:pointer; border-radius:8px; }}
  .stat:hover {{ background:#263449; }}
  .stat.active {{ outline:2px solid #7dd3fc; outline-offset:-2px; }}
  .num {{ font-size:26px; font-weight:700; }}
  .lbl {{ display:block; color:var(--muted); font-size:12px; margin-top:2px; }}
  .bar {{ position:absolute; left:0; bottom:0; height:4px; border-radius:2px; }}
  .content {{ padding:20px 28px 60px; }}
  .none {{ color:var(--muted); font-style:italic; }}
  .toolbar {{ padding:16px 28px 0; display:flex; gap:10px; align-items:center; }}
  .toolbar button {{ background:#1e293b; color:var(--text); border:1px solid var(--line);
                     border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; }}
  .toolbar button:hover {{ background:#273449; }}
  /* Buttons 1-2 (Open all details / Open all details + JSON). */
  .toolbar .btn-plain {{ background:#1e293b; color:var(--text); border:1px solid var(--line); }}
  .toolbar .btn-plain:hover {{ background:#273449; }}
  /* Buttons 3-4 (Close all details / Show unchanged): a distinct tone so they
     are visually separate from the first two and from the reset button. */
  .toolbar .btn-toggle {{ background:#3730a3; color:#e0e7ff; border:1px solid #4f46e5; }}
  .toolbar .btn-toggle:hover {{ background:#4338ca; }}
  .toolbar .spacer {{ flex:1; }}
  .toolbar .reset {{ background:#7f1d1d; border-color:#b91c1c; color:#fff; font-weight:600; }}
  .toolbar .reset:hover {{ background:#991b1b; }}

  /* ---- type groups ---- */
  .group {{ margin-bottom:22px; }}
  .group-head {{ display:flex; align-items:center; gap:8px; cursor:pointer;
                 padding:10px 14px; border-radius:10px; background:#16213a;
                 border:1px solid var(--line); }}
  .group-head:hover {{ background:#1b2947; }}
  .group-toggle {{ display:inline-block; width:1em; color:var(--muted); transition:transform .12s ease; }}
  .group-type {{ color:#7dd3fc; font-weight:700; font-family:ui-monospace,monospace; font-size:13px; }}
  .group-count {{ color:var(--muted); font-size:12px; }}
  .group-body {{ margin-top:8px; }}
  .group.collapsed .group-body {{ display:none; }}
  .group.collapsed .group-toggle {{ transform:rotate(-90deg); }}

  /* ---- resource cards ---- */
  .card {{ background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:12px 14px; margin-bottom:8px; cursor:pointer; }}
  .card:hover {{ background:#263449; }}
  .card-head {{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }}
  .card-addr {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; color:#7dd3fc; flex:1; }}
  .card-toggle {{ color:var(--muted); transition:transform .12s ease; }}
  .card.diff-open .card-toggle, .card.json-open .card-toggle {{ transform:rotate(180deg); }}
  .card-attrs {{ font-size:12px; margin-top:6px; }}
  /* diff revealed when .diff-open set; JSON revealed when .json-open set */
  .card-diff {{ display:none; }}
  .card.diff-open .card-diff {{ display:block; }}
  .card-json {{ display:none; }}
  .card.json-open .card-json {{ display:block; }}
  /* ---- side-by-side diff ---- */
  .diff {{ width:100%; border-collapse:collapse; background:#0b1220; border:1px solid var(--line);
           border-radius:8px; overflow:hidden; margin-top:8px; font-size:12px; }}
  .diff th {{ background:#16213a; color:var(--muted); text-transform:uppercase; font-size:10px;
              letter-spacing:.05em; padding:6px 10px; text-align:left; }}
  .diff td {{ padding:6px 10px; border-top:1px solid var(--line); vertical-align:top; }}
  .diff .d-key {{ color:#7dd3fc; white-space:nowrap; }}
  .diff .d-before {{ color:#fc8181; width:38%; word-break:break-word; }}
  .diff .d-after {{ color:#48bb78; width:38%; word-break:break-word; }}
  .d-missing {{ color:#4a5568; font-style:italic; }}
  .json {{ background:#0b1220; border:1px solid var(--line); border-radius:8px;
           padding:12px 14px; overflow:auto; max-height:420px; font:12px/1.5 ui-monospace,Menlo,monospace;
           color:#a5f3fc; margin:8px 0 0; white-space:pre; }}
  .pill {{ border-radius:999px; color:#fff; font-size:11px; font-weight:700; padding:3px 9px; white-space:nowrap; }}
  .badge {{ display:inline-block; border-radius:6px; padding:1px 7px; margin:1px 3px 1px 0;
            font-family:ui-monospace,monospace; }}
  .badge.added {{ background:rgba(31,157,85,.15); color:#48bb78; border:1px solid rgba(74,187,120,.4); }}
  .removed {{ background:rgba(229,62,62,.15); color:#fc8181; border:1px solid rgba(252,129,129,.4); }}
  .muted {{ color:var(--muted); }}
  /* accent-colored left border per action */
  .card.create {{ border-left:4px solid #1f9d55; }}
  .card.update {{ border-left:4px solid #d69e2e; }}
  .card.replace {{ border-left:4px solid #805ad5; }}
  .card.delete {{ border-left:4px solid #e53e3e; }}
  .card.noop {{ border-left:4px solid #718096; }}
  /* Unchanged (no-op) resources hide by default; a toolbar toggle shows them.
     Entirely-unchanged type-groups hide as a unit; unchanged cards inside a
     mixed group hide on their own. */
  .group.unchanged {{ display:none; }}
  body.show-unchanged .group.unchanged {{ display:block; }}
  .card.noop {{ display:none; }}
  body.show-unchanged .card.noop {{ display:block; }}
</style>
</head>
<body>
  <header>
    <h1>🌐 Terraform Plan Viewer</h1>
    <div class="meta">resources tracked: <strong>{total}</strong> &middot; click a card to expand raw JSON &middot; from <code>terraform show -json</code></div>
  </header>
  <div class="summary">{summary_html}</div>
  <div class="toolbar">
    <button type="button" class="btn-plain" onclick="openDiffs()">Open all details</button>
    <button type="button" class="btn-plain" onclick="openAll()">Open all details + JSON</button>
    <button type="button" class="btn-toggle" onclick="closeAll()">Close all details</button>
    <button type="button" id="toggleUnchangedBtn" class="btn-toggle" onclick="toggleUnchanged()"
            title="Show groups/resources that have no changes">Show unchanged</button>
    <span class="spacer" aria-hidden="true"></span>
    <button type="button" class="reset" onclick="resetFilter()">Reset</button>
  </div>
  <div class="content">{content_html}</div>
  <script>
    function toggleCard(card) {{
      // Clicking a card opens/closes both the diff and the JSON together.
      card.classList.toggle('diff-open');
      card.classList.toggle('json-open');
    }}
    function openDiffs() {{
      // Show only the side-by-side diffs.
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {{ cards[i].classList.add('diff-open'); }}
    }}
    function openAll() {{
      // Show diffs AND the raw JSON.
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {{
        cards[i].classList.add('diff-open');
        cards[i].classList.add('json-open');
      }}
    }}
    function closeAll() {{
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {{
        cards[i].classList.remove('diff-open');
        cards[i].classList.remove('json-open');
      }}
    }}
    function toggleGroup(head) {{
      var groupId = head.getAttribute('data-group');
      var section = document.getElementById(groupId);
      if (!section) return;
      section.classList.toggle('collapsed');
      var t = head.querySelector('.group-toggle');
      if (t) t.textContent = section.classList.contains('collapsed') ? '▸' : '▾';
    }}
    function filterType(type) {{
      // Highlight the chosen stat card and show only that action type.
      var stats = document.querySelectorAll('.summary .stat');
      for (var i = 0; i < stats.length; i++) {{
        stats[i].classList.toggle('active', stats[i].getAttribute('data-type') === type);
      }}
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {{
        cards[i].style.display = cards[i].getAttribute('data-type') === type ? '' : 'none';
      }}
      // Keep collapsed-state groups visible logic: simplest is to show all groups.
      var groups = document.querySelectorAll('.group');
      for (var j = 0; j < groups.length; j++) groups[j].classList.remove('collapsed');
    }}
    function toggleUnchanged() {{
      document.body.classList.toggle('show-unchanged');
      var btn = document.getElementById('toggleUnchangedBtn');
      if (btn) btn.textContent = document.body.classList.contains('show-unchanged')
          ? 'Hide unchanged' : 'Show unchanged';
    }}
    function resetFilter() {{
      var stats = document.querySelectorAll('.summary .stat');
      for (var i = 0; i < stats.length; i++) stats[i].classList.remove('active');
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) cards[i].style.display = '';
      document.body.classList.remove('show-unchanged');
      var btn = document.getElementById('toggleUnchangedBtn');
      if (btn) btn.textContent = 'Show unchanged';
    }}
  </script>
</body>
</html>"""

    with open(out_path, "w") as f:
        f.write(html)
    return out_path


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="path to terraform plan JSON (terraform show -json)")
    parser.add_argument("-o", "--output", default="plan-view.html", help="output HTML path")
    args = parser.parse_args(argv)

    with open(args.input) as f:
        plan = json.load(f)

    out = render(plan, args.output)
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))