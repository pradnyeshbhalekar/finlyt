"""Parse simple spending notes without AI: "chai 40 cash", "auto 120, petrol 500 kotak".

`parse()` returns a GProposal (the shape Gemini returns) when every item in the text is simple,
and None otherwise so the caller asks Gemini. An item is simple when it names a known kind of
spend and has exactly one amount, optionally with how it was paid. Anything involving people,
splits, paybacks, times other than now, extra amounts ("plus 30 cash") or unfamiliar words goes
to Gemini, which reads those far better than rules can.
"""

from __future__ import annotations

import re
from datetime import datetime

from ..gemini import GExpense, GPayment, GProposal
from ..models import Account
from ..money import to_paise
from ..timeutil import IST

MAX_LENGTH = 300
MAX_ITEMS = 10
MAX_PAISE = 10_00_000_00  # ₹10 lakh: anything bigger is worth a second look by Gemini

# Items are separated by commas, semicolons, new lines, "and"/"aur"/"then"/"also". A comma
# between digits is a thousands separator ("15,000"), not a new item.
SEPARATORS = re.compile(
    r"\s*(?:(?<!\d),|,(?!\d)|[;\n]|\band\b|\baur\b|\bthen\b|\balso\b)\s*", re.IGNORECASE
)

# Words that mean the note needs understanding, not pattern matching.
COMPLEX = re.compile(
    r"\+|%|\b(?:owes?|owed|split|share|half|with|saath|sath|dena|dene|dega|degi|deni|lent|lend|"
    r"borrow\w*|back|wapas|vapas|return\w*|refund\w*|plus|extra|more|baaki|baki|bacha|remaining|"
    r"yesterday|kal|parso|morning|subah|night|raat|evening|sham|shaam|afternoon|dopahar|last|"
    r"treat|transfer\w*|atm|withdr\w*|salary|received|got|mila|mili|income|each|per|every)\b",
    re.IGNORECASE,
)

AMOUNT = re.compile(
    r"^(?:rs\.?|inr|₹)?(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d{1,2})?)(k)?(?:/-|rs\.?|rupees?|₹)?$",
    re.IGNORECASE,
)
CURRENCY_WORDS = {"rs", "rs.", "inr", "₹", "rupee", "rupees", "rupaye", "rupay", "/-"}
FILLER = {
    "paid", "pay", "spent", "spend", "diye", "diya", "di", "kharch", "kharcha", "for", "on", "at",
    "ka", "ke", "ki", "ko", "me", "mein", "the", "a", "an", "today", "aaj", "via", "by", "from",
    "in", "se", "using", "through", "of", "worth", "bought", "liya", "li", "le", "purchase",
    "purchased", "got", "i", "my", "was", "is", "bank", "account", "a/c",
}  # fmt: skip
CASH_WORDS = {"cash", "nakad", "nagad", "nakit"}
PRIMARY_WORDS = {"upi", "gpay", "googlepay", "phonepe", "paytm", "card", "online", "bhim"}

# Spend words → category name. Only items with one of these are parsed without Gemini.
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "Food": (
        "chai", "tea", "coffee", "breakfast", "nashta", "lunch", "dinner", "snack", "snacks",
        "samosa", "vada", "vadapav", "pav", "poha", "dosa", "idli", "biryani", "pizza", "burger",
        "sandwich", "momos", "maggi", "juice", "lassi", "icecream", "sweets", "mithai", "zomato",
        "swiggy", "restaurant", "cafe", "canteen", "mess", "food", "khana", "thali", "panipuri",
        "golgappe", "chaat", "bhel", "frankie", "roll", "cake", "water", "colddrink", "pepsi",
        "coke", "tiffin", "dabba", "kfc", "mcdonalds", "dominos", "starbucks", "meal", "paratha",
    ),
    "Transport": (
        "auto", "rickshaw", "uber", "ola", "rapido", "cab", "taxi", "metro", "bus", "train",
        "petrol", "diesel", "fuel", "cng", "parking", "toll", "fastag",
    ),
    "Groceries": (
        "grocery", "groceries", "kirana", "dmart", "blinkit", "zepto", "instamart", "bigbasket",
        "vegetables", "veggies", "sabzi", "sabji", "fruits", "milk", "doodh", "eggs", "bread",
        "ration", "atta", "rice", "dal",
    ),
    "Shopping": (
        "amazon", "flipkart", "myntra", "ajio", "meesho", "clothes", "shirt", "tshirt", "jeans",
        "shoes", "shopping", "mall", "decathlon",
    ),
    "Bills": (
        "bill", "bills", "electricity", "wifi", "internet", "broadband", "recharge", "gas",
        "cylinder", "dth", "maintenance", "jio", "airtel", "insurance",
    ),
    "Rent": ("rent", "kiraya", "pg", "hostel"),
    "Fitness": ("gym", "protein", "yoga", "swimming", "cultfit", "badminton", "football", "turf"),
    "Entertainment": (
        "movie", "movies", "cinema", "pvr", "inox", "netflix", "hotstar", "spotify", "concert",
        "bookmyshow", "bowling", "game", "games",
    ),
    "Health": (
        "medicine", "medicines", "medical", "pharmacy", "chemist", "doctor", "hospital",
        "clinic", "tablets", "lab", "dentist", "apollo",
    ),
    "Personal care": (
        "haircut", "salon", "parlour", "barber", "shaving", "cosmetics", "nykaa", "soap",
        "shampoo", "spa",
    ),
    "Education": ("book", "books", "course", "fees", "tuition", "udemy", "stationery", "exam"),
    "Travel": ("flight", "hotel", "trip", "travel", "oyo", "airbnb", "makemytrip", "irctc"),
    "Gifts": ("gift", "gifts", "present", "donation", "shagun"),
    "Investments": ("sip", "stocks", "shares", "zerodha", "groww", "fd", "ppf", "nps"),
}  # fmt: skip
CATEGORY_OF = {word: category for category, words in CATEGORY_WORDS.items() for word in words}

