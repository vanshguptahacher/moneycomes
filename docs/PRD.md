# PRD.md — Expense Sharing App

**Document:** Product Requirements Document  
**Version:** 2.0  
**Status:** Phase 1 Product Baseline  
**Audience:** Claude Code, developers, QA, product/design reviewers  
**Primary platform:** Android-first mobile application  
**Build workflow:** Expo + Expo Prebuild / Continuous Native Generation (CNG)  
**Product category:** Personal expense sharing / group expense management  

---

## 0. Executive Product Definition

Build a production-quality expense-sharing application inspired by the familiar mental model of Splitwise, but **not a clone of its branding, source code, proprietary assets, or exact visual design**.

The first release must solve the same core job reliably:

> **Record shared expenses, understand who owes whom, and settle balances with as little friction as possible.**

The initial product deliberately does **not** depend on AI, paid APIs, payment-provider integrations, or advertising revenue. The core experience should be useful on its own.

The product differentiation in Phase 1 is primarily:

- cleaner information hierarchy,
- easier expense entry,
- clearer balance explanations,
- simpler navigation,
- modern premium visual design,
- excellent mobile usability,
- predictable behavior,
- strong financial correctness,
- and production-grade security/reliability.

### Product principle

> **Keep the familiar expense-sharing mental model. Remove unnecessary friction.**

---

# 1. Product Vision

Create an expense-sharing app that users can understand immediately if they have ever used Splitwise or a similar expense tracker, while making common actions feel faster, calmer, and more polished.

The app should answer three questions at every important point:

1. **Who owes whom?**
2. **How much?**
3. **What can I do next?**

The application must feel like a serious consumer finance product, not a college-project CRUD application.

### Desired user reaction

> “I already understand what this app is for, but this version is cleaner, easier, and more pleasant to use.”

---

# 2. Problem Statement

Shared expenses become difficult when several people pay for different things and the group needs to keep track of each person's share.

Common pain points include:

- manually calculating shares,
- forgetting who paid,
- repeatedly asking people for money,
- unclear final balances,
- too many steps to record ordinary expenses,
- difficulty understanding why a balance exists,
- cluttered or dated interfaces,
- friction when onboarding a group,
- and uncertainty about whether a settlement was actually recorded.

Phase 1 addresses these problems without attempting to reinvent expense sharing.

---

# 3. Goals

## 3.1 Primary goals

The Phase 1 product must:

- provide a complete core expense-sharing workflow;
- support real groups and real expenses;
- correctly calculate balances and settlements;
- provide a clear Dashboard/Home experience;
- be easy for first-time users;
- feel familiar to existing expense-sharing users;
- be visually modern, premium, minimal, and distinctive;
- work reliably across common Android phone sizes;
- maintain strict financial/data integrity;
- use secure authentication and authorization;
- be testable at the domain, API, and UI levels;
- be deployable using a low-cost/free-first infrastructure strategy;
- remain extensible for later modules without forcing a rewrite.

## 3.2 Secondary goals

- support common currencies;
- support attachments/receipts where implemented;
- provide useful activity history;
- provide basic spending totals/charts where they add value;
- support notifications where technically justified;
- prepare the architecture for future UPI/payment integration without requiring it in Phase 1.

---

# 4. Non-Goals — Phase 1

The following are explicitly outside the Phase 1 product scope unless separately approved:

- AI expense entry;
- AI receipt understanding;
- AI financial assistant;
- automatic receipt OCR as a required capability;
- automatic bank transaction detection;
- bank-account aggregation;
- full payment processing infrastructure;
- wallet functionality;
- investment/financial planning features;
- social feed/gamification;
- complex recommendation systems;
- business accounting/ERP functionality;
- cryptocurrency or blockchain features;
- microservices;
- unnecessary distributed infrastructure;
- advanced monetization systems;
- advertising in the initial product;
- artificial daily expense limits designed to force payment;
- redesigning the financial model merely to appear different from Splitwise.

Future capabilities may be added in later phases only after Phase 1 is stable.

---

# 5. Product Positioning and Differentiation

Phase 1 should **not** attempt to win through a large feature count.

The product should differentiate through execution:

### 5.1 Core promise

**Expense sharing without unnecessary friction.**

### 5.2 Experience advantages

