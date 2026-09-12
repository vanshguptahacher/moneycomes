# UI_UX_SPEC.md — Expense-Sharing App

## 1. Purpose

This is the authoritative UI/UX specification for the Android-first Expense-Sharing App.

The product is a mobile-first expense-sharing application for students, friends, flatmates, families, and travel groups.

The UI must feel modern, premium, minimal, clean, trustworthy, financially clear, fast, familiar, and easy to use with one hand.

The primary UX questions are:

1. Who owes whom?
2. How much?
3. What should I do next?

Financial correctness always has priority over visual effects.

This replaces the incorrect PriceRadar UI specification. PriceRadar concepts such as course dashboards, scraper health, urgency signals, self-healing panels, and desktop-first SaaS sidebars do not belong in this project.

## 2. Design Strategy

Use two stages:

STAGE 1 — Functional + Familiar
STAGE 2 — Professional + Distinctive

Stage 1 prioritizes correct functionality, financial clarity, predictable navigation, fast expense entry, clear forms, reliable loading/empty/error states, synchronization, and testing.

Stage 2 progressively improves visual identity, typography, spacing, motion, micro-interactions, component polish, and brand identity.

Do not perform a large visual redesign before the underlying workflow is stable.

## 3. Target Users

### Students
Hostel/flat expenses, food, college trips, cabs, events, shared purchases.

### Friends
Dinners, movies, travel, weekend trips, shopping, shared purchases.

### Flatmates
Rent, electricity, groceries, internet, household expenses, maintenance.

### Travel Groups
Hotels, transport, food, tickets, activities, miscellaneous expenses.

## 4. Core UX Principles

### Financial clarity
Prefer:
- You get ₹500
- You pay ₹300
- Rahul owes you ₹500
- You owe Rahul ₹300
- All settled
- Settle up

Avoid confusing accounting terminology such as net receivable, liability position, or unexplained positive/negative values.

### Familiarity
Users should immediately understand where groups, friends, expenses, balances, settlements, activity, and settings are located.

### One primary action
Every major screen should have one obvious primary action.

### Progressive disclosure
Keep the common path short and expose advanced options only when relevant.

### Finance first
Prioritize readable numbers, correct currency, contrast, clear status, and large touch targets over decorative effects.

## 5. Mobile-First Layout

Android is the primary platform.

Design for:
- one-handed use
- thumb-friendly controls
- 44–48dp-class touch targets where practical
- Android back behavior
- keyboard-aware forms
- safe areas
- small and large Android screens

Do not simply shrink a desktop UI for mobile.

## 6. Primary Navigation

Preferred Phase 1 navigation:

Home | Groups | + | Activity | Account

The central + is the primary creation action and opens Add Expense.

Friends remain accessible through Home, Groups, search, and person/balance flows. A dedicated Friends destination may be introduced only if genuinely useful.

Navigation must be consistent and must never create dead ends.

## 7. Authentication

### Session bootstrap
Show an appropriate loading state while determining session status.

### Welcome
Keep it minimal:
- app identity
- short value proposition
- Create account
- Sign in

Suggested message:
Split expenses. Stay clear. Settle easily.

### Sign up
Name, email, password, validation, loading, errors, and successful session transition.

### Sign in
Email, password, validation, loading, errors, password recovery entry.

### Password recovery
Use the selected authentication system's secure recovery flow.

### Profile setup
Collect only useful information such as display name, avatar, and default currency.

## 8. Home / Dashboard

The Dashboard is the primary home experience.

It should answer:
- What do I get?
- What do I pay?
- What is my net position?
- Who needs my attention?
- Which groups matter?
- What happened recently?
- What should I do next?

### Header
Compact greeting, display name, avatar, notification entry.

### Financial summary
Show:
- You get
- You pay
- Net

Example:
You get ₹4,250
You pay ₹850
Net +₹3,400

### Pending people
Separate:
- people who owe you
- people you owe

Examples:
- Rahul owes you ₹500
- You owe Priya ₹300
- All settled

### Quick actions
At minimum:
- Add expense
- Settle up
- Create group
- Add friend/person

Add Expense should remain the strongest action.

### Recent groups
Show group name, member count, current user position, and concise status.

### Recent activity
Show meaningful events such as expense added, settlement recorded, group created, expense edited, and member changes.

### New-user state
Guide the user through:
1. Add a friend/person
2. Create a group
3. Add the first expense

Never leave a large blank dashboard.

## 9. Groups

