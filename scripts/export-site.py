#!/usr/bin/env python3
"""Writes a published GitCrook site out as a folder of Markdown files that Git Sync reads back to the same addresses.

    python3 scripts/export-site.py https://docs.example.com/my-site ./site-export [--no-nav]

Give it the site's address (with the site's slug when it lives under the platform's root domain, without when it has its
own domain). It reads the site's /llms.txt for the list of pages and each page's .md for its text, so it sees exactly what
a visitor can see: drafts and hidden pages are not included. Nothing on the server is changed.

What carries over: page text, titles, descriptions, addresses, the sidebar's order and its group titles (written to
gitcrook.yaml, which lists every page; pass --no-nav to leave it out and let the folders and `order:` decide instead). What
does not: icons, and anything Markdown cannot say. Images keep pointing at the files already uploaded to the site.
"""
import json
import unicodedata
import os
import re
import sys
import urllib.parse
import urllib.request

LINK = re.compile(r"^(\s*)- \[(.+)\]\((\S+?)\)(?::\s*(.*))?$")
GROUP = re.compile(r"^(\s*)- (.+)$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "gitcrook-export"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_index(text):
    """The page tree in /llms.txt: [{title, url, children}] with groups as entries that have no url."""
    roots, stack, headings = [], [], 0
    for line in text.split("\n"):
        if line.startswith("## "):
            headings += 1
            continue
        m = LINK.match(line)
        g = None if m else GROUP.match(line)
        if not (m or g):
            continue
        indent = len((m or g).group(1))
        node = {
            "title": re.sub(r"\\([\[\]\\])", r"\1", (m.group(2) if m else g.group(2)).strip()),
            "url": m.group(3) if m else None,
            "children": [],
        }
        depth = indent // 2
        del stack[depth:]
        (stack[-1]["children"] if stack else roots).append(node)
        stack.append(node)
    return roots, headings


def slugify(text):
    """The same rule the importer uses to turn a group's title into its address."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", folded.lower().strip()).strip("-")[:96].rstrip("-") or "page"


def has_pages_below(node):
    return any(c["url"] or has_pages_below(c) for c in node["children"])


def main():
    args = [a for a in sys.argv[1:] if a != "--no-nav"]
    want_nav = "--no-nav" not in sys.argv[1:]
    if len(args) != 2:
        sys.exit(__doc__)
    base, out = args[0].rstrip("/"), args[1]
    if os.path.exists(out) and os.listdir(out):
        sys.exit(f"{out} exists and is not empty; choose a new folder so nothing is overwritten.")

    roots, headings = parse_index(fetch(base + "/llms.txt"))
    if headings > 1:
        sys.exit("This site has more than one section or space. Git Sync fills one version of a site from one folder, so export each one separately (give this script that section's address).")
    base_path = urllib.parse.urlparse(base).path.rstrip("/")

    written, problems = 0, []

    def segments_of(node):
        path = urllib.parse.unquote(urllib.parse.urlparse(node["url"]).path)
        if not path.startswith(base_path + "/") or not path.endswith(".md"):
            problems.append(f"skipped {node['title']!r}: its address {node['url']} is not under {base}")
            return None
        segments = path[len(base_path) + 1 : -3].split("/")
        if not all(SLUG.match(s) for s in segments):
            problems.append(f"skipped {node['title']!r}: {'/'.join(segments)!r} is not a plain address")
            return None
        return segments

    def file_for(node, segments):
        return "/".join(segments + ["index.md"]) if has_pages_below(node) else "/".join(segments) + ".md"

    def write_pages(nodes):
        nonlocal written
        for order, node in enumerate(nodes):
            if node["url"]:
                segments = segments_of(node)
                if segments:
                    node["file"] = file_for(node, segments)
                    text = fetch(base + "/" + "/".join(urllib.parse.quote(s) for s in segments) + ".md")
                    front = {"order": order}
                    # The page's description arrives as a quote straight after its title.
                    m = re.match(r"^(# .+)\n\n> (.+)\n\n", text)
                    if m:
                        front["description"] = m.group(2)
                        text = m.group(1) + "\n\n" + text[m.end():]
                    header = "---\n" + "".join(f"{k}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in front.items()) + "---\n\n"
                    target = os.path.join(out, *node["file"].split("/"))
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target, "w", encoding="utf-8") as f:
                        f.write(header + text)
                    written += 1
            write_pages(node["children"])

    def nav_entries(nodes, indent):
        pad = "  " * indent
        lines = []
        for node in nodes:
            if node["url"]:
                if "file" not in node:
                    continue
                kids = nav_entries(node["children"], indent + 2)
                if kids:
                    lines += [f"{pad}- page: {json.dumps(node['file'])}", f"{pad}  pages:"] + kids
                else:
                    lines.append(f"{pad}- {json.dumps(node['file'])}")
            else:
                kids = nav_entries(node["children"], indent + 2)
                if not kids:
                    continue
                child_urls = [segments_of(c) for c in node["children"] if c["url"]]
                actual = child_urls[0][0] if child_urls and child_urls[0] and len(child_urls[0]) > 1 else None
                if actual and actual != slugify(node["title"]):
                    problems.append(f"group {node['title']!r} will be at /{slugify(node['title'])} instead of /{actual}; rename the group or add redirect_from to its pages")
                lines += [f"{pad}- group: {json.dumps(node['title'], ensure_ascii=False)}", f"{pad}  pages:"] + kids
        return lines

    write_pages(roots)
    if want_nav and written:
        with open(os.path.join(out, "gitcrook.yaml"), "w", encoding="utf-8") as f:
            f.write("# Written by export-site.py: the sidebar as it was. Delete this file to let the folders and `order:` decide.\n")
            f.write("# With it, a file that is not listed here is not published.\n")
            f.write("version: 1\nnav:\n" + "\n".join(nav_entries(roots, 1)) + "\n")

    print(f"Wrote {written} page{'s' if written != 1 else ''} to {out}")
    for p in problems:
        print("  note:", p)
    if written == 0:
        sys.exit("No pages were found. Is the address right, and is the site public?")


if __name__ == "__main__":
    main()
