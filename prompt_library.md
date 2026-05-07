# Prompt Library

Reusable prompts for specific data-enrichment fields and tasks.

## How to add new prompts

Use this structure for each new entry:

- `id`: short snake_case identifier
- `purpose`: what the prompt is for
- `input`: expected input fields
- `prompt`: full prompt text

## Standard Prepared AI Columns

Default standard set for new cases (Prompt-Column Library baseline).

1. `official_domain`
- prompt id: `company_official_domain_lookup`
- output: `json`
- output key: `domain`
- condition: `company_name is_truthy`

2. `domain_confidence`
- prompt id: `company_official_domain_lookup`
- output: `json`
- output key: `confidence`
- condition: `company_name is_truthy`

3. `domain_source_url`
- prompt id: `company_official_domain_lookup`
- output: `json`
- output key: `sourceUrl`
- condition: `company_name is_truthy`

4. `website_tld`
- prompt id: `website_tld_extraction`
- output: `text`
- output key: *(empty)*
- condition: `official_domain is_truthy`

5. `industry_keywords`
- prompt id: `industry_keywords_extraction`
- output: `json`
- output key: `keywords`
- condition: `official_domain is_truthy`

6. `decision_makers_json`
- prompt id: `key_decision_maker_contact_profile`
- output: `json`
- output key: `contacts`
- condition: `official_domain is_truthy`

7. `social_profiles_json`
- prompt id: `social_profile_urls_lookup`
- output: `json`
- output key: *(empty, use full object)*
- condition: `decision_makers_json is_truthy`

8. `background_check_json`
- prompt id: `background_check_personalization_profile`
- output: `json`
- output key: *(empty, use full object)*
- condition: `official_domain is_truthy`

Notes:
- These are the standard defaults and should be available as reusable presets.
- Use this order for dependency-safe execution.
- If a prompt returns arrays/objects, keep JSON mode and map only when needed.

---

## id: company_official_domain_lookup

- purpose: Find the official primary domain of a company via open web search
- input:
  - `companyName` (string)

### prompt

```text
#CONTEXT#

You are an AI-powered web researcher tasked with finding the official website domain of a company using open web search. You will use the company's name to identify the correct official domain and return it in a structured format. Avoid paywalled or authenticated sources.



#OBJECTIVE#

Find the official primary domain for the given company name using web search and return it as a clean domain (e.g., example.com). If uncertain or no authoritative result is found, indicate that no domain could be confidently determined.



#INSTRUCTIONS#

1. Query formulation:

   - Search the web for the company name combined with keywords like "official website", "site", or "homepage".

   - Prefer results from authoritative sources: the company's own site, Wikipedia/Crunchbase pages linking to the official site, reputable directories (e.g., Bloomberg, government registries) that list the official website.



2. Identification of the official domain:

   - Prioritize the company’s own homepage result. Verify that the site branding and company name match the searched company name.

   - If multiple domains appear, select the one most clearly representing the company’s global/primary website (avoid regional microsites unless the company only operates regionally).

   - Exclude social profiles (LinkedIn, Twitter/X, Facebook), link shorteners, app store links, and third-party SaaS portals.



3. Disambiguation and validation:

   - If the company name is generic or there are multiple companies with similar names, use contextual clues on the site (logo, about page, footer legal entity) to confirm the match.

   - Cross-check with at least one secondary reputable source (e.g., Wikipedia, Crunchbase, Bloomberg) that lists the same official website when ambiguity exists.



4. Domain normalization:

   - Return only the registrable domain and public suffix (e.g., example.com, example.co.uk). Remove protocols (http/https), subdomains (www., app.), paths, UTM parameters, and fragments.

   - If the brand operates only on a country TLD or multi-part TLD (e.g., .com.au, .co.uk), keep the correct full suffix.



5. Edge cases:

   - If only a subdomain is visible (e.g., www.example.com), normalize to example.com unless the subdomain is the actual primary site for the brand (rare; confirm via homepage redirection and branding).

   - If no definitive official site can be found, output reason: "notFound" and leave domain empty.



6. Output rules:

   - Output JSON with camelCase keys only: { "domain": string, "confidence": "high"|"medium"|"low"|"notFound", "sourceUrl": string }.

   - Use "high" when the domain is confirmed on the company’s homepage and corroborated or clearly unambiguous; "medium" for strong but not fully corroborated matches; "low" when weak signals suggest a match; "notFound" if no reliable domain.

   - For sourceUrl, provide the most authoritative page used (prefer the company homepage or an authoritative directory entry).



#EXAMPLES#

Example 1 (clear match):

Input company: "Acme Robotics"

Output:

{

  "domain": "acmerobotics.com",

  "confidence": "high",

  "sourceUrl": "https://acmerobotics.com/"

}



Example 2 (ambiguous, corroborated via Wikipedia):

Input company: "Phoenix Systems"

Output:

{

  "domain": "phoenixsystems.co.uk",

  "confidence": "medium",

  "sourceUrl": "https://en.wikipedia.org/wiki/Phoenix_Systems"

}



Example 3 (not found):

Input company: "Blue Leaf Holdings" (no clear web presence)

Output:

{

  "domain": "",

  "confidence": "notFound",

  "sourceUrl": ""

}



#INPUTS#

Company Name:
```

