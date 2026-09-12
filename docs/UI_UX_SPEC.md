# PriceRadar — UI/UX & Design Direction Specification

## 1. Purpose

This document defines the visual and interaction direction for PriceRadar.

The UI must feel:

- Modern
- Premium
- Simple
- Clean
- Easy to understand
- Calm and trustworthy
- Data-focused without feeling dense
- Smooth and responsive
- Polished enough for a hackathon-winning SaaS product

The goal is **not** to copy the reference designs. Use them only as visual inspiration for hierarchy, spacing, composition, clarity, component quality, and interaction patterns.

---

# 2. Reference Designs

Use these references as inspiration:

1. Crypto Wallet Dashboard UI Template — Dribbble
   https://dribbble.com/shots/25281063-Crypto-Wallet-Dashboard-UI-Template

2. Dashboard for an Education Platform — Lingoro
   https://dribbble.com/shots/27660876-Dashboard-for-an-Education-Platform-Lingoro

3. Medical Website / Patient Portal — Dribbble
   https://dribbble.com/shots/27594036-Medical-Website-Design-Patient-Portal

The first reference demonstrates a polished dashboard-oriented composition and dark-interface aesthetic. The second provides inspiration for education/product dashboard organization and restrained visual hierarchy. The third demonstrates a clean, calm portal with strong information clarity and subtle accent colors.

Do not copy:
- logos
- branding
- exact illustrations
- proprietary graphics
- exact text
- exact layout dimensions
- exact color palette
- distinctive branded components

Take inspiration from the design principles, not the artwork.

---

# 3. Overall Visual Direction

## Keywords

```text
Premium
Minimal
Modern
Trustworthy
Analytical
Elegant
Calm
Fast
Precise
Professional
```

PriceRadar should look more like a high-quality modern SaaS/data product than a generic admin template.

Avoid the feeling of:
- generic Bootstrap dashboard
- overly colorful analytics template
- excessive glassmorphism
- excessive gradients
- huge cards
- excessive rounded corners
- visual clutter

---

# 4. Layout Philosophy

Use a strong desktop-first dashboard layout:

```text
┌──────────────┬───────────────────────────────────────────┐
│              │ Header                                    │
│   Sidebar    ├───────────────────────────────────────────┤
│              │                                           │
│              │ Main Dashboard                            │
│              │                                           │
│              │ KPI / Overview                            │
│              │                                           │
│              │ Course Intelligence                      │
│              │                                           │
│              │ Self-Healing / Activity                  │
│              │                                           │
└──────────────┴───────────────────────────────────────────┘
```

The sidebar should be compact and elegant.

The main content should have generous whitespace while still fitting meaningful information above the fold.

---

# 5. Navigation

Suggested navigation:

```text
PriceRadar

Overview
Courses
Price Changes
Urgency Signals
Self-Healing

────────────

Scrapers
Activity

────────────

Settings
```

Use simple, recognizable icons.

Do not overload navigation with unnecessary pages.

Sidebar behavior:

- expandable/collapsible
- smooth width transition
- active item clearly visible
- subtle hover state
- tooltip when collapsed

---

# 6. Header

Header should contain:

- current page title
- short contextual description where useful
- global search if genuinely useful
- last sync indicator
- notification/alert indicator
- optional profile/settings area

Keep the header quiet and uncluttered.

Example:

```text
Price Intelligence                         Last synced 2m ago
Monitor course pricing and recurring offers
```

---

# 7. Dashboard Overview

The primary dashboard should immediately answer:

1. What is happening with prices?
2. Which courses changed?
3. Which offers look persistent?
4. Is the scraper system healthy?

Suggested top-level metrics:

```text
Tracked Courses
Price Changes
Potential Persistent Offers
Scraper Health
```

Cards should be compact and informative.

Do not create giant dashboard cards.

---

# 8. KPI Cards

Each KPI card should contain:

- small label
- primary number
- short comparison/status
- subtle icon
- optional micro trend indicator

Example:

```text
TRACKED COURSES

24

+3 this week
```

Use visual emphasis carefully.

