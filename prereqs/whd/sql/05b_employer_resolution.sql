-- Phase 2b: employer entity resolution. Groups case-level legal names that are the same employer
-- spelled differently, so EMPLOYER_PROFILE and the Phase 4 app treat them as one entity.
-- Runs after 05 and before 06 (06 views join this cross-reference).
--
-- Two passes, both scoped within a state (same name in two states stays two employers):
--   1. Normalize: lowercase, keep the name before d/b/a / aka, '&' -> and, strip punctuation, drop legal suffixes
--      and filler words (inc, llc, corp, co, ltd, group, holdings, usa, the, of, and ...), department -> dept,
--      trailing plural 's' on 3+ letter words.
--   2. Fuzzy (typo-only): two normalized names merge only if they share the first word, have the same word count
--      and the same digits (so store #4 != store #5), are 10+ chars, and are within edit distance 2. When any
--      differing word is under 6 chars the limit drops to 1 (stops "maria" -> "marco"). A name merges into the
--      in-state variant with the most cases. Jaro-Winkler >= 92 was tested and rejected: it merged distinct
--      employers (M and T Farms / M and K Farms, Caltrans / Corrections, numbered franchise stores).
USE ROLE DOL_WHD_DEMO_ROLE;
USE WAREHOUSE DOL_WHD_WH;
USE DATABASE DOL_WHD_DEMO;
USE SCHEMA DOL_WHD_DEMO.TRANSFORMED;

CREATE OR REPLACE TABLE TRANSFORMED.EMPLOYER_XREF AS
WITH names AS (
    SELECT legal_name, state_code, COUNT(*) AS case_count,
        TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
            SPLIT_PART(REGEXP_REPLACE(LOWER(legal_name), '\\s+(d/b/a|dba|aka|a/k/a)\\s+', '|'), '|', 1),
            '&', ' and '),
            '[^a-z0-9 ]', ' '),
            '\\b(the|inc|incorporated|llc|l l c|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc|pa|group|holdings|holding|usa|us|of|and|at)\\b', ' '),
            '\\bdepartment\\b', 'dept'),
            '\\b([a-z]{3,})s\\b', '\\1'),
            '\\s+', ' ')) AS norm_raw
    FROM TRANSFORMED.WHD_CASE
    WHERE legal_name IS NOT NULL
    GROUP BY 1, 2
),
names_n AS (   -- names that normalize to nothing keep their lowercased raw form
    SELECT legal_name, state_code, case_count, COALESCE(NULLIF(norm_raw, ''), LOWER(TRIM(legal_name))) AS normalized_name
    FROM names
),
norm_keys AS (
    SELECT normalized_name, state_code, SUM(case_count) AS case_count FROM names_n GROUP BY 1, 2
),
candidates AS (
    SELECT a.normalized_name, a.state_code, b.normalized_name AS target_name, b.case_count AS target_cases,
           ARRAY_CAT(ARRAY_EXCEPT(SPLIT(a.normalized_name, ' '), SPLIT(b.normalized_name, ' ')),
                     ARRAY_EXCEPT(SPLIT(b.normalized_name, ' '), SPLIT(a.normalized_name, ' '))) AS diff_words,
           EDITDISTANCE(a.normalized_name, b.normalized_name) AS edit_distance
    FROM norm_keys a
    JOIN norm_keys b
      ON a.state_code = b.state_code
     AND SPLIT_PART(a.normalized_name, ' ', 1) = SPLIT_PART(b.normalized_name, ' ', 1)
     AND a.normalized_name <> b.normalized_name
     AND (b.case_count > a.case_count OR (b.case_count = a.case_count AND b.normalized_name < a.normalized_name))
    WHERE LENGTH(a.normalized_name) >= 10
      AND EDITDISTANCE(a.normalized_name, b.normalized_name) <= 2
      AND ARRAY_SIZE(SPLIT(a.normalized_name, ' ')) = ARRAY_SIZE(SPLIT(b.normalized_name, ' '))
      AND REGEXP_REPLACE(a.normalized_name, '[^0-9]', '') = REGEXP_REPLACE(b.normalized_name, '[^0-9]', '')
),
fuzzy AS (
    SELECT normalized_name, state_code, target_name
    FROM candidates
    WHERE NOT REGEXP_LIKE(' ' || ARRAY_TO_STRING(diff_words, ' ') || ' ', '.* [a-z0-9]{1,4} .*')
      AND (edit_distance <= 1 OR NOT REGEXP_LIKE(' ' || ARRAY_TO_STRING(diff_words, ' ') || ' ', '.* [a-z0-9]{1,5} .*'))
    QUALIFY ROW_NUMBER() OVER (PARTITION BY normalized_name, state_code ORDER BY target_cases DESC, target_name) = 1
),
resolved AS (  -- follow at most one extra hop so chains (a -> b -> c) land on c
    SELECT n.legal_name, n.state_code, n.case_count, n.normalized_name,
           COALESCE(f2.target_name, f1.target_name, n.normalized_name) AS resolved_name,
           CASE WHEN f1.target_name IS NOT NULL THEN 'fuzzy'
                WHEN LOWER(TRIM(n.legal_name)) <> n.normalized_name THEN 'normalized'
                ELSE 'exact' END AS match_method
    FROM names_n n
    LEFT JOIN fuzzy f1 ON f1.normalized_name = n.normalized_name AND f1.state_code = n.state_code
    LEFT JOIN fuzzy f2 ON f2.normalized_name = f1.target_name    AND f2.state_code = n.state_code
)
SELECT
    CAST(legal_name AS VARCHAR(200))                                   AS legal_name,
    CAST(state_code AS VARCHAR(2))                                     AS state_code,
    CAST(normalized_name AS VARCHAR(200))                              AS normalized_name,
    CAST(MD5(state_code || '|' || resolved_name) AS VARCHAR(32))       AS employer_key,
    -- canonical display = the raw legal name used on the most cases in the group
    CAST(FIRST_VALUE(legal_name) OVER (PARTITION BY state_code, resolved_name
                                       ORDER BY case_count DESC, legal_name) AS VARCHAR(200)) AS canonical_legal_name,
    CAST(match_method AS VARCHAR(12))                                  AS match_method,
    case_count
FROM resolved;