- one obvious primary action per major screen;
- fast common expense entry;
- clear human language for balances;
- fewer unnecessary steps;
- progressive disclosure for advanced split options;
- excellent empty/loading/error states;
- consistent navigation;
- premium visual system;
- responsive touch interactions;
- no advertising clutter in the initial release.

### 5.3 Competitive rule

Do not copy Splitwise screens pixel-for-pixel. Reproduce the **underlying user mental model and functional requirements**, then improve hierarchy, interaction, and presentation.

---

# 6. Target Users

## 6.1 Students

Typical uses:

- hostel expenses;
- flat/room expenses;
- college trips;
- food orders;
- cabs;
- events;
- shared purchases.

## 6.2 Friends

Typical uses:

- dinners;
- movies;
- weekend trips;
- travel;
- shopping;
- shared subscriptions;
- group purchases.

## 6.3 Flatmates

Typical uses:

- rent;
- electricity;
- groceries;
- internet;
- maintenance;
- cleaning;
- household purchases.

## 6.4 Travel groups

Typical uses:

- hotels;
- transportation;
- meals;
- tickets;
- activities;
- miscellaneous expenses.

---

# 7. Product Principles

## P1 — Financial correctness over visual polish

No animation, shortcut, optimistic UI, or visual feature may compromise financial correctness.

## P2 — Familiarity over novelty

Users should not need to learn a new financial model.

## P3 — Simplicity over feature density

Advanced functionality must be available without making the common workflow complicated.

## P4 — Explain the number

Whenever practical, a balance should be explainable through the underlying expenses and settlements.

## P5 — One primary action

Each major screen should make the most useful next action obvious.

## P6 — Progressive disclosure

Show common controls first. Put uncommon controls behind clear secondary actions.

## P7 — Mobile first

Design for phones before larger displays. Every screen must remain usable on small Android devices.

## P8 — No artificial friction

Do not intentionally make basic expense tracking difficult to push users toward monetization.

## P9 — Production behavior from the beginning

Loading, errors, retries, permissions, session expiry, partial failures, duplicate submissions, and offline/network transitions must be considered during implementation.

## P10 — One source of financial truth

All authoritative balances must come from the same deterministic accounting rules. UI screens must not invent their own formulas.

---

# 8. Phase 1 Functional Scope

Phase 1 is a **complete core product**, not merely a visual prototype.

## Included domains

1. Authentication and account
2. Home/Dashboard
3. Groups
4. Friends / person-to-person expenses
5. Expenses
6. Split methods
7. Balances
8. Debt simplification
9. Settlements
10. Activity/history
11. Notifications where supported
12. Currency handling
13. Categories where useful
14. Search and filters
15. Group/member management
16. Basic totals/charts where supported
17. Export where supported
18. Preferences/settings
19. Security and authorization
20. Production quality and observability

---

# 9. Information Architecture

## 9.1 Primary navigation

Use a mobile bottom navigation structure:

```text
Home       Groups       +       Activity       Account
```

The central `+` is the primary creation action.

The exact navigation component may be adapted for platform conventions, but the mental model must remain simple.

## 9.2 Secondary navigation

```text
Home
├── Person balance
├── Group detail
├── Recent activity
└── Notifications

Groups
├── Group detail
├── Group members
├── Group balances
├── Group totals/charts
├── Group activity
└── Group settings

Add Expense
├── Context selection
├── Payer
├── Participants
├── Split method
├── Currency
└── Details

Activity
└── Activity detail / linked object

Account
├── Profile
├── Preferences
├── Appearance
├── Security
├── Data/export
└── Help/support
```

Navigation must preserve predictable back behavior and must not create dead ends.

---

# 10. Screen and Page Requirements

## 10.1 Authentication

### Sign Up

Required:

- name;
- email;
- password;
- validation;
- clear errors;
- loading state;
- success/session transition.

### Sign In

Required:

- email;
- password;
- validation;
- loading state;
- error state;
- password recovery entry point.

### Password recovery

Provide a secure recovery flow through the selected authentication system.

### Session bootstrap

The app must show an appropriate loading state while determining whether a valid session exists.

Unauthenticated users must not be able to access protected application screens.

---

# 11. Home / Dashboard

The Dashboard is the primary Phase 1 product-level improvement.

## 11.1 Dashboard objective

Immediately answer:

- What am I getting?
- What am I paying?
- What is my net position?
- Who needs my attention?
- Which groups are active?
- What happened recently?
- What should I do next?

## 11.2 Dashboard sections

### Header

- greeting;
- user's display name;
- avatar;
- notification entry.