---

## id: website_tld_extraction

- purpose: Extract the registrable domain (main domain + TLD) from a website URL
- input:
  - `website` (string)

### prompt

```text
#CONTEXT#

You are tasked with extracting the top-level domain (TLD) from a website URL, ensuring that both the protocol (http://, https://) and 'www.' are removed from the result.



#OBJECTIVE#

Extract the top-level domain from the  column, omitting any protocol and 'www.' prefix.



#INSTRUCTIONS#

1. For each entry in the  column, remove any leading 'http://', 'https://', or 'www.' from the URL.

2. Identify and extract the top-level domain (TLD) portion of the URL (e.g., 'example.com' from 'https://www.example.com').

3. If the URL contains subdomains (e.g., 'blog.example.co.uk'), extract only the main domain and its TLD (e.g., 'example.co.uk').

4. Return only the extracted TLD for each website.

5. If the  column is empty or invalid, return 'N/A'.



#EXAMPLES#

Input: https://www.example.com

Output: example.com



Input: http://blog.example.co.uk

Output: example.co.uk



Input: www.test.org

Output: test.org



Input: (empty)

Output: N/A
```

---

## id: industry_keywords_extraction

- purpose: Extract industry and branch-related keywords from a company's homepage text
- input:
  - `website` (string)

### prompt

```text
Identify Industrym Keywords

#CONTEXT#

You need to extract keywords related to industry and branch from the content of a company's home page for later industry classification.



#OBJECTIVE#

Visit the company's home page () and extract relevant keywords that indicate the company's industry and branch.



#INSTRUCTIONS#

1. Go to the URL provided in the  column.

2. Scrape the visible text content from the home page.

3. Identify and extract keywords or phrases that are relevant to the company's industry and branch (e.g., "healthcare", "software development", "retail", "manufacturing").

4. Return a concise list of these keywords. If no relevant keywords are found, return "No industry or branch keywords found".

5. Do not infer or guess missing data—only extract what is present on the home page.



#EXAMPLES#

Example input:  = https://www.examplecompany.com

Example output: ["fintech", "payment processing", "SaaS"]

{
  "type": "object",
  "properties": {
    "keywords": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "List of extracted keywords or phrases relevant to the company's industry and branch, or ['No industry or branch keywords found'] if none are found"
    }
  },
  "required": [
    "keywords"
  ]
}
```

---

## id: background_check_personalization_profile

- purpose: Build an ultra-personalized outreach profile from public mentions and social signals
- input:
  - `website` (string)
  - `contact` (object)
  - `socialProfiles` (object, optional)

### prompt