BRANDS = {
    "dmart": "DMart", "zomato": "Zomato", "swiggy": "Swiggy", "uber": "Uber", "ola": "Ola",
    "rapido": "Rapido", "blinkit": "Blinkit", "zepto": "Zepto", "instamart": "Instamart",
    "bigbasket": "BigBasket", "amazon": "Amazon", "flipkart": "Flipkart", "myntra": "Myntra",
    "netflix": "Netflix", "spotify": "Spotify", "hotstar": "Hotstar", "pvr": "PVR",
    "inox": "INOX", "kfc": "KFC", "mcdonalds": "McDonald's", "dominos": "Domino's",
    "starbucks": "Starbucks", "jio": "Jio", "airtel": "Airtel", "irctc": "IRCTC", "oyo": "OYO",
    "nykaa": "Nykaa", "decathlon": "Decathlon", "apollo": "Apollo", "udemy": "Udemy",
}  # fmt: skip


def _amount(token: str) -> int | None:
    m = AMOUNT.match(token)
    if not m:
        return None
    value = m.group(1).replace(",", "")
    paise = to_paise(value) * (1000 if m.group(2) else 1)
    return paise if 0 < paise <= MAX_PAISE else None


def _describe(words: list[str]) -> str:
    out = [BRANDS.get(w, w) for w in words]
    first = out[0]
    if first == words[0]:  # not a brand: sentence case
        out[0] = first[:1].upper() + first[1:]
    return " ".join(out)


def _item(
    text: str,
    accounts: list[Account],
    categories: set[str],
    primary: Account,
    people: set[str],
) -> tuple[str, str, int, Account] | None:
    """One "chai 40 cash" → (description, category, paise, account), or None if not simple."""
    # "₹ 40" / "rs 40" / "40 rs" are one amount; split glued forms like "40rs" stay one token.
    tokens = [t for t in re.split(r"\s+", text.strip().lower()) if t]
    amounts: list[int] = []
    accounts_named: set[int] = set()
    words: list[str] = []
    for token in tokens:
        token = token.strip(".!?:")
        if not token or token in CURRENCY_WORDS:
            continue
        if (paise := _amount(token)) is not None:
            amounts.append(paise)
            continue
        if any(ch.isdigit() for ch in token):
            return None  # "2x", "10am", "3pm": not a plain amount
        if token in people:
            return None
        if token in CASH_WORDS:
            cash = next((a for a in accounts if a.kind == "cash"), None)
            if cash is None:
                return None
            accounts_named.add(cash.id)
            continue
        if token in PRIMARY_WORDS:
            accounts_named.add(primary.id)
            continue
        named = next(
            (
                a
                for a in accounts
                if token in {a.name.lower(), (a.bank_code or "").lower()}
                or token == a.name.lower().split()[0]
            ),
            None,
        )
        if named is not None:
            accounts_named.add(named.id)
            continue
        if token in FILLER:
            continue
        words.append(token)

    if len(amounts) != 1 or len(accounts_named) > 1 or not words:
        return None
    spend = [CATEGORY_OF[w] for w in words if w in CATEGORY_OF and CATEGORY_OF[w].lower() in categories]
    if not spend or len(set(spend)) > 1:
        return None  # unfamiliar, or pulls two ways: let Gemini pick
    account = next((a for a in accounts if a.id in accounts_named), primary)
    return _describe(words), spend[0], amounts[0], account


def parse(text: str, ctx, *, now: datetime) -> GProposal | None:
    """`ctx` is a proposals.LogContext. Returns None to mean "ask Gemini"."""
    text = (text or "").strip()
    if not text or len(text) > MAX_LENGTH or COMPLEX.search(text):
        return None
    categories = {c.name.lower(): c.name for c in ctx.categories}
    people = {p.name.lower() for p in ctx.people} | {
        alias.lower() for p in ctx.people for alias in (p.aliases or [])
    }
    parts = [p for p in SEPARATORS.split(text) if p and p.strip()]
    if not parts or len(parts) > MAX_ITEMS:
        return None

    when = now.astimezone(IST).strftime("%Y-%m-%d %H:%M")
    expenses = []
    for part in parts:
        item = _item(part, ctx.accounts, set(categories), ctx.primary, people)
        if item is None:
            return None
        description, category, paise, account = item
        # Pending bank SMS could be this very payment; matching those is Gemini's job.
        if ctx.txns and account.kind != "cash":
            return None
        rupees = paise / 100
        expenses.append(
            GExpense(
                description=description,
                category=categories[category.lower()],
                time=when,
                total=rupees,
                my_share=rupees,
                payments=[GPayment(source=account.name, amount=rupees)],
                owed_by=[],
            )
        )
    return GProposal(
        transcript="", expenses=expenses, settlements=[], transfers=[], ignored=[], questions=[]
    )