Keep the header compact.

### Financial summary

Display:

- **You’re getting** — total owed to the user;
- **You’re paying** — total owed by the user;
- **Net** — getting minus paying.

Use clear language rather than accounting terminology.

### Pending people

Separate:

- people who owe the user;
- people the user owes.

Each item should provide an obvious path to view details and settle where applicable.

### Quick actions

At minimum:

- Add expense;
- Settle up;
- Create group;
- Add friend/person.

### Recent groups

Show active/recent groups with:

- name;
- member count;
- user's current position;
- concise status.

### Recent activity

Show recent meaningful events such as:

- expense added;
- payment/settlement recorded;
- group created;
- expense edited.

### New-user empty state

A new user should be guided through:

1. Add a friend/person;
2. Create a group;
3. Add the first expense.

Do not leave a large blank dashboard.

---

# 12. Groups

## 12.1 Groups list

Must support:

- list of groups;
- search;
- relevant filters;
- create group;
- clear balance status;
- fast access to group details.

## 12.2 Group creation

Fields:

- group name;
- optional image/icon;
- currency;
- members.

Creation must validate required fields and prevent duplicate/partial submissions.

## 12.3 Group detail

A group should expose, in a coherent hierarchy:

- group overview;
- current user balance;
- members;
- expenses;
- balances;
- totals/charts where supported;
- activity;
- invite/share;
- settings;
- Add expense;
- Settle up.

## 12.4 Group management

Support, where permissions allow:

- add members;
- remove members;
- invite members;
- leave group;
- edit group information;
- group currency/settings.

Membership changes must be authorization-controlled and must not silently corrupt historical expense data.

---

# 13. Friends / Person-to-Person Expenses

The product must support expenses that are shared directly with another person even when a group is not required.

## Friends list

Show:

- search;
- name;
- avatar;
- current balance;
- status.

Statuses should use clear language:

- “Rahul owes you ₹500”;
- “You owe Rahul ₹300”;
- “All settled”.

## Friend detail

Show:

- current balance;
- shared expense history;
- settlements;
- relevant totals;
- Settle up;
- Add expense.

---

# 14. Expenses

Expenses are the core transactional object of the product.

## 14.1 Add expense

Required concepts:

- description;
- amount;
- currency;
- payer;
- participants;
- split method;
- group or person context.

Optional concepts where supported:

- date;
- note;
- category;
- attachment/receipt.

## 14.2 Fast common flow

The most common expense should be recordable with minimal interaction:

```text
Amount
  ↓
Description
  ↓
Paid by
  ↓
Participants
  ↓
Equal split
  ↓
Save
```

Advanced split methods must not clutter the default path.

## 14.3 Payer selection

Allow:

- current user;
- any eligible group member;
- relevant friend in person-to-person context.

## 14.4 Expense detail

Show:

- description;
- total;
- date;
- payer;
- participants;
- each person's share;
- current user's position;
- group/person context;
- note;
- attachment if available.

Actions:

- edit;
- delete;
- settle where relevant.

## 14.5 Edit expense

Editing must recalculate all affected balances deterministically.

The UI must make it clear that editing an expense can change what people owe.

## 14.6 Delete expense

Deletion requires confirmation and a clear explanation that balances may change.

Financial mutations must be atomic. A failed deletion must not leave partially updated records.

---

# 15. Split Methods

Phase 1 supports:

1. Equal
2. Exact amounts
3. Percentage
4. Shares
5. Adjustment where required by the reference behavior and approved by implementation review

## 15.1 Equal split

Divide the expense across selected participants.

Rounding must be deterministic.

Example:

```text
₹100 / 3

A = ₹34
B = ₹33
C = ₹33
```

The remainder allocation rule must be stable and documented.

## 15.2 Exact split

The sum of participant allocations must equal the expense total.

Reject:

- negative values;
- incomplete allocations;
- over-allocation;
- invalid participants.

## 15.3 Percentage split

The sum must equal exactly 100% after validation according to the chosen precision rules.

Rounding must not cause the final allocations to differ from the total.

## 15.4 Shares split

Example:

```text
Thor   2 shares
Rahul  1 share
Aman   1 share
```

The system calculates allocations deterministically.

## 15.5 Adjustment split

If enabled, adjustment behavior must be explicitly specified in the accounting/business-rules documentation and covered by tests.

---

# 16. Financial and Money Rules