```text
Now. Background Cehclk

#CONTEXT#

You're a data-driven B2B researcher focused on hyper-personalized outreach. Given a company website () and the data of a decision maker (, , , , , , ) and all other available data like the given social profiles, your task is to identify mentions, interests, social information, and any other infos for ultra-personalized contact approach.



#OBJECTIVE#

Identify social information for given contacts and build a comprehensive, ultra-personalized contact profile for outreach.



#INSTRUCTIONS#

1. Include notable local news, construction projects, awards, or public mentions related to the company () or key person ().

2. Use the person’s social media profiles (, , , , , ) for more information.

3. Scan public mentions: Google News (press, interviews, project launches), YouTube (speaking engagements, company tours, interviews), local municipality Facebook pages (especially for construction/public works).

4. Extract personalization angles: recent events (e.g., topping out ceremony, company anniversary), interests, community involvement, awards, local activity, pain points, or growth areas from public data.

5. For every found information provide the full url to the source!

6. Format the output profile as follows:



## 👤 Contact Details

- Name:

- Hobbies/Interests:

- Public Mentions (News, Events, Projects):

- Referenced News/Events:

- Mutual Interests:

- Needs & Opportunities:

- Links to verify: url1, url 2, url 3



#EXAMPLES#

Input: Company Domain = examplecompany.com, Full Name = Jane Doe, Job Title = CEO

Output:

## 👤 Contact Details

- Name: Jane Doe

- Hobbies/Interests: Cycling, Sustainability

- Public Mentions (News, Events, Projects): "Awarded Best Builder 2023", "New HQ Opening" as Example

- Referenced News/Events: New HQ Opening

- Mutual Interests: Sustainability

- Needs & Opportunities: Expansion into renewable construction

- Links to verify: url1, url2, url3


{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Full name of the contact"
    },
    "hobbies_interests": {
      "type": "string",
      "description": "Hobbies or interests of the contact"
    },
    "public_mentions": {
      "type": "string",
      "description": "Notable public mentions, news, events, or projects related to the contact or company"
    },
    "referenced_news_events": {
      "type": "string",
      "description": "Specific news or events referenced"
    },
    "mutual_interests": {
      "type": "string",
      "description": "Mutual interests between the contact and the outreach party"
    },
    "needs_opportunities": {
      "type": "string",
      "description": "Identified needs or opportunities for outreach"
    },
    "links_to_verify": {
      "type": "array",
      "description": "List of URLs to verify the information",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "name",
    "hobbies_interests",
    "public_mentions",
    "referenced_news_events",
    "mutual_interests",
    "needs_opportunities",
    "links_to_verify"
  ],
  "additionalProperties": false
}
```

---

## id: social_profile_urls_lookup

- purpose: Find personal social profile URLs for a contact and their connections
- input:
  - `contact` (object)
  - `connections` (array, optional)

### prompt

```text
next imprtant:;

find Sociqal Profile urls :

#CONTEXT#

You are tasked with finding all existing social media profiles for a given contact and their connections. The target platforms are LinkedIn, Xing, X (formerly Twitter), Instagram, and Facebook. Use the provided contact information to maximize accuracy.



#OBJECTIVE#

Identify and extract all available social media profile URLs for  and their connections, specifically for LinkedIn, Xing, X, Instagram, and Facebook.



#INSTRUCTIONS#

1. Use the following columns to search for the contact  if there is data: , , , , , , ,

2. For each platform (LinkedIn, Xing, X, Instagram, Facebook), search for personal profiles matching the contact's details.

3. For connections, use any available data in any columns to identify and search for their social profiles as well.

4. Validate that each found profile matches the contact or connection by cross-referencing available details (e.g., job title, company, location).

5. Return the URLs for each platform. If no profile is found for a platform, return "No profile found" for that platform.

6. Do not include company or group pages—only personal profiles.



#EXAMPLES#

Example input:

  Full Name: Jane Doe

  CompanyName: ExampleCorp

  Job Title: Marketing Manager



Expected output:

  "LinkedIn": "https://www.linkedin.com/in/janedoe",

  "Xing": "https://www.xing.com/profile/Jane_Doe",

  "X": "No profile found",

  "Instagram": "https://instagram.com/jane.doe",

  "Facebook": "No profile found"



If searching for connections, include their names and corresponding profile URLs in a nested array under a "Connections" key.

{
  "type": "object",
  "properties": {
    "LinkedIn": {
      "type": "string",
      "description": "URL of the LinkedIn profile or 'No profile found'"
    },
    "Xing": {
      "type": "string",
      "description": "URL of the Xing profile or 'No profile found'"
    },
    "X": {
      "type": "string",
      "description": "URL of the X (formerly Twitter) profile or 'No profile found'"
    },
    "Instagram": {
      "type": "string",
      "description": "URL of the Instagram profile or 'No profile found'"
    },
    "Facebook": {
      "type": "string",
      "description": "URL of the Facebook profile or 'No profile found'"
    },
    "Connections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "Full_Name": {
            "type": "string",
            "description": "Full name of the connection"
          },
          "LinkedIn": {
            "type": "string",
            "description": "URL of the LinkedIn profile or 'No profile found'"
          },
          "Xing": {
            "type": "string",
            "description": "URL of the Xing profile or 'No profile found'"
          },
          "X": {
            "type": "string",
            "description": "URL of the X (formerly Twitter) profile or 'No profile found'"
          },
          "Instagram": {
            "type": "string",
            "description": "URL of the Instagram profile or 'No profile found'"
          },
          "Facebook": {
            "type": "string",
            "description": "URL of the Facebook profile or 'No profile found'"
          }
        },
        "required": [
          "Full_Name",
          "LinkedIn",
          "Xing",
          "X",
          "Instagram",
          "Facebook"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "LinkedIn",
    "Xing",
    "X",
    "Instagram",
    "Facebook",
    "Connections"
  ],
  "additionalProperties": false
}
```