### Groups list
Support list, search, useful filters, create group, balance status, and fast group access.

### Create group
Fields:
- group name
- optional icon/image
- currency
- members

Prevent duplicate or partial submissions.

### Group detail
Use a clear hierarchy:
Group header → current balance → members/summary → expenses → balances → totals → activity.

Primary actions:
- Add expense
- Settle up

Secondary actions:
- invite/share
- members
- settings

### Group management
Where authorized:
- add/remove members
- invite
- leave group
- edit group
- group currency/settings

Membership changes must not corrupt historical expense data.

## 10. Friends / Person-to-Person

The app must support expenses directly between people without requiring a group.

### Friends list
Show search, name, avatar, current balance, and clear status.

### Friend detail
Show current balance, shared expense history, settlements, relevant totals, Add expense, and Settle up.

## 11. Add Expense

This is the most important transactional flow.

Default path:

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

### Amount
Use a prominent numeric input, visible currency, numeric keyboard, immediate validation, and clear errors.

### Description
Keep simple. Examples: Dinner, Groceries, Cab, Hotel.

### Context
An expense can belong to a group or person-to-person relationship. Context must be obvious.

### Payer
Allow the current user and eligible participants/members.

### Participants
Clearly show who is included. Make selection/deselection easy.

### Split methods
Phase 1 supports:
1. Equal
2. Exact amounts
3. Percentage
4. Shares
5. Adjustment where explicitly supported

Equal is the default. Advanced methods use progressive disclosure.

### Split validation
Show:
Total: ₹1,000
Assigned: ₹1,000
Remaining: ₹0

Do not allow an ambiguous save state. Server state remains authoritative.

### Currency
Make currency visible and easy to change.

### Date
Default appropriately and allow editing.

### Notes
Optional and visually secondary.

### Attachments
Where supported, show upload/progress/failure clearly without blocking the core flow unnecessarily.

### Save
Prevent duplicate submissions, show progress, preserve input on validation failure, provide success feedback, and reconcile balances/activity after success.

## 12. Expense Detail

Show:
- description
- total
- currency
- date
- payer
- participants
- each person's share
- current user's position
- group/person context
- note
- attachment when available

Actions:
- Edit
- Delete
- Settle where relevant

Editing should clearly warn that balances can change.

Deleting should require confirmation and explain that balances may change.

## 13. Balances

The user should not need accounting knowledge.

Show:
- You get
- You pay
- Net
- people who owe you
- people you owe

Group and friend balance views should explain who owes whom and how much.

Use explicit language rather than unexplained signs.

## 14. Debt Simplification

When simplified debts are shown, explain the result in plain language.

Example:
Instead of several payments, A pays C ₹500.

Show:
- who pays
- who receives
- amount
- why the suggestion exists

Do not expose unnecessary mathematical complexity.

## 15. Settle Up

Show:
- payer
- receiver
- amount
- currency
- context
- optional note
- date where applicable

Before recording:
You are recording:
You → Rahul
₹500

After success:
- confirmation
- updated balance
- activity entry
- useful return path

## 16. Activity

Chronological meaningful events:
- expense added
- expense edited
- expense deleted
- settlement recorded
- group created
- member changes

Show actor, action, amount when relevant, and useful date/time context.

## 17. Search & Filters

Search should be contextual for:
- groups
- friends
- expenses
- activity

Filters should match the current screen. Avoid an oversized global search system unless it provides clear value.

## 18. Account / Settings

Include:
- profile
- preferences
- notifications
- appearance
- security
- data/export where supported
- help/support
- sign out

Keep destructive account actions clearly separated.

## 19. Design System

Create reusable components such as:
- AppHeader
- BottomNavigation
- PrimaryButton
- SecondaryButton
- IconButton
- Card
- BalanceCard
- PersonRow
- GroupRow
- ExpenseRow
- ActivityItem
- Avatar
- Badge
- AmountDisplay
- CurrencySelector
- BottomSheet
- Modal
- TextInput
- AmountInput
- SegmentedControl
- Skeleton
- EmptyState
- ErrorState
- ConfirmationDialog

Do not create multiple components with inconsistent spacing or behavior for the same purpose.

## 20. Typography

Choose one modern sans-serif family and use it consistently.

Suitable options include Inter, Manrope, or Plus Jakarta Sans.

Hierarchy:
- screen title: strong
- section title: semibold
- large amount: bold
- body: regular
- metadata: smaller/muted

## 21. Color

Use a restrained neutral foundation.