The number should dominate; supporting information should remain secondary.

---

# 9. Course Intelligence Table

This is one of the most important screens.

The table should feel premium and highly readable.

Suggested columns:

```text
Course
Platform
Current Price
Original Price
Discount
Urgency
Price Change
Last Scraped
Status
```

Example conceptual row:

```text
┌─────────────────────────────────────────────────────────────┐
│ Full Stack Development                                      │
│ Coding Ninjas       ₹49,999   ₹99,999   50%   ⚠ Recurring  │
└─────────────────────────────────────────────────────────────┘
```

Important:

- platform should have a subtle visual identity
- prices should use strong typography
- discount should be easy to scan
- status should use compact badges
- rows should have subtle hover interactions
- avoid excessive borders

Use whitespace and typography to create separation.

---

# 10. Price Change Visualization

Price changes should be immediately understandable.

Example:

```text
₹9,999
  ↓
₹7,999

-20%
```

Use a compact visual indicator rather than a large chart unless historical data actually exists.

Never fabricate historical information.

---

# 11. Urgency Signal

Use careful language.

Do NOT say:

```text
FAKE DISCOUNT
FRAUD
MANIPULATION CONFIRMED
```

Preferred:

```text
Potential Persistent Urgency
Recurring Offer Detected
Repeated Countdown
```

Example badge:

```text
⚠ Recurring urgency
Seen across 6 snapshots
```

Clicking/hovering should reveal why the flag exists.

---

# 12. Self-Healing Panel

This is the **hackathon showcase component**.

It should look like a live infrastructure/monitoring feed.

Example:

```text
SELF-HEALING ACTIVITY

● 14:32  Scaler scraper
          Price field extraction failed

          ↓ Detect

● 14:32  Validation failure
          current_price returned empty

          ↓ Heal

● 14:33  Bright Data repair completed

✓ 14:33  Scraper recovered
```

Make this visually impressive but not noisy.

Use subtle animated status indicators.

A live recovery event can use a small pulse animation.

---

# 13. Scraper Health

Create a compact health overview:

```text
SCRAPER HEALTH

Scaler              ● Healthy
Coding Ninjas       ● Healthy
Newton School       ● Healing
PW                  ● Healthy
```

Status states:

- Healthy
- Warning
- Healing
- Failed
- Disabled

Use color only as a secondary cue. Pair colors with text/icons for accessibility.

---

# 14. Course Detail Page

When a user opens a course:

```text
Course title
Platform
Current price
Original price
Discount
Urgency status
Last scraped
Course URL

Price information
Urgency observations
Scraper status
Recent activity
```

Keep it simple.

The detail page should answer:

> "What is happening with this course right now, and why?"

---

# 15. Interactions

The interface should have many **small, useful interactions**, not flashy animations.

Examples:

### Hover

- table row subtly highlights
- KPI card slightly elevates
- icons reveal tooltips
- status badge shows explanation

### Click

- course row opens detail
- urgency badge opens evidence
- scraper status opens activity
- price-change item opens comparison

### Copy

If a useful URL/identifier is displayed:

```text
Copy
✓ Copied
```

with a tiny feedback animation.

---

# 16. Animation Philosophy

Animation should communicate state, not decorate the UI.

Use:

- opacity transitions
- 150–250ms hover transitions
- subtle scale
- smooth sidebar transitions
- skeleton loading
- status pulse
- number transitions when values change
- subtle row insertion/removal

Avoid:

- constant floating animations
- excessive bouncing
- large page transitions
- distracting parallax
- animation on every element

The interface should feel **alive but calm**.

---

# 17. Motion Principles

Use Framer Motion where it genuinely improves interaction.

Suggested motion:

```text
Page enter:
opacity 0 → 1
small translateY → 0

Card hover:
translateY(-1px)

Sidebar:
width transition

Modal:
opacity + small scale

Status update:
small pulse

Table:
subtle row transition
```

Respect:

```text
prefers-reduced-motion
```

Users who disable motion should still get a complete functional experience.

---

# 18. Loading States

