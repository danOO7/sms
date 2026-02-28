# Convo Selling Agent Workflow

Use this workflow inside each private Convo/XMTP interaction after join.

## Goal
Collect product details, evaluate condition, estimate market price from comparable listings, choose the best marketplace, collect seller constraints, draft listing copy, and request explicit approval.

## Conversation State Machine

`joined -> intake -> photos -> condition -> market-research -> pricing-strategy -> marketplace-selection -> seller-constraints -> draft-listing -> approval -> complete`

## Step-by-Step Prompts

## 1) Intake (what is being sold)
Ask:
- "What are you selling? Include brand, model, size/specs, color, and age if known."
- "Where are you located (city/zip) for local-market pricing?"

Save:
- category, brand, model, variant, location

## 2) Photos
Ask for 6-10 photos:
- front, back, sides, labels/serials, defects, accessories

If fewer than 3 photos are provided, ask for more before pricing.

## 3) Condition Assessment
Ask targeted condition questions:
- operational status
- cosmetic wear
- repairs/replacements
- missing parts
- smoke/pet exposure (if relevant)

Classify into one:
- `new`, `like_new`, `good`, `fair`, `for_parts`

## 4) Market Research (comps)
Search comparable sold/active listings on:
- craigslist.com
- ebay.com
- facebook marketplace

Guidelines:
- Prioritize exact model matches, then nearest variants.
- Prefer results from same metro area for local marketplaces.
- Gather at least 3 and ideally 5-10 comps per marketplace.
- Normalize prices by condition and included accessories.

Output structure per marketplace:
- median price
- low/high range
- comp count
- notable trend note

## 5) Pricing Strategy
Compute suggested values:
- `quick_sale_price` (10-15% below median adjusted)
- `target_price` (near adjusted median)
- `stretch_price` (10-20% above target if demand supports)

Explain adjustments briefly (condition, demand, completeness, seasonality).

## 6) Choose Best Marketplace
Choose primary marketplace using this rubric:
- local bulky item: Craigslist/Facebook preferred
- shippable collectible/electronics: eBay preferred
- strongest adjusted median and turnover signal wins

Return:
- `primary_marketplace`
- `secondary_marketplace`
- reason

## 7) Seller Constraints
Ask seller to provide:
- minimum acceptable price
- maximum desired list price
- sell-by date

Validate:
- min <= target <= max when possible
- if conflicts, explain and ask for revised bounds

## 8) Draft Listing
Generate listing package:
- title (<= 80 chars)
- price recommendation
- condition label
- description (short + full)
- bullet features
- defects disclosure
- pickup/shipping terms
- safety/payment guidance

## 9) Approval Gate
Ask explicitly:
- "Approve this listing draft? Reply APPROVE to finalize or tell me what to change."

If not approved, iterate only changed sections.

## Pricing Data Caveats
- If marketplace data is sparse, disclose low confidence.
- If Facebook Marketplace or Craigslist result coverage is limited, still provide recommendation with confidence note.
- Never invent sold prices; mark uncertain values as estimates.

## Suggested Final JSON Object

```json
{
  "item": {"name":"", "brand":"", "model":"", "location":""},
  "condition": "good",
  "marketResearch": {
    "craigslist": {"median": 0, "low": 0, "high": 0, "count": 0},
    "ebay": {"median": 0, "low": 0, "high": 0, "count": 0},
    "facebook": {"median": 0, "low": 0, "high": 0, "count": 0}
  },
  "strategy": {
    "quickSale": 0,
    "target": 0,
    "stretch": 0,
    "primaryMarketplace": "",
    "secondaryMarketplace": "",
    "confidence": "low|medium|high"
  },
  "sellerConstraints": {
    "minPrice": 0,
    "maxPrice": 0,
    "sellByDate": "YYYY-MM-DD"
  },
  "listingDraft": {
    "title": "",
    "price": 0,
    "description": ""
  },
  "approval": {
    "status": "pending|approved|revise"
  }
}
```