## 16.1 Authoritative representation

Never use JavaScript floating-point numbers as the authoritative representation of money.

Preferred conceptual representation:

```text
amount_minor: integer
currency_code: ISO-style currency code
```

Example:

```text
₹100.50 INR
→
10050 minor units
```

## 16.2 Currency separation

Currency must be stored separately from amount.

Formatting belongs to the presentation layer.

## 16.3 Determinism

Given identical input, the financial engine must always return identical output.

## 16.4 Conservation invariant

For every valid expense:

```text
sum(all participant allocations) == expense total
```

unless an explicitly defined rule says otherwise.

## 16.5 No hidden rounding

Rounding must be visible in the final allocation and must never create or destroy money.

---

# 17. Balance System

Balances are derived from authoritative financial events.

Conceptually:

```text
Expenses
   +
Payments/Settlements
   ↓
Financial Engine
   ↓
Relationship balances
   ↓
Group balances
   ↓
Dashboard summary
```

## 17.1 Relationship balance

Conceptual states:

```text
positive → user gets money
negative → user pays money
zero     → settled
```

The UI must translate these states into natural language.

## 17.2 Group balance

Show:

- member;
- amount;
- direction;
- settlement state.

Example:

> Rahul owes you ₹500.

> You owe Aman ₹300.

## 17.3 Overall balance

Conceptually:

```text
Net = total getting - total paying
```

The Dashboard must consume the same authoritative balance logic used elsewhere.

---

# 18. Debt Simplification

The app should reduce unnecessary payment hops when possible.

Example:

```text
A owes B ₹500
B owes C ₹500
```

May be simplified to:

```text
A pays C ₹500
```

## Requirements

- deterministic output;
- no loss of total obligations;
- no creation/destruction of value;
- clearly explain the resulting suggested transactions;
- preserve the underlying expense history;
- never modify historical expenses merely because a simplified settlement view is shown.

Debt simplification is a presentation/settlement optimization over the authoritative obligations, not a rewrite of history.

---

# 19. Settlement

## 19.1 Settle up flow

```text
View balance
  ↓
Settle up
  ↓
Select person
  ↓
Confirm amount
  ↓
Select recording method
  ↓
Confirm
  ↓
Settlement recorded
  ↓
Balance refreshed
```

## 19.2 Manual/cash settlement

Support recording an external payment.

Example:

> You paid Rahul ₹500.

After confirmation:

- settlement record is created;
- affected balance changes;
- activity event is created;
- UI refreshes from authoritative state.

## 19.3 Partial settlement

Allow a user to settle less than the outstanding balance where valid.

Example:

```text
Outstanding: ₹820
Paid: ₹500
Remaining: ₹320
```

## 19.4 Payment provider / UPI

Full UPI/payment-provider integration is **not required for Phase 1**.

The architecture may reserve a clean integration boundary for later implementation.

Opening another payment application must never by itself be treated as proof that a payment succeeded.

---

# 20. Activity and History

Activity provides an understandable chronological record.

Supported events may include:

- expense added;
- expense edited;
- expense deleted;
- settlement recorded;
- payment recorded;
- group created;
- member added/removed;
- friend relationship changed.

Filters:

- all;
- expenses;
- payments/settlements;
- groups;
- people/friends.

Each relevant activity item should deep-link to the underlying object.

---

# 21. Totals and Charts

Where included, group totals/charts should remain lightweight and useful.

Possible information:

- total group spending;
- spending over time;
- category totals;
- member contributions;
- user's share.

Charts must not dominate the application.

The Dashboard should remain focused on actionable financial state rather than becoming an analytics dashboard.

---

# 22. Search and Filters

Search should support relevant objects:

- people/friends;
- groups;
- expenses;
- activity where practical.

Filters should be simple and task-oriented.

Do not introduce a specialized search engine in Phase 1 unless real performance requirements justify it.

---

# 23. Currency

Phase 1 must support a practical set of currencies with **INR as a first-class currency**.

Requirements:

- currency selection;
- default currency;
- group/expense currency according to the supported model;
- correct symbol/number formatting;
- centralized currency metadata;
- correct minor-unit behavior.

Multi-currency conversion rules must be explicit. Do not silently invent exchange rates.

---

# 24. Categories

Basic expense categories may be provided to improve organization:

- Food
- Transport
- Travel
- Home
- Groceries
- Entertainment
- Shopping
- Health
- Other

