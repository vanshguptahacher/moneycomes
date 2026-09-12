# Financial Invariants — Expense Sharing App

This document defines the foundational rules for all financial calculations in the application.

These invariants are enforced by the domain layer in `src/domain/money/` and must be respected throughout every layer of the stack.

---

## The Eight Financial Invariants

### 1. Money always carries an explicit currency.

A monetary value without a currency is meaningless.

Every `Money` value in this application always contains both an `amountMinor` integer and a `CurrencyCode`.

There is no currency-less "amount" type in the financial domain.

### 2. Monetary arithmetic requires matching currencies.

Attempting to add, subtract, or compare Money values of different currencies is a programming error.

```text
INR 10050 + INR 5000 = INR 15050  ✓
INR 10050 + USD 5000 = CurrencyMismatchError  ✗
```

Currency conversion is never implicit. If two amounts in different currencies must be combined, explicit conversion at a known exchange rate must happen first — and this conversion is currently out of scope for Phase 2.

### 3. Authoritative money is represented as an exact integer (minor units).

All monetary values stored, transmitted, and calculated in this application use the currency's smallest indivisible unit:

- **INR**: paise (1 rupee = 100 paise) — e.g. ₹100.50 → 10050 paise
- **USD**: cents (1 dollar = 100 cents) — e.g. $25.75 → 2575 cents
- **EUR**: cents (1 euro = 100 cents) — e.g. €10.00 → 1000 cents
- **GBP**: pence (1 pound = 100 pence) — e.g. £5.99 → 599 pence
- **JPY**: yen (1 yen = 1 yen, no minor unit) — e.g. ¥500 → 500

Integer arithmetic on minor units is exact. No rounding occurs during addition or subtraction.

### 4. Floating-point values are NEVER authoritative.

JavaScript `number` (IEEE 754 double-precision) cannot exactly represent many decimal fractions:

```text
0.1 + 0.2 ≠ 0.3 in floating-point
```

`0.1 * 100` in JavaScript may produce `10.000000000000002`.

The domain layer enforces that all `Money` values contain an integer `amountMinor`. The `fromDecimal()` function uses string-based parsing to convert user-facing decimal input to exact minor units — it does NOT use floating-point multiplication.

### 5. Precision violations are rejected unless an explicit rounding policy applies.

A decimal string with more places than the currency allows is rejected:

```text
"100.555" for INR (2 decimal places)  → InvalidPrecisionError
"500.5"   for JPY (0 decimal places)  → InvalidPrecisionError
```

Implicit rounding is not permitted. If rounding is needed for split calculations (Phase 2.2+), it must be implemented as an explicit, documented, deterministic domain operation.

### 6. Currency conversion is NEVER implicit.

The domain layer does not contain exchange rates or conversion logic.

Any future currency conversion must be an explicit, authoritative operation with a documented rate source, timestamp, and rounding policy.

### 7. Financial calculations are deterministic.

Given the same inputs, every financial operation must produce the same output on every platform and at any time.

Non-determinism from locale settings, device timezone, or system `Math` implementations is not acceptable. The `format()` function does not use locale-dependent formatting; the `fromDecimal()` function treats `.` as the decimal separator.

### 8. Financial domain code is independent of UI, HTTP, and framework code.

`src/domain/money/` must not import:

- React, React Native, or Expo
- Hono, Express, or any HTTP framework
- Drizzle ORM or any database driver
- Any platform-specific API

This independence allows the domain to be tested deterministically in Node.js, used on both the server and the client bundle, and safely replaced or extended without touching infrastructure layers.

---

## Rounding Policy

### Current state (Phase 2.1)

Phase 2.1 does not implement rounding. All arithmetic is exact.

- `add` and `subtract` produce exact integer results.
- `fromDecimal` rejects imprecise inputs rather than rounding them.
- No split calculations exist yet.

### Future rounding (Phase 2.2+)

When remainder distribution is introduced for split calculations (equal split, percentage split, shares split), the following rules apply:

1. **Do not silently round.** Any rounding operation must be a named, explicit domain function.
2. **Use floor division** for the base allocation and **distribute the remainder** to specific participants using a deterministic rule (e.g. first N participants receive 1 extra minor unit).
3. **Verify totals.** The sum of all allocated amounts must always equal the total expense amount.
4. **Remainder is always 1 minor unit per underpaid participant.** Never allocate more than 1 extra minor unit per person to resolve a remainder.

---

## Safe Integer Boundary

The domain uses JavaScript `Number.isSafeInteger()` as the boundary:

```text
Maximum: +9,007,199,254,740,991 (Number.MAX_SAFE_INTEGER)
Minimum: -9,007,199,254,740,991
```

At 2 minor-unit precision (INR/USD/EUR/GBP), this represents approximately ±₹90 trillion.

This far exceeds any real-world group expense scenario. If values approaching this limit are encountered, the system should reject them as a data integrity error rather than silently overflow.

---

## Wire Serialization Format

```json
{
  "amountMinor": 10050,
  "currency": "INR"
}
```

This matches the Drizzle schema columns `amount_minor bigint` and `currency_code varchar(3)`.

Do NOT serialize money as a floating-point decimal (e.g. `100.50`) in API responses or database columns.
