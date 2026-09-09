"""Debug: dump what the Google SERP DOM actually contains with the new wait approach."""
from scrapling.fetchers import StealthyFetcher

url = "https://www.google.com/search?q=Marketingagenturen+Rostock&hl=de&gl=de&num=5"
try:
    page = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        google_search=False,
        locale="de-DE",
        wait_selector="#search",
        wait_selector_state="attached",
        timeout=60_000,
    )
except Exception as e:
    print("wait_selector fetch failed:", e)
    page = StealthyFetcher.fetch(url, headless=True, network_idle=True, google_search=False, locale="de-DE", timeout=60_000)

print("URL:", page.url)
print("TITLE:", page.css("title")[0].text if page.css("title") else "?")
print("#search present:", len(page.css("#search")))
print(".g cards:", len(page.css("#search .g")))
print("div.g anywhere:", len(page.css("div.g")))
print("h3 count:", len(page.css("h3")))
print("a[href^=http] count:", len(page.css("a[href^='http']")))
# dump first few h3 texts
for h in page.css("h3")[:8]:
    print("  H3:", (h.text or "").strip()[:70])

# inspect link structure around each result h3
print("\n--- link structure around h3s ---")
for h in page.css("h3")[2:7]:
    node = h
    chain = []
    for _ in range(4):
        node = node.parent
        if node is None:
            break
        chain.append(node.tag)
    a_self = h.css("a[href]")
    a_parent = h.parent.css("a[href]") if h.parent else []
    a_gp = h.parent.parent.css("a[href]") if h.parent and h.parent.parent else []
    print("H3:", (h.text or "").strip()[:50])
    print("   chain:", chain)
    print("   a in h3:", [a.attrib.get("href", "")[:70] for a in a_self])
    print("   a in parent:", [a.attrib.get("href", "")[:70] for a in a_parent])
    print("   a in grandparent:", [a.attrib.get("href", "")[:70] for a in a_gp])
    print("   all a[href^=http] in gp:", [a.attrib.get("href", "")[:70] for a in (a_gp or []) if a.attrib.get("href", "").startswith("http")])
# dump any element ids/classes near results
ids = set()
for el in page.css("[id]")[:40]:
    ids.add(el.attrib.get("id"))
print("IDS sample:", sorted(ids)[:20])