Never show a blank dashboard.

Use skeletons for:

- KPI cards
- tables
- activity feeds
- detail sections

Skeletons should match the approximate final layout.

Avoid giant generic spinners.

---

# 19. Empty States

Empty states should explain what happened.

Example:

```text
No price changes yet

PriceRadar hasn't detected a price movement
for the selected courses.

Last scan: 8 minutes ago
```

Do not make empty states look like errors.

---

# 20. Error States

Errors should be calm and actionable.

Example:

```text
Unable to load course data

The latest dashboard data could not be retrieved.

Try again
```

Do not expose:

- stack traces
- database errors
- credentials
- internal infrastructure details

---

# 21. Responsive Design

Desktop is the primary hackathon presentation target.

Still support:

### Desktop
Full sidebar + dashboard.

### Tablet
Compact sidebar + responsive cards/table.

### Mobile
Collapsed navigation + horizontally scrollable data table or carefully transformed course cards.

Do not simply shrink the desktop UI.

---

# 22. Typography

Use a modern highly readable sans-serif typeface.

Hierarchy:

```text
Page title       Strong
Section heading  Medium/semibold
Metric           Bold
Body             Regular
Metadata         Smaller/muted
```

Avoid excessive font weights.

Do not use more than necessary.

---

# 23. Color Philosophy

Use a restrained neutral base.

Recommended conceptual system:

```text
Background     neutral
Surface        slightly elevated neutral
Text           high contrast
Muted text     subdued neutral

Primary        one strong accent
Success        green
Warning        amber
Danger         red
Info           blue
```

Do not use a rainbow dashboard.

Accent colors should communicate meaning.

---

# 24. Borders & Shadows

Use subtle borders.

Prefer:

```text
1px low-contrast border
+
very subtle shadow
```

rather than heavy cards.

Cards should visually belong to the same surface system.

Avoid excessive drop shadows.

---

# 25. Border Radius

Use a consistent radius system.

Example:

```text
Small controls    8px
Cards             12–16px
Large panels      16–20px
```

Do not make every element extremely rounded.

---

# 26. Design System Consistency

Create reusable components:

```text
Button
Badge
Card
KPI Card
DataTable
StatusIndicator
Tooltip
Dropdown
Modal
Tabs
Skeleton
EmptyState
ErrorState
ActivityItem
```

Do not implement visually similar components separately with different spacing.

---

# 27. Accessibility

Required:

- keyboard navigation
- visible focus states
- semantic HTML
- accessible buttons
- accessible form labels
- sufficient contrast
- meaningful ARIA labels where necessary
- reduced-motion support

Do not rely only on color to communicate status.

---

# 28. Performance

Avoid unnecessary animation/rendering.

Use:

- efficient React components
- stable keys
- memoization only where justified
- lazy loading where useful
- optimized assets

Do not add heavy visualization libraries unless actually required.

---

# 29. Visual Quality Bar

Before considering UI complete, ask:

### Does it feel premium?
Would this look credible beside modern SaaS products?

### Does it feel simple?
Can a new user understand the dashboard quickly?

### Does it feel trustworthy?
Does the visual design communicate data integrity?

### Does it feel alive?
Are there useful micro-interactions without visual noise?

### Does it feel original?
Are references used as inspiration rather than copied?

---

# 30. Implementation Rule for Claude Code

When implementing UI:

1. Read this file first.
2. Follow the design direction consistently.
3. Use the supplied Dribbble references for inspiration.
4. Do not copy the reference designs.
5. Build reusable components.
6. Implement loading/error/empty states.
7. Add subtle micro-interactions.
8. Keep animation purposeful.
9. Test responsive layouts.
10. Test keyboard accessibility.
11. Do not sacrifice functionality for visual effects.

The final UI should feel like a **premium price-intelligence SaaS product**, not a generic admin dashboard.

---

# 31. Final Design Statement

PriceRadar should visually communicate:

> **"Complex pricing intelligence, made simple."**

The user should feel that the product is:

**clean → trustworthy → intelligent → fast → premium**

without feeling over-designed.