Categories are supportive metadata and must not complicate expense entry.

---

# 25. Notifications

Notifications should be useful, not noisy.

Potential events:

- added to a group;
- expense added involving the user;
- expense edited;
- settlement recorded;
- relevant balance reminder;
- group invitation.

Notifications must deep-link to the relevant destination where possible.

Do not send unnecessary promotional notifications in Phase 1.

---

# 26. Account and Settings

## Profile

- name;
- email;
- avatar where supported.

## Preferences

- default currency;
- notifications;
- appearance;
- other lightweight preferences.

## Appearance

Support:

- light;
- dark;
- system preference.

## Security

Provide appropriate account/security controls supported by the chosen authentication implementation.

## Data

Where implemented:

- export user data;
- privacy information;
- account deletion.

## Help

- FAQ;
- support/help entry;
- app information.

---

# 27. Monetization Strategy — Phase 1

## 27.1 Initial state

**No advertising.**

The initial product should not show:

- banner ads;
- interstitial ads;
- rewarded ads;
- sponsored cards;
- promotional popups.

This is intentional because the Phase 1 goal is product validation and a premium, trustworthy experience.

## 27.2 Future premium concept

The currently approved future premium concept is intentionally simple:

> **Premium = Ad removal**

Because Phase 1 has no ads, there is no premium monetization implementation requirement in Phase 1.

Future monetization must not make core expense splitting artificially frustrating.

If monetization changes later, it requires a product decision and updated PRD before implementation.

---

# 28. UI/UX Requirements

## 28.1 Visual direction

The application must feel:

- modern;
- premium;
- minimal;
- clean;
- calm;
- trustworthy;
- polished;
- friendly;
- distinctive;
- financially clear.

## 28.2 Avoid generic app UI

Do not produce:

- generic Bootstrap-style layouts;
- random template cards;
- excessive gradients;
- excessive glassmorphism;
- huge cards with little information;
- excessive rounded corners;
- rainbow-like color palettes;
- unnecessary shadows;
- excessive animation;
- visual clutter.

## 28.3 Color system

Use a deliberate semantic palette with a restrained primary/accent color and clear financial semantics.

At minimum define semantic roles for:

- background;
- surface;
- elevated surface;
- primary text;
- secondary text;
- border/divider;
- primary action;
- positive/getting;
- negative/paying;
- warning;
- destructive;
- informational state.

Never communicate financial meaning through color alone.

## 28.4 Typography

Use one coherent type system with clear hierarchy.

Financial amounts must have strong numeric readability.

## 28.5 Touch targets

Interactive elements must be comfortably tappable on phones.

Avoid tiny icons used as the only way to perform important actions.

## 28.6 Responsive phone behavior

The UI must work across:

- small Android phones;
- normal Android phones;
- large Android phones;
- different aspect ratios;
- system font scaling within reasonable supported limits.

Avoid hardcoded screen dimensions.

Content should scroll naturally where necessary.

Keyboard-aware forms are required for text/number entry screens.

## 28.7 Accessibility

At minimum:

- readable contrast;
- accessible labels for icon-only actions;
- meaningful focus/interaction order where applicable;
- sufficient touch targets;
- non-color-only status communication;
- support for system font scaling where feasible;
- clear error messages.

---

# 29. UX Requirements for Common Flows

## 29.1 Add expense

A normal expense should require as few decisions as possible.

Advanced options should be hidden until requested.

## 29.2 Understand balance

A balance should be understandable without mental arithmetic.

Bad:

> Net receivable: ₹1,843

Preferred:

> Rahul owes you ₹820.

## 29.3 Settlement

The user must see:

- who is paying whom;
- amount;
- remaining balance after settlement.

## 29.4 Error recovery

If a network operation fails:

- do not silently discard user input;
- show a useful error;
- provide retry;
- avoid duplicate submissions;
- do not show a fake successful financial state.

---

# 30. Loading, Empty, Error, and Success States

Every major screen must define all meaningful states.

## Loading

Prefer skeletons or contextual loading indicators over unnecessary full-screen spinners.

## Empty

Every major collection needs a useful empty state with a clear CTA.

Example:

> No expenses yet  
> Add your first expense.

## Error

Use friendly messages and recovery actions.

Never expose raw database errors, stack traces, SQL errors, or internal implementation details.

## Success

Financial mutations should provide concise confirmation.

Example:

> Expense added ✓