---

## id: key_decision_maker_contact_profile

- purpose: Find key decision-makers and build contact profiles with discovered or estimated emails
- input:
  - `website` (string)
  - `domain` (string)
  - `companyName` (string)

### prompt

```text
very impoirtant: Fidn Key Decision Makert

#CONTEXT#

You're a data-driven B2B researcher focused on finding any possible marketing relevant contacts, given a company website (), your task is to identify all key decision-maker (owner, managing director, head of operations, head of marketing, head of sales etc.) and their location and build a simple contact profile for each contact.



#OBJECTIVE#

Identify all! key decision-maker at the company and build a simple contact profile as basis for further enrichment.



#INSTRUCTIONS#

1. Scrape the company’s Imprint, Team, About Us, or Contact pages (e.g., /impressum) to identify the key persons (owner, managing director, head of operations, head of marketing, head of sales etc.). Consider that every visited pages have the same .

2. Extract for each found person: full name, title, direct email, and phone number. Include every email you find, at least try to find a catch-all like info@.

3. If missing, search Northdata, OpenRegisters, or CompanyHouse for legal or executive records. Go for example to to northdata.de and search for the company using the exact .

Locate the official company profile page.

On the company profile page, look for the section listing executive contacts, specifically CEOs or GFs (Geschäftsführer). Extract the full names of all individuals listed as CEO or GF. Later separate the names if its possible into firstname & surname.

4. Identify the location of the contact and Verify the correct found names to prevent misspelling.

5. To get more results especially working emails d specific Google-Suchanfragen (Dorks). Ziel ist es, öffentlich sichtbare E-Mail-Adressen zu einer Domain zu finden.

Für die Domain erstelle bitte folgende Google-Suchanfragen (Dorks), um gezielt Ergebnisse mit E-Mail-Adressen zu finden:

1. site: intext:@

2. site:filetype:pdf "@"

3. site: filetype:doc "@"

4. "@" -site:.

Finde heraus nach welchem Muster die E-Mails bei dem Unternehmen aufgebaut sind und mache Vorschläge für E-Mails der gefundenen Personen basierend auf Namen wenn du keine konkrete E-Mail findest. Nutze dafür zusätzlich das Merkmal Email Source und setze "estimated" wenn du die EMail geschätzt hast oder "Scraped" wenn du konkret etwas gefunden hast .

6. Format the output profile as follows:



## 👤 Contact Details

- Name:

- Firstname:

- Surname:

- Jobtitle:

- Location:

- Phone:

- Mobile:

- Email:

- Email Source:

- Email-Pattern:



## Dork Results

- Emails (Email, Source)



#EXAMPLES#

Input: Domain = examplecompany.com

Output:

## 👤 Contact Details

- Name: Jane Doe

- Firstname: Jane

- Surname: Doe

- Jobtitle: Managing Director

- Location: Rostock

- Phone: +49 30 1234567

- Mobile: +49 171 1234567

- Email: jane.doe@examplecompany.com

- Email Source: Scraped

- Email-Pattern: vorname.nachname@domain.de



## Dork Results

{
  "type": "object",
  "properties": {
    "contacts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "firstname": {
            "type": "string"
          },
          "surname": {
            "type": "string"
          },
          "jobtitle": {
            "type": "string"
          },
          "location": {
            "type": "string"
          },
          "phone": {
            "type": "string"
          },
          "mobile": {
            "type": "string"
          },
          "email": {
            "type": "string"
          },
          "email_source": {
            "type": "string",
            "enum": [
              "Scraped",
              "Estimated"
            ]
          },
          "email_pattern": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "firstname",
          "surname",
          "jobtitle",
          "location",
          "phone",
          "mobile",
          "email",
          "email_source",
          "email_pattern"
        ],
        "additionalProperties": false
      }
    },
    "dork_results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string"
          },
          "source": {
            "type": "string"
          }
        },
        "required": [
          "email",
          "source"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "contacts",
    "dork_results"
  ],
  "additionalProperties": false
}
```