Roles:
- background
- surface
- elevated surface
- primary text
- secondary text
- primary accent
- positive
- negative
- warning
- info

Positive and negative financial states should be paired with text/icons/direction, not color alone.

Avoid rainbow interfaces, excessive gradients, neon financial colors, and decorative color blocks.

## 22. Cards, Borders & Elevation

Cards should create hierarchy rather than turn every element into a floating box.

Use consistent radius, padding, subtle borders/elevation, and clear hierarchy.

Avoid huge empty cards, heavy shadows, excessive glassmorphism, and excessive rounding.

## 23. Bottom Sheets

Use for contextual selection where appropriate:
- payer
- participants
- split method
- currency
- filters
- lightweight actions

Provide clear title, selection state, dismissal, Android back behavior, and accessible touch targets.

Do not make every interaction a bottom sheet.

## 24. Motion & Haptics

Motion communicates state.

Use restrained transitions for:
- content entrance
- bottom sheets
- selection changes
- success feedback
- list changes
- loading transitions

Avoid bouncing, parallax, constant floating animation, and animation on every element.

Use Expo Haptics only for meaningful actions such as expense saved or settlement recorded.

## 25. Loading, Empty & Error States

Never leave important screens blank.

Use skeletons for Dashboard, Groups, Friends, Expenses, Balances, Activity, and detail screens.

Use localized progress indicators for submit actions.

Empty states should explain the next action.

Example:
No expenses yet
Add your first shared expense to get started.
[Add expense]

Errors should be calm and actionable:
Couldn't save expense
Your expense was not saved. Check your connection and try again.
[Try again]

Never expose stack traces, SQL, credentials, tokens, or infrastructure details.

## 26. Offline / Poor Network UX

When offline functionality is introduced, distinguish:
- loading
- offline
- stale data
- syncing
- sync failure

Preserve user input, prevent duplicate submissions, provide retry, and communicate conflicts.

Do not falsely present unsynchronized financial data as authoritative.

Server state is authoritative after synchronization.

## 27. Accessibility

Required:
- accessible labels
- readable contrast
- meaningful focus/selection state
- sufficient touch targets
- screen-reader-friendly controls
- logical navigation order
- clear validation errors
- non-color-only status communication
- reduced-motion support where possible

## 28. Performance

Prefer:
- efficient list rendering
- stable keys
- optimized images
- minimal unnecessary re-renders
- lazy loading where useful
- memoization only when justified

Do not add large UI libraries unnecessarily.

## 29. Financial UI Safety

The frontend is never the authoritative financial source.

The server must validate:
- monetary values
- participants
- payer
- split totals
- balances
- settlements

Client calculations may be used only for previews. Authoritative values come from the server.

## 30. Financial Mutation UX

For every money-changing operation:

1. Show what will change.
2. Validate.
3. Prevent duplicate submission.
4. Show progress.
5. Preserve input on safe retry.
6. Confirm success.
7. Update affected balances/activity.
8. Explain meaningful side effects.

Examples:
- editing an expense can change what people owe
- deleting an expense can change balances
- recording a settlement reduces an outstanding amount

## 31. What NOT To Build

Do not introduce into the Phase 1 UI:
- PriceRadar dashboards
- course pricing tables
- scraper health
- self-healing panels
- urgency signals
- desktop-first admin sidebars
- analytics-heavy SaaS dashboards
- artificial expense limits
- ads
- AI
- UPI/payment automation
- speculative gamification
- unnecessary social feeds

## 32. Implementation Rules for Claude Code

1. Read this file before UI work.
2. Cross-check requirements against PRD.md.
3. Preserve existing financial behavior.
4. Preserve familiar expense-sharing workflows.
5. Build mobile-first.
6. Use reusable components.
7. Keep financial information extremely clear.
8. Use progressive disclosure.
9. Implement loading, empty, error, and offline states.
10. Use subtle motion only when useful.
11. Use haptics only for meaningful actions.
12. Test Android back behavior.
13. Test keyboard behavior for forms.
14. Test small and large phone layouts.
15. Never let visual changes alter financial semantics.
16. Do not invent financial rules.
17. Do not perform large UI redesigns while features are unstable.
18. Do not add dependencies without justification.
19. Do not copy another product's branding or proprietary assets.
20. Keep the UI easy to redesign later.

## 33. Final Design Direction

The app should feel:

Familiar → Clear → Fast → Trustworthy → Premium

The goal is not to make expense sharing flashy.

> Make shared money feel simple, understandable, and trustworthy.