The confirmation must not imply success before the authoritative operation has succeeded.

---

# 31. Security and Privacy Requirements

Security requirements are mandatory, not a post-launch enhancement.

## 31.1 Authentication

- secure authentication;
- secure session handling;
- protected routes;
- session expiry strategy;
- logout;
- password recovery where supported;
- never store plaintext passwords.

## 31.2 Authorization

Authentication answers:

> Who are you?

Authorization answers:

> Are you allowed to access this resource?

Every protected group, expense, person relationship, settlement, activity record, and attachment must be authorization-checked server-side.

## 31.3 Financial mutation security

Every financial mutation must:

- authenticate the user;
- authorize the resource;
- validate input;
- validate domain rules;
- execute atomically;
- prevent duplicate submission where necessary;
- return authoritative state.

## 31.4 Data privacy

Users must not be able to access another user's private expense data merely by knowing an object ID.

## 31.5 Sensitive local data

Sensitive authentication-related local data must use secure platform storage where appropriate.

Detailed security controls belong in `SECURITY_SPEC.md` / `security.md` and must not conflict with this PRD.

---

# 32. Production-Level Reliability Requirements

The product must be designed as a production application from the beginning.

Required considerations:

- typed contracts;
- schema validation;
- deterministic accounting;
- database constraints;
- transactional financial mutations;
- idempotency for duplicate-prone operations;
- consistent API errors;
- retry-safe behavior;
- request timeouts;
- network failure handling;
- session expiry handling;
- migration discipline;
- logging without leaking secrets;
- crash/error monitoring before public release;
- test coverage for financial logic;
- release gates.

---

# 33. Offline and Network Behavior

Phase 1 should be **offline-aware**, but full offline-first synchronization is not a requirement unless separately approved.

The app must:

- clearly handle network loss;
- avoid silently losing typed expense data;
- avoid duplicate financial submissions after retry;
- display cached/read-only information where safe;
- refresh authoritative data after reconnecting.

If local SQLite is used, it must not become a second conflicting financial source of truth.

The server/database remains authoritative for committed financial state.

---

# 34. Native / Expo Build Requirements

The app is developed using:

- React Native;
- Expo;
- Expo Prebuild / CNG;
- TypeScript;
- Android as the first production target.

## 34.1 Prebuild principle

Native projects are generated from the Expo configuration.

Do not casually hand-edit generated Android files.

## 34.2 Native dependency rule

When a native module is introduced:

1. install a version compatible with the selected Expo SDK;
2. use Expo configuration/plugin mechanisms where applicable;
3. run a clean prebuild when required;
4. verify generated native configuration;
5. run typecheck/lint/tests;
6. build Android;
7. install/run the build;
8. verify critical flows;
9. commit the source/configuration and reproducible build changes.

## 34.3 Clean prebuild expectation

The project must be structured so that a clean prebuild can regenerate native projects without relying on undocumented manual edits.

A clean prebuild must be treated as a release/compatibility check whenever native dependencies or native configuration materially changes.

## 34.4 Important limitation

No development process can guarantee that every future third-party native module will be conflict-free. The requirement is to **minimize native drift and catch compatibility problems through explicit validation gates**, rather than hiding native changes in generated files.

---

# 35. Data and Backend Product Requirements

The backend implementation may use the selected free-first production stack, but the product contract is independent of a specific provider.

The backend must provide authoritative persistence for:

- users;
- groups;
- memberships;
- people/friends;
- expenses;
- participants/splits;
- settlements/payments;
- currencies;
- activity;
- notifications;
- attachments where supported.

The chosen architecture must support:

- relational integrity;
- migrations;
- authorization;
- transactions;
- stable IDs;
- timestamps;
- indexes;
- secure API access.

The exact infrastructure belongs in the technical architecture document.

---

# 36. Core Data Relationships

Conceptual model:

```text
User
├── Friendships / People
├── Groups
│   └── Group Members
├── Expenses
│   ├── Participants
│   └── Splits
├── Settlements / Payments
├── Notifications
└── Activity
```

An expense must preserve enough information to reproduce its allocation.

Historical financial records must not become mathematically ambiguous after later edits or membership changes.

---

# 37. Financial Transaction Invariants

The following invariants are mandatory.

## Expense invariant

```text
valid expense
→ valid payer
→ valid participants
→ valid split
→ allocation total == expense total
```

## Settlement invariant

