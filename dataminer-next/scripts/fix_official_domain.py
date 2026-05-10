import sqlite3, json

PROMPT = """#CONTEXT#
You are an AI-powered web researcher tasked with finding the official website domain of a company using open web search. You will use the company's name to identify the correct official domain and return it in a structured format. Avoid paywalled or authenticated sources.

#OBJECTIVE#
Find the official primary domain for the given company name using web search and return it as a clean domain (e.g., example.com). If uncertain or no authoritative result is found, indicate that no domain could be confidently determined.

#INSTRUCTIONS#
1. Query formulation:
   - Search the web for the company name combined with keywords like "official website", "site", or "homepage".
   - Prefer results from authoritative sources: the company's own site, Wikipedia/Crunchbase pages linking to the official site, reputable directories (e.g., Bloomberg, government registries) that list the official website.

2. Identification of the official domain:
   - Prioritize the company's own homepage result. Verify that the site branding and company name match the searched company name.
   - If multiple domains appear, select the one most clearly representing the company's global/primary website.
   - Exclude social profiles (LinkedIn, Twitter/X, Facebook), link shorteners, app store links, and third-party SaaS portals.

3. Disambiguation and validation:
   - If the company name is generic or there are multiple companies with similar names, use contextual clues on the site to confirm the match.
   - Cross-check with at least one secondary reputable source when ambiguity exists.

4. Domain normalization:
   - Return only the registrable domain and public suffix (e.g., example.com). Remove protocols, subdomains (www.), paths, and fragments.

5. Edge cases:
   - If no definitive official site can be found, output confidence: "notFound" and leave domain empty.

6. Disambiguation using additional context:
   - If a city, postal code, or street address is provided, use it to disambiguate between companies with similar names.
   - If an input URL hint is provided, treat it as a strong signal.
   - If a legal form is visible in the company name (GmbH, AG, KG, e.K., UG etc.), use it to narrow the search.

7. Output rules:
   - Output JSON with camelCase keys only: { "domain": string, "confidence": "high"|"medium"|"low"|"notFound", "sourceUrl": string }
   - Use "high" when confirmed; "medium" for strong matches; "low" for weak signals; "notFound" if no reliable domain.

#INPUTS#
Company Name: {Unternehmensname}
City / Region (if available): {Stadt}
Postal Code (if available): {plz}
Street (if available): {street}
Input URL hint (if available): {input_url}"""

db = sqlite3.connect('/Users/timratig/dataminer/dataminer/dataminer-next/data/dataminer.db')

for case_id, ai_columns_json in db.execute("SELECT id, ai_columns FROM cases"):
    cols = json.loads(ai_columns_json)
    changed = False
    for col in cols:
        if col.get('outputKey') == 'official_domain':
            col['multiKeys'] = [{'jsonKey': 'domain', 'outputKey': 'official_domain'}]
            col['validateDomain'] = True
            col['prompt'] = PROMPT
            col['condition'] = 'require_input'
            # keep existing conditionField if set, else default
            if not col.get('conditionField'):
                col['conditionField'] = 'Unternehmensname'
            changed = True
    if changed:
        db.execute("UPDATE cases SET ai_columns = ? WHERE id = ?", (json.dumps(cols), case_id))
        print(f"Updated case {case_id}")

db.commit()
db.close()
print("Done.")
