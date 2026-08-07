#!/usr/bin/env python3
"""
Generates the Google Ads API Token Application — Design Documentation PDF for Acuarius.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

OUTPUT = "/Users/mac/Documents/Claude/Acuarius/Acuarius_Google_Ads_API_Design_Doc.pdf"

# ── Colors ───────────────────────────────────────────────────────
BLUE    = colors.HexColor("#1E2BCC")
LBLUE   = colors.HexColor("#E8EAFC")
DGRAY   = colors.HexColor("#1F2937")
MGRAY   = colors.HexColor("#4B5563")
LGRAY   = colors.HexColor("#9CA3AF")
BORDER  = colors.HexColor("#D1D5DB")
WHITE   = colors.white

# ── Styles ───────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    base = styles[name] if name in styles else styles["Normal"]
    return ParagraphStyle(name + str(id(kw)), parent=base, **kw)

H1  = S("h1", fontSize=20, textColor=BLUE,  spaceAfter=6,  spaceBefore=18, fontName="Helvetica-Bold", leading=24)
H2  = S("h2", fontSize=13, textColor=BLUE,  spaceAfter=4,  spaceBefore=14, fontName="Helvetica-Bold", leading=17)
H3  = S("h3", fontSize=11, textColor=DGRAY, spaceAfter=3,  spaceBefore=10, fontName="Helvetica-Bold", leading=14)
BODY= S("body",fontSize=10, textColor=MGRAY, spaceAfter=4,  spaceBefore=2,  fontName="Helvetica",     leading=15, alignment=TA_JUSTIFY)
BULL= S("bull",fontSize=10, textColor=MGRAY, spaceAfter=2,  spaceBefore=1,  fontName="Helvetica",     leading=14, leftIndent=16)
MONO= S("mono",fontSize=9,  textColor=DGRAY, spaceAfter=2,  spaceBefore=1,  fontName="Courier",       leading=13, leftIndent=20)
CAP = S("cap", fontSize=9,  textColor=LGRAY, spaceAfter=2,  spaceBefore=0,  fontName="Helvetica-Oblique", leading=12, alignment=TA_CENTER)
LABEL=S("lbl", fontSize=9,  textColor=MGRAY, spaceAfter=1,  spaceBefore=0,  fontName="Helvetica-Bold", leading=12)

def hr(): return HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=8, spaceBefore=4)
def sp(n=8): return Spacer(1, n)
def h1(t): return Paragraph(t, H1)
def h2(t): return Paragraph(t, H2)
def h3(t): return Paragraph(t, H3)
def p(t):  return Paragraph(t, BODY)
def b(t):  return Paragraph("<bullet>&bull;</bullet> " + t, BULL)
def mono(t): return Paragraph(t, MONO)
def cap(t):  return Paragraph(t, CAP)
def lbl(t):  return Paragraph(t, LABEL)

def info_box(rows):
    """Two-column label/value table with light blue background."""
    data = [[Paragraph("<b>" + r[0] + "</b>", LABEL), Paragraph(r[1], BODY)] for r in rows]
    t = Table(data, colWidths=[1.8*inch, 4.7*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), LBLUE),
        ("ROWBACKGROUNDS",(0,0),(-1,-1),[LBLUE, WHITE]),
        ("BOX",         (0,0), (-1,-1), 0.5, BORDER),
        ("INNERGRID",   (0,0), (-1,-1), 0.3, BORDER),
        ("TOPPADDING",  (0,0), (-1,-1), 5),
        ("BOTTOMPADDING",(0,0),(-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING",(0,0), (-1,-1), 8),
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
    ]))
    return t

def section_header(num, title):
    """Numbered section header with blue left bar."""
    data = [[
        Paragraph("<b>" + str(num) + "</b>", S("n", fontSize=13, textColor=WHITE, fontName="Helvetica-Bold", alignment=TA_CENTER)),
        Paragraph(title, S("t", fontSize=13, textColor=WHITE, fontName="Helvetica-Bold", leading=16)),
    ]]
    t = Table(data, colWidths=[0.38*inch, 6.12*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (0,0), BLUE),
        ("BACKGROUND", (1,0), (1,0), BLUE),
        ("TOPPADDING",    (0,0),(-1,-1), 7),
        ("BOTTOMPADDING", (0,0),(-1,-1), 7),
        ("LEFTPADDING",   (0,0),(0,0),   6),
        ("LEFTPADDING",   (1,0),(1,0),   10),
        ("RIGHTPADDING",  (0,0),(-1,-1), 6),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
    ]))
    return t

# ── Build story ─────────────────────────────────────────────────
story = []

# ── Cover / Header ──────────────────────────────────────────────
cover = Table([[
    Paragraph("<b>Acuarius</b>", S("cv", fontSize=26, textColor=WHITE, fontName="Helvetica-Bold")),
    Paragraph("Google Ads API<br/><font size=13>Design Documentation</font>",
              S("cv2", fontSize=18, textColor=WHITE, fontName="Helvetica-Bold", alignment=TA_CENTER)),
]], colWidths=[2.5*inch, 4*inch])
cover.setStyle(TableStyle([
    ("BACKGROUND", (0,0),(-1,-1), BLUE),
    ("TOPPADDING",    (0,0),(-1,-1), 22),
    ("BOTTOMPADDING", (0,0),(-1,-1), 22),
    ("LEFTPADDING",   (0,0),(-1,-1), 18),
    ("RIGHTPADDING",  (0,0),(-1,-1), 18),
    ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
    ("ROUNDEDCORNERS",(0,0),(-1,-1), 4),
]))
story += [cover, sp(6)]

story += [info_box([
    ("Company",         "Acuarius"),
    ("Website",         "https://app.acuarius.app"),
    ("Contact email",   "ceo@acuarius.app"),
    ("MCC Account ID",  "243-259-8177"),
    ("Document date",   "May 2026"),
    ("Document version","1.0"),
]), sp(4), hr()]

# ── 1. Company & Product Overview ───────────────────────────────
story += [sp(4), section_header(1, "Company & Product Overview"), sp(8)]

story += [
    h2("1.1  What is Acuarius?"),
    p("Acuarius is a <b>SaaS platform</b> that provides AI-powered marketing agents for agencies and "
      "businesses in Latin America. The platform allows users to work with specialized agents for "
      "Google Ads, Meta Ads, TikTok Ads, SEO, and Social Content — each backed by Claude (Anthropic's "
      "large language model) with domain-specific expertise."),
    sp(4),

    h2("1.2  Business Model"),
    p("Acuarius operates as a subscription-based SaaS. Clients are marketing agencies and in-house "
      "marketing teams who manage Google Ads accounts on behalf of their own clients or their own "
      "business. Each Acuarius user authenticates with their own Google account via OAuth 2.0, "
      "granting the platform read and limited write access <i>only to their own Google Ads accounts</i>."),
    sp(4),

    h2("1.3  Company Type"),
    p("Acuarius is classified as an <b>Agency / SEM platform</b>. The primary use of the Google Ads "
      "API is to retrieve performance data on behalf of authenticated end users, display AI-driven "
      "insights, and perform limited campaign management actions (bid adjustments, budget changes, "
      "status toggles) at the explicit request of those users."),
    sp(4),
    hr(),
]

# ── 2. Tool Architecture ─────────────────────────────────────────
story += [sp(4), section_header(2, "Tool Architecture & Technology Stack"), sp(8)]

story += [
    h2("2.1  Architecture Overview"),
    p("Acuarius is a <b>client-side web application</b> with serverless API functions deployed on Vercel. "
      "There is no traditional backend server; all processing happens in Vercel Edge Functions "
      "(Node.js). User data is persisted in Supabase (PostgreSQL)."),
    sp(6),

    lbl("Technology Stack"),
    sp(3),
]

tech_data = [
    ["Layer",           "Technology",               "Purpose"],
    ["Frontend",        "HTML + JavaScript (vanilla)","Single-page application at app.acuarius.app"],
    ["API Functions",   "Node.js (Vercel Serverless)","Proxy between frontend and Google Ads API"],
    ["Auth (Users)",    "Clerk",                    "User identity and session management"],
    ["Auth (Google)",   "Google OAuth 2.0",         "Delegated access to user's Google Ads accounts"],
    ["Data Storage",    "Supabase (PostgreSQL)",    "Token storage and user profiles"],
    ["AI Engine",       "Anthropic Claude API",     "Natural language analysis and recommendations"],
]
tt = Table(tech_data, colWidths=[1.4*inch, 1.8*inch, 3.3*inch])
tt.setStyle(TableStyle([
    ("BACKGROUND",    (0,0),(-1,0),  BLUE),
    ("TEXTCOLOR",     (0,0),(-1,0),  WHITE),
    ("FONTNAME",      (0,0),(-1,0),  "Helvetica-Bold"),
    ("FONTSIZE",      (0,0),(-1,-1), 9),
    ("ROWBACKGROUNDS",(0,1),(-1,-1), [LBLUE, WHITE]),
    ("BOX",           (0,0),(-1,-1), 0.5, BORDER),
    ("INNERGRID",     (0,0),(-1,-1), 0.3, BORDER),
    ("TOPPADDING",    (0,0),(-1,-1), 5),
    ("BOTTOMPADDING", (0,0),(-1,-1), 5),
    ("LEFTPADDING",   (0,0),(-1,-1), 7),
    ("RIGHTPADDING",  (0,0),(-1,-1), 7),
    ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
]))
story += [tt, sp(10)]

story += [
    h2("2.2  System Flow Diagram (Text Representation)"),
    p("The following describes the end-to-end data flow when a user interacts with the Google Ads agent:"),
    sp(4),
]

flow_steps = [
    ("Step 1 — User Login",
     "User authenticates with Acuarius via Clerk (email/password or SSO). "
     "Acuarius assigns a unique user_id (Clerk UID)."),
    ("Step 2 — Google OAuth Initiation",
     "User clicks 'Connect Google Ads' in Settings. Acuarius redirects to Google's OAuth 2.0 "
     "authorization endpoint requesting scopes: adwords + userinfo.email. The request includes "
     "the Acuarius user_id as state parameter."),
    ("Step 3 — User Consent",
     "Google shows the standard consent screen listing the requested permissions. "
     "The user reviews and explicitly approves access."),
    ("Step 4 — Token Exchange",
     "Google redirects to the Acuarius callback URL (/api/oauth/callback) with an authorization code. "
     "The serverless function exchanges the code for access_token and refresh_token using the "
     "Google Token endpoint. Tokens are stored in Supabase linked to the user_id."),
    ("Step 5 — Account Selection",
     "The frontend calls /api/list-accounts which proxies to "
     "customers:listAccessibleCustomers. The user selects which Google Ads customer account "
     "to work with. The customer_id is stored in the browser (localStorage)."),
    ("Step 6 — API Queries",
     "When the user asks the AI agent a question requiring data, the agent generates a GAQL "
     "(Google Ads Query Language) query. The frontend sends this to /api/google-ads, which "
     "proxies the query to the Google Ads Search API. Results are returned to the AI for analysis."),
    ("Step 7 — Campaign Actions",
     "If the user explicitly requests a change (e.g., 'pause campaign X'), the agent presents "
     "a confirmation card. Only after the user confirms does Acuarius call the mutate endpoint. "
     "All write actions require confirm: true in the API payload."),
]

for title, desc in flow_steps:
    story += [
        Paragraph("<b>" + title + "</b>", S("fs", fontSize=10, textColor=BLUE, fontName="Helvetica-Bold", spaceAfter=2, spaceBefore=6, leading=13)),
        p(desc),
    ]

story += [sp(4), hr()]

# ── 3. OAuth & Token Management ──────────────────────────────────
story += [sp(4), section_header(3, "OAuth 2.0 Implementation & Token Management"), sp(8)]

story += [
    h2("3.1  OAuth Scopes Requested"),
    p("Acuarius requests the minimum necessary scopes:"),
    b("<b>https://www.googleapis.com/auth/adwords</b> — required to read campaign metrics and perform "
      "campaign management actions via the Google Ads API."),
    b("<b>https://www.googleapis.com/auth/userinfo.email</b> — used solely to display the connected "
      "email address in the Acuarius Settings panel for user awareness. Not stored permanently."),
    sp(6),

    h2("3.2  Token Storage"),
    p("Tokens are stored securely in Supabase (PostgreSQL) with the following controls:"),
    b("Each token row is linked to a unique <b>user_id</b> (Clerk UID) — no shared token pools."),
    b("The Supabase table uses Row-Level Security (RLS) — users cannot access other users' tokens."),
    b("The service key used by serverless functions is never exposed to the browser."),
    b("Access tokens are refreshed automatically using the stored refresh_token when a 401 is "
      "received from the Google Ads API."),
    b("Tokens can be revoked at any time by the user clicking 'Disconnect Google Ads' in Settings, "
      "which deletes the row from Supabase and clears browser storage."),
    sp(6),

    h2("3.3  Token Refresh Flow"),
    p("When an access token expires (1 hour TTL):"),
    b("The serverless function detects a 401 response from Google Ads API."),
    b("It retrieves the stored refresh_token from Supabase for the requesting user_id."),
    b("A new access_token is obtained from https://oauth2.googleapis.com/token."),
    b("The new token is stored back in Supabase and the original request is retried transparently."),
    sp(4),
    hr(),
]

# ── 4. API Usage ──────────────────────────────────────────────────
story += [sp(4), section_header(4, "Google Ads API Usage"), sp(8)]

story += [
    h2("4.1  API Endpoints Used"),
    sp(4),
]

api_data = [
    ["Endpoint / Method",                          "Type",  "Purpose"],
    ["customers:listAccessibleCustomers (GET)",    "Read",  "List all Google Ads accounts the user has access to"],
    ["customers/{id}/googleAds:search (POST)",     "Read",  "Execute GAQL queries: campaigns, keywords, ads, metrics"],
    ["customers/{id}/campaigns:mutate (POST)",     "Write", "Create campaigns (PAUSED status) and update campaign status/budget"],
    ["customers/{id}/campaignBudgets:mutate (POST)","Write","Create and update campaign daily budgets"],
    ["customers/{id}/campaignCriteria:mutate (POST)","Write","Add geo and language targeting to campaigns"],
    ["customers/{id}/adGroups:mutate (POST)",      "Write", "Create ad groups within campaigns"],
    ["customers/{id}/adGroupCriteria:mutate (POST)","Write","Add keywords (positive and negative) to ad groups"],
    ["customers/{id}/adGroupAds:mutate (POST)",    "Write", "Create Responsive Search Ads (RSA)"],
]
at = Table(api_data, colWidths=[2.7*inch, 0.7*inch, 3.1*inch])
at.setStyle(TableStyle([
    ("BACKGROUND",    (0,0),(-1,0),  BLUE),
    ("TEXTCOLOR",     (0,0),(-1,0),  WHITE),
    ("FONTNAME",      (0,0),(-1,0),  "Helvetica-Bold"),
    ("FONTSIZE",      (0,0),(-1,-1), 8.5),
    ("ROWBACKGROUNDS",(0,1),(-1,-1), [LBLUE, WHITE]),
    ("BOX",           (0,0),(-1,-1), 0.5, BORDER),
    ("INNERGRID",     (0,0),(-1,-1), 0.3, BORDER),
    ("TOPPADDING",    (0,0),(-1,-1), 5),
    ("BOTTOMPADDING", (0,0),(-1,-1), 5),
    ("LEFTPADDING",   (0,0),(-1,-1), 6),
    ("RIGHTPADDING",  (0,0),(-1,-1), 6),
    ("VALIGN",        (0,0),(-1,-1), "TOP"),
    # Color-code Write rows
    ("TEXTCOLOR",     (1,2),(1,2),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,3),(1,3),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,4),(1,4),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,5),(1,5),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,6),(1,6),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,7),(1,7),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,8),(1,8),  colors.HexColor("#B45309")),
    ("TEXTCOLOR",     (1,1),(1,1),  colors.HexColor("#065F46")),
]))
story += [at, sp(10)]

story += [
    h2("4.2  Read Operations (Reporting)"),
    p("All read operations use GAQL (Google Ads Query Language) via the googleAds:search endpoint. "
      "These are the primary use case — the AI agent analyzes performance data to generate "
      "recommendations. Typical queries retrieve:"),
    b("Campaign metrics: impressions, clicks, CTR, CPC, conversions, CPA, cost"),
    b("Keyword performance: match type, quality score, search impression share"),
    b("Ad performance: RSA asset ratings, approval status, final URLs"),
    b("Account overview: aggregated KPIs across all campaigns for a date range"),
    sp(4),

    h2("4.3  Write Operations (Campaign Management)"),
    p("All write (mutate) operations are <b>initiated exclusively by the user</b> through explicit "
      "confirmation in the Acuarius UI. The platform never performs automated writes without "
      "a human approval step. Write operations include:"),
    b("<b>Campaign creation</b>: Users can create Search campaigns via a guided wizard. New campaigns "
      "are always created in <b>PAUSED</b> status — they never go live automatically."),
    b("<b>Status changes</b>: Pause or enable a campaign/ad group after user confirmation."),
    b("<b>Budget adjustments</b>: Modify daily budget after user review and explicit approval."),
    b("<b>Bid adjustments</b>: Update keyword CPC bids after user confirmation."),
    b("<b>RSA creation</b>: Create Responsive Search Ads with AI-suggested content that the "
      "user reviews and edits before submission."),
    sp(4),

    h2("4.4  Data Volume & Rate Limits"),
    p("Acuarius is designed for individual account analysis, not bulk scraping. Typical usage per "
      "user session involves 3-10 API calls. The platform respects Google Ads API rate limits "
      "and does not implement any aggressive polling or caching bypass mechanisms. "
      "A 15-minute localStorage cache is used to minimize redundant API calls."),
    sp(4),
    hr(),
]

# ── 5. User Access & Data Privacy ────────────────────────────────
story += [sp(4), section_header(5, "User Access & Data Privacy"), sp(8)]

story += [
    h2("5.1  Who Has Access to the Tool"),
    p("Acuarius is used exclusively by <b>external users</b> — marketing agencies and businesses "
      "who subscribe to the platform. Each user connects their own Google Ads account(s). "
      "There is no internal Acuarius use of client accounts."),
    sp(4),

    h2("5.2  Data Isolation"),
    b("Each user can only access their own Google Ads accounts — those returned by "
      "customers:listAccessibleCustomers for their OAuth token."),
    b("Acuarius has no mechanism to access one user's account on behalf of another user."),
    b("The developer token belongs to Acuarius's MCC account (243-259-8177). It is used as "
      "a header in API calls but does not grant Acuarius access to user accounts — only the "
      "user's OAuth token determines account access."),
    b("Supabase Row-Level Security ensures that serverless functions can only retrieve tokens "
      "for the authenticated user_id making the request."),
    sp(4),

    h2("5.3  Data Retention & Deletion"),
    b("OAuth tokens are stored in Supabase only for the duration of the user's connection. "
      "Disconnecting removes tokens immediately."),
    b("Campaign performance data retrieved via GAQL is <b>not stored</b> in Acuarius databases "
      "— it is processed in-memory per request and returned to the frontend."),
    b("User profiles (business name, industry, objectives) are stored in Supabase and can be "
      "deleted by the user at any time from Settings."),
    b("Account deletion triggers full removal of all user data including OAuth tokens."),
    sp(4),

    h2("5.4  No Third-Party Data Sharing"),
    p("Google Ads data retrieved via the API is used <b>exclusively</b> to provide analysis and "
      "recommendations to the account owner. Acuarius does not sell, share, or transfer Google "
      "Ads data to any third parties. The data is passed to the Anthropic Claude API solely for "
      "the purpose of generating recommendations for the authenticated user, and is not used to "
      "train AI models."),
    sp(4),
    hr(),
]

# ── 6. Developer Token Usage ──────────────────────────────────────
story += [sp(4), section_header(6, "Developer Token & MCC Configuration"), sp(8)]

story += [
    h2("6.1  Developer Token"),
    p("The Acuarius developer token is stored as an environment variable "
      "(<b>GOOGLE_ADS_DEVELOPER_TOKEN</b>) in Vercel. It is never exposed to the browser or "
      "included in client-side code. It is transmitted only in server-to-server API calls "
      "as the developer-token HTTP header."),
    sp(4),

    h2("6.2  MCC Account (login-customer-id)"),
    p("The Acuarius MCC account ID (<b>243-259-8177</b>) is configured as the "
      "login-customer-id header when making API calls. This allows the developer token to be "
      "validated against the MCC while still accessing individual client accounts via their "
      "own OAuth tokens. Client accounts are accessed only if the authenticated user's OAuth "
      "token has permission to do so."),
    sp(4),

    h2("6.3  Access Level Requested"),
    p("Acuarius is requesting <b>Basic Access</b>. The platform's use case — reporting, analysis, "
      "and user-initiated campaign management — is fully within the scope of Basic Access. "
      "Standard Access is not required at this stage."),
    sp(4),
    hr(),
]

# ── 7. Compliance ────────────────────────────────────────────────
story += [sp(4), section_header(7, "Compliance & Policy Adherence"), sp(8)]

story += [
    h2("7.1  Google Ads API Terms of Service"),
    p("Acuarius complies with the Google Ads API Terms of Service. Specifically:"),
    b("The developer token is not shared with third parties."),
    b("User OAuth tokens are obtained through the standard Google consent flow with clear "
      "disclosure of requested permissions."),
    b("Write operations are restricted to user-initiated, confirmed actions only."),
    b("No automated bidding, scraping, or bulk operations are performed without user consent."),
    b("The platform does not attempt to circumvent Google's rate limits or quotas."),
    sp(4),

    h2("7.2  User Transparency"),
    p("Users are informed of the following before connecting their Google Ads account:"),
    b("What data Acuarius will access (campaign metrics, keywords, ad performance)."),
    b("What actions the platform can perform on their behalf (with explicit confirmation required)."),
    b("How to revoke access at any time (Disconnect button in Settings)."),
    sp(4),
    hr(),
]

# ── Footer note ─────────────────────────────────────────────────
story += [
    sp(10),
    cap("This document was prepared by Acuarius for the Google Ads API Token Application (Basic Access). "
        "Contact: ceo@acuarius.app | https://app.acuarius.app | May 2026"),
]

# ── Build PDF ────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=letter,
    rightMargin=0.75*inch,
    leftMargin=0.75*inch,
    topMargin=0.75*inch,
    bottomMargin=0.75*inch,
    title="Acuarius — Google Ads API Design Documentation",
    author="Acuarius",
    subject="Google Ads API Token Application — Basic Access",
)
doc.build(story)
print("PDF generado:", OUTPUT)