```text
valid settlement
→ valid relationship
→ amount > 0
→ amount <= allowed outstanding amount
```

unless a documented partial/over-settlement rule explicitly permits otherwise.

## Balance invariant

Balances must be derivable from authoritative expenses and settlement/payment events.

## Atomicity invariant

A financial mutation either completes fully or leaves no partial financial state.

## Idempotency invariant

Retrying a duplicate-prone request must not accidentally create duplicate financial events.

---

# 38. Testing Product Requirements

Testing is part of the product quality bar.

## 38.1 Unit tests

At minimum cover:

- equal split;
- exact split;
- percentage split;
- shares split;
- adjustment if enabled;
- rounding;
- balances;
- settlement;
- debt simplification;
- currency edge cases.

## 38.2 Integration tests

Cover:

- create group;
- add member;
- create expense;
- edit expense;
- delete expense;
- settle balance;
- refresh/read authoritative state;
- authorization failures.

## 38.3 End-to-end tests

Critical flow:

```text
Sign up
→ create group
→ add members
→ add expense
→ inspect balance
→ settle
→ verify updated balance
```

## 38.4 Regression testing

Every change to financial logic must trigger the relevant financial test suite.

---

# 39. Observability Requirements

Before public production release, the app should have enough monitoring to diagnose:

- crashes;
- failed API operations;
- authentication failures;
- unexpected financial calculation errors;
- major performance issues.

Logs must never expose:

- passwords;
- session secrets;
- private tokens;
- unnecessary personal/financial data.

Analytics must be privacy-conscious and minimal in Phase 1.

---

# 40. Performance Requirements

The application should feel fast on normal Android devices.

Requirements:

- avoid unnecessary network requests;
- cache safe server data appropriately;
- avoid blocking the UI thread with expensive work;
- use list virtualization for long lists;
- avoid unnecessary re-renders;
- keep animations smooth;
- provide immediate interaction feedback without faking financial success.

The exact measurable performance budgets belong in the technical/QA specifications.

---

# 41. Phase Delivery Strategy

Phase 1 must itself be divided into **small implementation sub-phases** to reduce errors.

The implementation must never attempt to build the entire application in one large step.

Recommended sequence:

```text
P1.0 Requirements / repository audit
        ↓
P1.1 Project/build foundation
        ↓
P1.2 Design-system foundation
        ↓
P1.3 Authentication foundation
        ↓
P1.4 Database/domain foundation
        ↓
P1.5 Groups + people
        ↓
P1.6 Expense creation + split engine
        ↓
P1.7 Expense history/details/edit/delete
        ↓
P1.8 Balances + debt simplification
        ↓
P1.9 Settlements
        ↓
P1.10 Dashboard/Home
        ↓
P1.11 Activity + notifications
        ↓
P1.12 Search/currency/totals/settings
        ↓
P1.13 Security hardening
        ↓
P1.14 Full QA/regression
        ↓
P1.15 Android production build
```

Each sub-phase must have its own acceptance gate.

---

# 42. Implementation Task Management Rule

`PRD.md` defines **what the product must do and why**.

`TASKS.md` defines **how the work is broken into implementation tasks**.

Therefore:

- do not turn PRD into a giant command checklist;
- do not put hundreds of shell commands into PRD;
- do not mark a product requirement complete merely because a screen exists;
- each task in `TASKS.md` should reference the relevant PRD requirement;
- tasks should be small enough to implement, test, and verify independently.

Recommended task granularity:

```text
Phase
  ↓
Milestone
  ↓
Small task
  ↓
Verification
  ↓
Commit
```

A task should ideally have one clear outcome.

---

# 43. Phase Acceptance Gates

A sub-phase is complete only when:

1. implementation exists;
2. typecheck passes;
3. lint/format checks pass;
4. relevant automated tests pass;
5. critical manual flow works on Android;
6. loading/empty/error states are handled;
7. authorization/security requirements are respected;
8. no known regression is introduced;
9. the task is documented in `TASKS.md`/progress tracking.

Financial milestones additionally require calculation/invariant tests.

---

# 44. Definition of Done — Phase 1

Phase 1 is considered complete when a real user can use the app instead of a Splitwise-style reference product for ordinary expense sharing.

The complete flow must work:

```text
Install
  ↓
Create account / sign in
  ↓
Create or join group
  ↓
Add people
  ↓
Add expenses
  ↓
Use different split methods
  ↓
View expenses
  ↓
Understand balances
  ↓
View simplified debts
  ↓
Record settlement
  ↓
Verify updated balance
  ↓
Review activity/history
  ↓
Manage account/settings
```

