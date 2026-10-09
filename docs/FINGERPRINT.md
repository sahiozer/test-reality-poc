# Fingerprints and findings

Every fingerprint contains `metric_name`, `environment`, `value`, `scope`, `timestamp`, and `calculation_method`. All metrics in one snapshot share a UTC analysis timestamp.

## Table and column summaries

For each of the four tables in each environment:

- Row count: `COUNT(*)`.
- Null rate for every column: `(COUNT(*) - COUNT(column)) / COUNT(*)`; `null` for an empty table.
- Distinct count for every column: `COUNT(DISTINCT column)`, excluding SQL nulls.
- Min/max timestamps for `customer.created_at` and `account.opened_at`.

## Business features

One feature record conceptually represents one customer, but SQL returns only grouped counts.

| Feature | Definition |
|---|---|
| customer_type | RETAIL or CORPORATE |
| account_count_bucket | Number of ACTIVE accounts: `0`, `1`, or `2+` |
| has_fx_account | Any account whose currency differs from TRY, including closed accounts |
| has_active_loan | At least one ACTIVE loan |
| has_active_card | At least one ACTIVE card |
| has_blocked_account | Any account with `blocked_flag=true`, including closed accounts |

All environment customers form the prevalence denominator, including customers without active accounts. Business metrics count each customer once. The closed-customer health rule counts customers with status CLOSED and at least one ACTIVE account. Orphan checks use child-to-customer LEFT JOINs; enforced foreign keys mean the expected observed orphan count is zero.

## Coverage

The six explicit features define at most 96 combinations for this schema. A significant PROD state needs both **100 customers** and **0.1% prevalence**. At 120,000 customers, prevalence also implies at least 120 customers. Thresholds are included in output.

For each significant state, calculate PROD and TEST counts/prevalences with an exact feature match:

- Missing: TEST count is zero.
- Represented: TEST count is positive, including underrepresented states.
- Underrepresented: represented, but TEST prevalence is less than 50% of PROD prevalence.

Thus `represented + missing = total significant states`; underrepresented is a subset of represented. Rare PROD states below either threshold are excluded from the coverage denominator. TEST-only states do not count toward PROD coverage.

## Freshness

Latest relevant timestamp is the maximum across `customer.created_at` and `account.opened_at`. TEST data age is the analysis timestamp minus TEST's latest timestamp. Age difference is PROD latest minus TEST latest. These measure business-date coverage, not the actual time of data extraction, because the minimal model has no extraction timestamp. Loan/card tables do not have date fields in this POC.

## Findings

| Type | Rule |
|---|---|
| REPRESENTATION_GAP | Multi-account customer prevalence trails PROD by at least 5 percentage points; also any significant state below the 50% prevalence ratio |
| MISSING_STATE | Significant PROD state with zero exact TEST matches |
| DATA_HEALTH_ISSUE | One aggregate issue when any closed TEST customers have ACTIVE accounts |
| FRESHNESS_GAP | TEST's latest business timestamp trails PROD by more than 7 days |

IDs combine run ID, rule, and metric/state ID. Each finding includes title, values, unit-aware evidence, severity, deterministic explanation, explanation-ready evidence, and calculation time. Counts on the overview are findings/states, not affected-customer totals. Detailed evidence exposes affected-customer counts.

Synthetic data conditions are intentional, but analysis outputs and coverage denominators are never hard-coded. Seeding and analysis are separate operations; changing rows and rerunning analysis changes the measured outputs.