And:

- the UI is polished and phone-responsive;
- core screens do not feel generic;
- financial calculations are deterministic and tested;
- security controls are active;
- production errors are observable;
- clean Expo prebuild is reproducible;
- Android production build succeeds;
- no initial advertising is present;
- no AI dependency is required;
- no artificial expense-entry limit is used.

---

# 45. Release Quality Bar

The app should feel:

> **Production-ready, not prototype-ready.**

A release must not be approved merely because the happy path works.

Before release, verify:

### Product

- core workflows complete;
- clear balances;
- correct settlement behavior;
- usable onboarding.

### UI/UX

- responsive on target Android devices;
- consistent design system;
- accessible interactions;
- polished states;
- no obvious clutter.

### Financial correctness

- split invariants pass;
- rounding tests pass;
- balances reconcile;
- settlements reconcile;
- edits/deletes reconcile;
- debt simplification preserves value.

### Security

- unauthorized access blocked;
- protected resources verified server-side;
- secrets not exposed;
- secure session handling;
- safe error responses.

### Reliability

- retry behavior tested;
- duplicate submission tested;
- network failure tested;
- migration tested;
- clean prebuild tested;
- production Android build tested.

---

# 46. Future Phase Direction

Phase 1 intentionally establishes the reliable core.

Potential future phases may introduce:

- receipt OCR;
- AI-assisted expense entry;
- natural-language expense creation;
- richer offline-first synchronization;
- UPI/payment integrations;
- advanced analytics;
- smart reminders;
- premium/ad-removal subscription;
- partner/affiliate opportunities;
- team/business expense features.

These features must be evaluated independently and must not be allowed to destabilize the Phase 1 accounting core.

---

# 47. Future Compatibility Principle

Every future module should be isolated behind a clear boundary where practical.

Examples:

```text
Accounting Engine
Payment Integration
Notification Provider
Attachment Storage
Analytics
Monetization
```

A future module must not require rewriting unrelated core functionality.

Native modules must follow the Expo compatibility and clean-prebuild rules defined in the architecture/build documentation.

---

# 48. Supporting Documents / Source-of-Truth Hierarchy

The project should maintain clear responsibility for each document.

| Document | Responsibility |
|---|---|
| `PRD.md` | Product requirements, scope, behavior, acceptance criteria |
| `ARCHITECTURE.md` / `architecture.md` | System architecture and boundaries |
| `TECH_SPEC.md` / `tech_specs.md` | Concrete technology and implementation standards |
| `SECURITY_SPEC.md` / `security.md` | Security and privacy controls |
| `UI_UX_SPEC.md` | Visual and interaction requirements |
| `TASKS.md` | Small sequential implementation tasks |
| `TESTING.md` / `quality_assurance.md` | Test strategy and release QA |
| `TROUBLESHOOTING.md` | Known failures and recovery procedures |
| `ROADMAP.md` | Phase/milestone sequencing and progress |

If two documents conflict, the conflict must be resolved explicitly rather than silently choosing whichever instruction is newer in a chat.

---

# 49. Recommended Additional Specification Files

The current documentation set is already broad. Two additional documents would be especially valuable if they do not already exist:

## `FINANCIAL_LOGIC_SPEC.md`

Purpose:

- authoritative split rules;
- rounding rules;
- balance derivation;
- debt simplification algorithm;
- settlement rules;
- invariants;
- exhaustive financial examples;
- edge cases.

This should become the most detailed source of truth for the accounting engine.

## `RELEASE_CHECKLIST.md`

Purpose:

- prebuild verification;
- Android build verification;
- migration checks;
- security checks;
- regression checks;
- release gates;
- rollback/recovery checklist.

These documents should be created only if the existing `SECURITY_SPEC.md`, `TESTING.md`, `ROADMAP.md`, or other documents do not already cover the same responsibility.

---

# 50. Final Product Rule

The application is not successful because it contains many screens.

It is successful when a real user can open it, understand their financial position, add a shared expense quickly, trust the resulting calculation, understand why they owe or are owed money, and settle the balance without confusion.

The Phase 1 north star is:

> **Same familiar expense-sharing job. Better product execution.**

Build the reliable financial core first. Build the premium experience around it. Add advanced intelligence only after the foundation is proven.
